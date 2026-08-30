/**
 * How old a snapshot may get before the page has to say so.
 *
 * Collection runs once a day, so the oldest healthy snapshot is a little under
 * 24 hours. Two days means a run was missed -- and nothing retries any more.
 * The Worker's cron used to fail loudly and often; a GitHub Action that stops
 * simply goes quiet, and the site would keep serving last week's prices with a
 * timestamp in the footnotes as its only tell.
 *
 * That is the one failure this product cannot present neutrally. A price
 * tracker showing stale prices without saying so is worse than one that is
 * plainly down: the reader has no reason to doubt what they are reading.
 */
export const STALE_AFTER_HOURS = 48

export interface Freshness {
  hoursOld: number
  stale: boolean
}

export function freshnessOf(collectedAt: string | null, now: Date): Freshness | null {
  if (!collectedAt) return null
  const at = Date.parse(collectedAt)
  if (Number.isNaN(at)) return null

  // A clock behind the collector's reads as age zero rather than negative age:
  // the reader's device being wrong is not something to warn them about.
  const hoursOld = Math.max(0, (now.getTime() - at) / 3_600_000)
  return { hoursOld, stale: hoursOld >= STALE_AFTER_HOURS }
}

/** "3 days" / "50 hours", for a sentence that has already said "collected". */
export function ageInWords(hoursOld: number): string {
  const days = Math.floor(hoursOld / 24)
  if (days >= 1) return days === 1 ? '1 day' : `${days} days`
  const hours = Math.floor(hoursOld)
  return hours === 1 ? '1 hour' : `${hours} hours`
}
