import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  currentRates,
  DEFAULT_QUOTE_LIFE_MS,
  isDue,
  MAX_QUOTE_LIFE_MS,
  MIN_REFRESH_INTERVAL_MS,
} from '../../src/worker/rates'
import { fetchFxRates } from '../../src/scrape/fx'
import { MARKETS } from '../../src/shared/markets'
import type { Env } from '../../src/worker/store'
import type { FxRates } from '../../src/shared/types'

const now = new Date('2026-08-27T12:00:00.000Z')
const at = (ms: number) => new Date(now.getTime() + ms).toISOString()

/** Every market's currency, since a short map is now rejected outright. */
const full = (usd: number): Record<string, number> =>
  Object.fromEntries(MARKETS.map((m, i) => [m.currency, m.currency === 'USD' ? usd : i + 2]))

const quote = (overrides: Partial<FxRates> = {}): FxRates => ({
  base: 'GBP',
  fetchedAt: at(-DEFAULT_QUOTE_LIFE_MS),
  refreshedAt: at(-DEFAULT_QUOTE_LIFE_MS),
  nextUpdateAt: at(-1),
  rates: full(1.36),
  ...overrides,
})

/** A KV stand-in that records what was written, over the two calls we make. */
const store = (initial: FxRates | null) => {
  let held = initial
  const env = {
    PRICES: {
      get: async () => held,
      put: async (_key: string, value: string) => {
        held = JSON.parse(value)
      },
    },
  } as unknown as Env
  return { env, current: () => held }
}

/** Collects background work the way the runtime does, so tests can await it. */
const context = () => {
  const pending: Promise<unknown>[] = []
  return { ctx: { waitUntil: (p: Promise<unknown>) => pending.push(p) }, settled: () => Promise.all(pending) }
}

const served = (rates: Record<string, number>) =>
  vi.fn(async () =>
    Response.json({
      result: 'success',
      time_last_update_utc: 'Thu, 27 Aug 2026 00:02:31 +0000',
      time_next_update_utc: 'Fri, 28 Aug 2026 00:27:41 +0000',
      rates,
    }),
  )

afterEach(() => vi.unstubAllGlobals())

describe('isDue', () => {
  it('refreshes once the source says its next quote exists', () => {
    expect(isDue(quote(), now)).toBe(true)
  })

  it('waits while the current quote is still the latest one published', () => {
    expect(isDue(quote({ nextUpdateAt: at(60_000) }), now)).toBe(false)
  })

  /**
   * The next-update time comes from someone else's server. A feed that
   * back-dated it, or emitted nonsense, would otherwise put an outbound
   * request on every origin hit.
   */
  it('holds the floor even when the source claims a quote is already overdue', () => {
    const justRead = quote({ refreshedAt: at(-MIN_REFRESH_INTERVAL_MS + 1000), nextUpdateAt: at(-99_999) })
    expect(isDue(justRead, now)).toBe(false)
  })

  it('falls back to an hour when the source does not say', () => {
    expect(isDue(quote({ nextUpdateAt: null, refreshedAt: at(-DEFAULT_QUOTE_LIFE_MS + 1000) }), now)).toBe(false)
    expect(isDue(quote({ nextUpdateAt: null, refreshedAt: at(-DEFAULT_QUOTE_LIFE_MS - 1000) }), now)).toBe(true)
  })

  /** Records written before `refreshedAt` existed must not look fresher. */
  it('reads an older record by its quote time', () => {
    const legacy = { base: 'GBP', fetchedAt: at(-DEFAULT_QUOTE_LIFE_MS - 1), rates: { USD: 1.36 } }
    expect(isDue(legacy, now)).toBe(true)
  })

  it('refreshes when the record carries no usable timestamp at all', () => {
    expect(isDue(quote({ refreshedAt: 'not a date', fetchedAt: 'not a date' }), now)).toBe(true)
  })

  /**
   * The floor bounds how often the feed is read; this bounds how long one
   * number is believed. A far-future next-update time would otherwise pin
   * every converted figure on the site to a single quote forever.
   */
  it('stops believing a quote the source claims will never expire', () => {
    const pinned = (age: number) =>
      quote({ refreshedAt: at(-age), nextUpdateAt: at(365 * 24 * 60 * 60 * 1000) })
    expect(isDue(pinned(MAX_QUOTE_LIFE_MS - 1000), now)).toBe(false)
    expect(isDue(pinned(MAX_QUOTE_LIFE_MS + 1000), now)).toBe(true)
  })
})

describe('fetchFxRates', () => {
  it('reads the quote and next-quote times the feed publishes', async () => {
    vi.stubGlobal('fetch', served(full(1.36)))
    const rates = await fetchFxRates()

    expect(rates.fetchedAt).toBe('2026-08-27T00:02:31.000Z')
    expect(rates.nextUpdateAt).toBe('2026-08-28T00:27:41.000Z')
  })

  /**
   * A success carrying a short map would replace a complete quote with one
   * that silently drops markets, and the site would show them as unpriced.
   */
  it('refuses a success that is missing a market currency', async () => {
    const short = full(1.36)
    delete short.TWD
    vi.stubGlobal('fetch', served(short))

    await expect(fetchFxRates()).rejects.toThrow('missing TWD')
  })

  it('refuses a response the feed did not call a success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ result: 'error' })))
    await expect(fetchFxRates()).rejects.toThrow('not a success')
  })
})

describe('currentRates', () => {
  it('waits for the source when there is nothing to serve', async () => {
    const fetcher = served(full(1.5))
    vi.stubGlobal('fetch', fetcher)
    const { env, current } = store(null)
    const { ctx } = context()

    const rates = await currentRates(env, ctx, now)

    expect(rates?.rates.USD).toBe(1.5)
    expect(current()?.rates.USD).toBe(1.5)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('leaves a fresh quote alone', async () => {
    const fetcher = served(full(1.5))
    vi.stubGlobal('fetch', fetcher)
    const { env } = store(quote({ nextUpdateAt: at(60_000) }))

    expect((await currentRates(env, context().ctx, now))?.rates.USD).toBe(1.36)
    expect(fetcher).not.toHaveBeenCalled()
  })

  /** The reader gets the number we already hold; the new one lands behind them. */
  it('serves a stale quote immediately and replaces it after the response', async () => {
    vi.stubGlobal('fetch', served(full(1.5)))
    const { env, current } = store(quote())
    const { ctx, settled } = context()

    expect((await currentRates(env, ctx, now))?.rates.USD).toBe(1.36)
    await settled()
    expect(current()?.rates.USD).toBe(1.5)
  })

  it('keeps serving the old quote when the source is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    const { env, current } = store(quote())
    const { ctx, settled } = context()

    expect((await currentRates(env, ctx, now))?.rates.USD).toBe(1.36)
    await expect(settled()).resolves.toBeDefined()
    expect(current()?.rates.USD).toBe(1.36)
  })

  it('reports nothing rather than guessing when a first read fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    expect(await currentRates(store(null).env, context().ctx, now)).toBeNull()
  })

  /** Parallel requests past the due time must not each fetch the same number. */
  it('collapses concurrent refreshes into one read of the source', async () => {
    const fetcher = served(full(1.5))
    vi.stubGlobal('fetch', fetcher)
    const { env } = store(null)
    const { ctx } = context()

    await Promise.all([currentRates(env, ctx, now), currentRates(env, ctx, now)])

    expect(fetcher).toHaveBeenCalledOnce()
  })
})
