import { MARKETS, STORES } from '../shared/markets'
import { planSweep, REQUESTS_PER_TICK, type SweepStep } from '../shared/plan'
import { chooseWork } from '../shared/schedule'
import { changedPoints, type PricePoint } from '../shared/diff'
import { collectFamilies, discoverStructures, RequestBudget } from '../scrape/sweep'
import { fetchFxRates } from '../scrape/fx'
import type { Offer, Snapshot } from '../shared/types'
import {
  getPlan,
  getRaw,
  getSnapshot,
  getStructures,
  getSweepState,
  putFx,
  putPlan,
  putRaw,
  putSnapshot,
  putStructures,
  putSweepState,
  type Env,
} from './store'

const today = (now: Date): string => now.toISOString().slice(0, 10)

/** Do whichever tier of work is most overdue, or nothing. */
export async function runNextStep(env: Env, now = new Date()): Promise<string> {
  const state = await getSweepState(env)

  switch (chooseWork(state, now)) {
    case 'continue-sweep':
      return runStep(env, state.step, now)
    case 'refresh-rates':
      return stepFx(env, now)
    case 'start-sweep':
      return startSweep(env, now, 'scheduled: catalogue is due a full read')
    case 'probe':
      return stepProbe(env, now)
    default:
      return 'idle: rates fresh, prices unchanged'
  }
}

async function startSweep(env: Env, now: Date, reason: string): Promise<string> {
  const state = await getSweepState(env)
  await putSweepState(env, { ...state, step: 0, startedAt: now.toISOString(), reason })
  return `${reason} -> ${await runStep(env, 0, now)}`
}

/** One request, and it keeps every converted figure on the site honest. */
async function stepFx(env: Env, now: Date): Promise<string> {
  const state = await getSweepState(env)
  try {
    const rates = await fetchFxRates()
    await putFx(env, rates)
    await putSweepState(env, { ...state, fxAt: now.toISOString() })
    return `fx: refreshed, quoted ${rates.fetchedAt}`
  } catch (error) {
    // Record the attempt so a failing rate source cannot crowd out the probe.
    await putSweepState(env, { ...state, fxAt: now.toISOString() })
    return `fx: failed, keeping previous rates (${error})`
  }
}

/**
 * Re-read one planned slice and compare it with what we already hold.
 *
 * Only configurations present on both sides are compared: a family that failed
 * to collect is a collection error, not a price change, and treating it as one
 * would trigger a full sweep every time Apple throttled us.
 */
async function stepProbe(env: Env, now: Date): Promise<string> {
  const state = await getSweepState(env)
  const budget = new RequestBudget(REQUESTS_PER_TICK)

  const [plan, snapshot, structures] = await Promise.all([
    getPlan(env),
    getSnapshot(env),
    getStructures(env),
  ])

  if (!plan?.length || !snapshot || !structures) {
    return startSweep(env, now, 'first run: nothing to compare against yet')
  }

  const step = plan[state.probeCursor % plan.length]
  const market = MARKETS.find((m) => m.id === step.marketId)
  const wanted = structures.structures.filter((s) => step.familyIds.includes(s.familyId))

  const advanceProbe = (extra: Partial<typeof state> = {}) =>
    putSweepState(env, {
      ...state,
      probeAt: now.toISOString(),
      probeCursor: (state.probeCursor + 1) % plan.length,
      ...extra,
    })

  if (!market || wanted.length === 0) {
    await advanceProbe()
    return 'probe: nothing to sample in this slice'
  }

  const known = new Map(
    snapshot.offers
      .filter((o) => o.marketId === step.marketId && (o.store ?? 'retail') === step.store)
      .map((o) => [`${o.familyId} ${o.configKey}`, o.amount]),
  )

  let collection
  try {
    collection = await collectFamilies(market, step.store, wanted, budget)
  } catch (error) {
    await advanceProbe()
    return `probe: ${step.marketId}:${step.store} could not be read (${error})`
  }

  const moved = collection.offers.filter((offer) => {
    const before = known.get(`${offer.familyId} ${offer.configKey}`)
    return before !== undefined && before !== offer.amount
  })

  await advanceProbe()

  if (moved.length === 0) {
    return `probe: ${step.marketId}:${step.store} unchanged across ${collection.offers.length} prices`
  }

  const example = moved[0]
  return startSweep(
    env,
    now,
    `probe: ${moved.length} price(s) moved in ${step.marketId}:${step.store}, e.g. ${example.familyId} ${example.currency} ${example.amount}`,
  )
}

async function advance(env: Env, step: number, total: number, now: Date): Promise<void> {
  const done = step + 1 >= total
  const state = await getSweepState(env)
  await putSweepState(env, {
    ...state,
    step: done ? -1 : step + 1,
    startedAt: done ? null : state.startedAt,
    finishedAt: done ? now.toISOString() : state.finishedAt,
  })
}

/**
 * Step 0 discovers the catalogue and writes the plan; the last step assembles.
 * Everything between is one planned batch of families.
 */
async function runStep(env: Env, step: number, now: Date): Promise<string> {
  const budget = new RequestBudget(REQUESTS_PER_TICK)

  if (step === 0) {
    try {
      return await stepDiscover(env, budget)
    } finally {
      await advance(env, 0, Number.MAX_SAFE_INTEGER, now)
    }
  }

  const plan = await getPlan(env)
  if (!plan) {
    // No plan means discovery never landed; restart the pass rather than
    // spinning through steps that have nothing to price.
    const state = await getSweepState(env)
    await putSweepState(env, { ...state, step: 0, startedAt: now.toISOString() })
    return 'no plan; restarting at discovery'
  }

  const total = plan.length + 2
  try {
    if (step > plan.length) return await stepAssemble(env, now)
    return await stepCollect(env, plan[step - 1], budget)
  } finally {
    // Advance even on failure: one bad batch must not wedge the sweep, and the
    // previous snapshot stays served until a good one replaces it.
    await advance(env, step, total, now)
  }
}

async function stepDiscover(env: Env, budget: RequestBudget): Promise<string> {
  const structures = await discoverStructures(MARKETS[0], budget)
  if (structures.structures.length === 0) throw new Error('discovery found no families')

  const plan = planSweep(structures.structures)
  await putStructures(env, structures)
  await putPlan(env, plan)

  return `discovered ${structures.structures.length} families, ${structures.errors.length} failed; planned ${plan.length} steps`
}

async function stepCollect(env: Env, step: SweepStep, budget: RequestBudget): Promise<string> {
  const market = MARKETS.find((m) => m.id === step.marketId)!
  const structures = await getStructures(env)
  if (!structures) throw new Error('no catalogue yet; discovery must run first')

  const wanted = structures.structures.filter((s) => step.familyIds.includes(s.familyId))
  const collection = await collectFamilies(market, step.store, wanted, budget)

  // Batches of one market and store accumulate into a single stored slice.
  const key = `${step.marketId}:${step.store}`
  const existing = await getRaw(env, key)
  const merged = new Map(
    (existing?.offers ?? [])
      .filter((o) => !step.familyIds.includes(o.familyId))
      .map((o) => [`${o.familyId} ${o.configKey}`, o]),
  )
  for (const offer of collection.offers) merged.set(`${offer.familyId} ${offer.configKey}`, offer)

  await putRaw(env, key, {
    ...collection,
    offers: [...merged.values()],
    errors: [...(existing?.errors ?? []).filter((e) => !step.familyIds.includes(e.familyId)), ...collection.errors],
  })

  return `${key} [${step.familyIds.length} families]: ${collection.offers.length} offers, ${collection.errors.length} errors, ${budget.remaining} requests spare`
}

async function stepAssemble(env: Env, now: Date): Promise<string> {
  const keys = MARKETS.flatMap((m) => STORES.map((store) => `${m.id}:${store}`))
  const collections = await Promise.all(keys.map((key) => getRaw(env, key)))
  const present = collections.filter((c): c is NonNullable<typeof c> => c !== null)
  if (present.length === 0) throw new Error('no market data to assemble')

  const offers = present.flatMap((c) => c.offers)
  const snapshot: Snapshot = {
    collectedAt: now.toISOString(),
    markets: [...new Set(present.map((c) => c.marketId))],
    offers,
    errors: present.flatMap((c) => c.errors),
  }

  const previous = await getSnapshot(env)
  await putSnapshot(env, snapshot)

  const points = changedPoints(previous?.offers ?? [], offers, today(now))
  await recordHistory(env, points)

  return `assembled ${offers.length} offers from ${snapshot.markets.length} markets, ${points.length} price changes`
}

/** D1 caps how many statements one batch can carry, so write in chunks. */
async function recordHistory(env: Env, points: PricePoint[]): Promise<void> {
  const statement = env.HISTORY.prepare(
    `INSERT OR REPLACE INTO price_point
       (market_id, family_id, store, config_key, currency, amount, observed_on)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  for (let i = 0; i < points.length; i += 100) {
    await env.HISTORY.batch(
      points
        .slice(i, i + 100)
        .map((p) =>
          statement.bind(
            p.marketId,
            p.familyId,
            p.store,
            p.configKey,
            p.currency,
            p.amount,
            p.observedOn,
          ),
        ),
    )
  }
}

export type { Offer }
