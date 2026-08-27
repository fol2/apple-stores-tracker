import type { FamilyStructures, MarketCollection } from '../scrape/sweep'
import type { SweepStep } from '../shared/plan'
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
  fx: 'fx:latest',
  sweep: 'sweep:state',
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

export const getPlan = (env: Env) => readJson<SweepStep[]>(env.PRICES, KEYS.plan)
export const putPlan = (env: Env, v: SweepStep[]) => writeJson(env.PRICES, KEYS.plan, v)

export const getSnapshot = (env: Env) => readJson<Snapshot>(env.PRICES, KEYS.snapshot)
export const putSnapshot = (env: Env, v: Snapshot) => writeJson(env.PRICES, KEYS.snapshot, v)

export const getFx = (env: Env) => readJson<FxRates>(env.PRICES, KEYS.fx)
export const putFx = (env: Env, v: FxRates) => writeJson(env.PRICES, KEYS.fx, v)

export interface SweepState {
  /** Index into the step list; -1 means no sweep is in progress. */
  step: number
  startedAt: string | null
  finishedAt: string | null
}

export const getSweepState = async (env: Env): Promise<SweepState> =>
  (await readJson<SweepState>(env.PRICES, KEYS.sweep)) ?? { step: -1, startedAt: null, finishedAt: null }

export const putSweepState = (env: Env, v: SweepState) => writeJson(env.PRICES, KEYS.sweep, v)
