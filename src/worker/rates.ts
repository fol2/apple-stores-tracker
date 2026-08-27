import type { FxRates } from '../shared/types'
import { fetchFxRates } from '../scrape/fx'
import { getFx, putFx, type Env } from './store'

/**
 * Never read the source more often than this, whatever the record claims.
 *
 * The refresh is driven by timestamps that come from outside — a feed that
 * omitted, mangled or back-dated its next-update time would otherwise put one
 * outbound request on every single origin hit. The floor makes a bad timestamp
 * cost a slightly stale rate instead of a burst against someone else's server.
 */
export const MIN_REFRESH_INTERVAL_MS = 15 * 60 * 1000

/** How long a quote is trusted when the source does not say. */
export const DEFAULT_QUOTE_LIFE_MS = 60 * 60 * 1000

/**
 * How long a quote is trusted at the very most.
 *
 * The floor bounds how often the feed may be read; this bounds how long a
 * number may be believed. Without it a single far-future next-update time --
 * a feed bug, a clock skew, a year typed instead of a day -- would pin every
 * converted figure on the site to that quote indefinitely, and the only sign
 * would be a date in the footer. A day and a half leaves room for a daily
 * feed's own schedule and still catches a wrong timestamp within a day.
 */
export const MAX_QUOTE_LIFE_MS = 36 * 60 * 60 * 1000

/**
 * Whether the stored quote has reached the moment its source said to come back.
 *
 * Records written before `refreshedAt` existed fall back to the quote time,
 * which is the same instant or earlier, so an old record is never treated as
 * fresher than it is.
 */
export function isDue(rates: FxRates, now: Date): boolean {
  const readAt = Date.parse(rates.refreshedAt ?? rates.fetchedAt)
  if (!Number.isFinite(readAt)) return true
  if (now.getTime() - readAt < MIN_REFRESH_INTERVAL_MS) return false

  const published = rates.nextUpdateAt ? Date.parse(rates.nextUpdateAt) : NaN
  const claimed = Number.isFinite(published) ? published : readAt + DEFAULT_QUOTE_LIFE_MS
  return now.getTime() >= Math.min(claimed, readAt + MAX_QUOTE_LIFE_MS)
}

/**
 * One refresh at a time per isolate.
 *
 * Requests arrive in parallel, and every one of them that got past `isDue`
 * would otherwise start its own fetch and its own KV write of the same number.
 */
let inFlight: Promise<FxRates> | null = null

const refresh = (env: Env): Promise<FxRates> =>
  (inFlight ??= fetchFxRates()
    .then(async (rates) => {
      await putFx(env, rates)
      return rates
    })
    .finally(() => {
      inFlight = null
    }))

/**
 * The current rates, refreshed on the request path rather than on a timer.
 *
 * A cron tier for this was always slightly wrong: it re-read a daily feed
 * hourly, which is 23 wasted reads a day, and still left the new quote unseen
 * for up to an hour. Refreshing here instead costs nothing when nobody is
 * looking, picks the new quote up on the first request after the source
 * publishes it, and frees every cron tick for the work that actually needs one.
 *
 * A reader never waits for it. The stored quote is served immediately and
 * replaced behind the response; only a completely empty store — a first
 * deployment — has nothing to serve and has to wait.
 */
export async function currentRates(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  now = new Date(),
): Promise<FxRates | null> {
  const stored = await getFx(env)
  if (stored && !isDue(stored, now)) return stored

  if (!stored) return refresh(env).catch(() => null)

  ctx.waitUntil(refresh(env).catch(() => {}))
  return stored
}
