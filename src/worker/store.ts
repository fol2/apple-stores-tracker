import type { FamilyStructures, MarketCollection } from '../scrape/sweep'
import type { RefurbCollection } from '../scrape/refurb'
import type { SweepStep } from '../shared/plan'
import type { PricePoint } from '../shared/diff'
import type { FxRates, Snapshot } from '../shared/types'

export interface Env {
  PRICES: KVNamespace
  HISTORY: D1Database
  ASSETS: Fetcher
}

/**
 * KV holds the things read on every request (one blob, edge-cached) and the
 * sweep's working state. D1 holds history, which is sparse and queried by key.
 */
export const KEYS = {
  structures: 'structures:latest',
  plan: 'sweep:plan',
  /** `key` is `<market>:<store>`, so retail and education stay separate. */
  raw: (key: string) => `raw:${key}`,
  snapshot: 'snapshot:latest',
  /** Second-hand listings, per market. Only the UK is collected today. */
  refurb: (marketId: string) => `refurb:${marketId}`,
  fx: 'fx:latest',
  sweep: 'sweep:state',
  pendingHistory: 'history:pending',
} as const

const readJson = async <T>(kv: KVNamespace, key: string): Promise<T | null> =>
  kv.get<T>(key, 'json')

const writeJson = (kv: KVNamespace, key: string, value: unknown): Promise<void> =>
  kv.put(key, JSON.stringify(value))

export const getStructures = (env: Env) => readJson<FamilyStructures>(env.PRICES, KEYS.structures)
export const putStructures = (env: Env, v: FamilyStructures) => writeJson(env.PRICES, KEYS.structures, v)

export const getRaw = (env: Env, key: string) =>
  readJson<MarketCollection>(env.PRICES, KEYS.raw(key))
export const putRaw = (env: Env, key: string, v: MarketCollection) =>
  writeJson(env.PRICES, KEYS.raw(key), v)

export const getPendingHistory = async (env: Env): Promise<PricePoint[]> =>
  (await readJson<PricePoint[]>(env.PRICES, KEYS.pendingHistory)) ?? []
export const putPendingHistory = (env: Env, v: PricePoint[]) =>
  writeJson(env.PRICES, KEYS.pendingHistory, v)

export const getPlan = (env: Env) => readJson<SweepStep[]>(env.PRICES, KEYS.plan)
export const putPlan = (env: Env, v: SweepStep[]) => writeJson(env.PRICES, KEYS.plan, v)

export const getSnapshot = (env: Env) => readJson<Snapshot>(env.PRICES, KEYS.snapshot)
export const putSnapshot = (env: Env, v: Snapshot) => writeJson(env.PRICES, KEYS.snapshot, v)

export const getRefurb = (env: Env, marketId: string) =>
  readJson<RefurbCollection>(env.PRICES, KEYS.refurb(marketId))
export const putRefurb = (env: Env, marketId: string, v: RefurbCollection) =>
  writeJson(env.PRICES, KEYS.refurb(marketId), v)

export const getFx = (env: Env) => readJson<FxRates>(env.PRICES, KEYS.fx)
export const putFx = (env: Env, v: FxRates) => writeJson(env.PRICES, KEYS.fx, v)

/**
 * Where the scheduled work has got to.
 *
 * Change detection and full collection move at wildly different speeds, so
 * each carries its own timestamp rather than sharing one clock. Exchange rates
 * are not here: they refresh on the request path, and carry their own.
 */
export interface SweepState {
  /** Index into the plan; -1 means no full sweep is in progress. */
  step: number
  startedAt: string | null
  finishedAt: string | null
  /** Why the current or last full sweep was started. */
  reason: string | null
  /** Last change-detection probe, and where in the rotation it had reached. */
  probeAt: string | null
  probeCursor: number
  /** Last read of the refurbished store. */
  refurbAt: string | null
}

const NO_SWEEP: SweepState = {
  step: -1,
  startedAt: null,
  finishedAt: null,
  reason: null,
  probeAt: null,
  probeCursor: 0,
  refurbAt: null,
}

export const getSweepState = async (env: Env): Promise<SweepState> => ({
  ...NO_SWEEP,
  ...((await readJson<Partial<SweepState>>(env.PRICES, KEYS.sweep)) ?? {}),
})

export const putSweepState = (env: Env, v: SweepState) => writeJson(env.PRICES, KEYS.sweep, v)
