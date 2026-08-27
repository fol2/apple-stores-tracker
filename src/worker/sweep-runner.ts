import { MARKETS } from '../shared/markets'
import { changedPoints, type PricePoint } from '../shared/diff'
import { collectMarket, discoverStructures } from '../scrape/sweep'
import { fetchFxRates } from '../scrape/fx'
import type { Offer, Snapshot } from '../shared/types'
import {
  getRaw,
  getSnapshot,
  getStructures,
  getSweepState,
  putFx,
  putRaw,
  putSnapshot,
  putStructures,
  putSweepState,
  type Env,
} from './store'

/** Leave roughly twelve hours between full passes. List prices are not volatile. */
export const SWEEP_INTERVAL_MS = 12 * 60 * 60 * 1000

/**
 * A sweep is a list of steps, one per cron tick. Step 0 rediscovers the
 * catalogue, then one step per market, then a final step that assembles the
 * snapshot and records history.
 */
export const STEPS = ['discover', ...MARKETS.map((m) => m.id), 'assemble'] as const

const today = (now: Date): string => now.toISOString().slice(0, 10)

/** Run whichever step is next, or nothing if the last pass is still fresh. */
export async function runNextStep(env: Env, now = new Date()): Promise<string> {
  const state = await getSweepState(env)

  if (state.step < 0) {
    const last = state.finishedAt ? Date.parse(state.finishedAt) : 0
    if (now.getTime() - last < SWEEP_INTERVAL_MS) return 'idle: last sweep is still fresh'
    await putSweepState(env, { step: 0, startedAt: now.toISOString(), finishedAt: state.finishedAt })
    return runStep(env, 0, now)
  }

  return runStep(env, state.step, now)
}

async function advance(env: Env, step: number, now: Date): Promise<void> {
  const done = step + 1 >= STEPS.length
  const state = await getSweepState(env)
  await putSweepState(env, {
    step: done ? -1 : step + 1,
    startedAt: done ? null : state.startedAt,
    finishedAt: done ? now.toISOString() : state.finishedAt,
  })
}

async function runStep(env: Env, step: number, now: Date): Promise<string> {
  const name = STEPS[step]
  try {
    if (name === 'discover') return await stepDiscover(env)
    if (name === 'assemble') return await stepAssemble(env, now)
    return await stepMarket(env, name)
  } finally {
    // Advance even on failure: one bad market must not wedge the sweep, and
    // the previous snapshot stays served until a good one replaces it.
    await advance(env, step, now)
  }
}

async function stepDiscover(env: Env): Promise<string> {
  // Structure is market-independent, so read it from the base-currency market.
  const structures = await discoverStructures(MARKETS[0])
  if (structures.structures.length === 0) throw new Error('discovery found no families')
  await putStructures(env, structures)
  return `discovered ${structures.structures.length} families, ${structures.errors.length} failed`
}

async function stepMarket(env: Env, marketId: string): Promise<string> {
  const market = MARKETS.find((m) => m.id === marketId)!
  const structures = await getStructures(env)
  if (!structures) throw new Error('no catalogue yet; discovery must run first')

  const collection = await collectMarket(market, structures.structures)
  await putRaw(env, collection)
  return `${marketId}: ${collection.offers.length} offers, ${collection.errors.length} errors`
}

async function stepAssemble(env: Env, now: Date): Promise<string> {
  const collections = await Promise.all(MARKETS.map((m) => getRaw(env, m.id)))
  const present = collections.filter((c): c is NonNullable<typeof c> => c !== null)
  if (present.length === 0) throw new Error('no market data to assemble')

  const offers = present.flatMap((c) => c.offers)
  const snapshot: Snapshot = {
    collectedAt: now.toISOString(),
    markets: present.map((c) => c.marketId),
    offers,
    errors: present.flatMap((c) => c.errors),
  }

  const previous = await getSnapshot(env)
  await putSnapshot(env, snapshot)

  // FX is refreshed here rather than per-market: it moves daily, and one
  // failed rate fetch should not cost us the price data.
  try {
    await putFx(env, await fetchFxRates())
  } catch {
    /* keep the previous rates; the UI shows how old they are */
  }

  const points = changedPoints(previous?.offers ?? [], offers, today(now))
  await recordHistory(env, points)

  return `assembled ${offers.length} offers from ${present.length} markets, ${points.length} price changes`
}

/** D1 caps how many statements one batch can carry, so write in chunks. */
async function recordHistory(env: Env, points: PricePoint[]): Promise<void> {
  const statement = env.HISTORY.prepare(
    `INSERT OR REPLACE INTO price_point
       (market_id, family_id, config_key, currency, amount, observed_on)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  for (let i = 0; i < points.length; i += 100) {
    await env.HISTORY.batch(
      points
        .slice(i, i + 100)
        .map((p) =>
          statement.bind(p.marketId, p.familyId, p.configKey, p.currency, p.amount, p.observedOn),
        ),
    )
  }
}

export type { Offer }
