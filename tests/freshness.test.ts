import { describe, expect, it } from 'vitest'
import { ageInWords, freshnessOf, STALE_AFTER_HOURS } from '../src/shared/freshness'

const now = new Date('2026-08-30T12:00:00Z')
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString()

/**
 * Collection stopped being self-announcing when it left the Worker. A cron
 * that fails does so every three minutes; an Action that fails goes quiet, and
 * the site would serve last week's prices with nothing but a footnote to say
 * so. This is what turns that silence into something a reader can see.
 */
describe('telling a reader the prices are old', () => {
  it('says nothing about a snapshot collected within the day', () => {
    expect(freshnessOf(hoursAgo(20), now)?.stale).toBe(false)
  })

  it('still says nothing just before a run is properly overdue', () => {
    // Daily collection means ~24h is the healthy maximum; the gate is for a
    // missed run, not for the hours before the next one.
    expect(freshnessOf(hoursAgo(STALE_AFTER_HOURS - 1), now)?.stale).toBe(false)
  })

  it('speaks up once a run has been missed', () => {
    expect(freshnessOf(hoursAgo(STALE_AFTER_HOURS), now)?.stale).toBe(true)
    expect(freshnessOf(hoursAgo(24 * 7), now)?.stale).toBe(true)
  })

  /**
   * The reader's own clock can be wrong, and telling them their prices arrive
   * from the future helps nobody.
   */
  it('treats a snapshot from the future as fresh, not as negative age', () => {
    expect(freshnessOf(hoursAgo(-5), now)).toEqual({ hoursOld: 0, stale: false })
  })

  it('has nothing to say when nothing has been collected', () => {
    expect(freshnessOf(null, now)).toBeNull()
    expect(freshnessOf('not a date', now)).toBeNull()
  })

  it('counts in the unit a reader would use', () => {
    expect(ageInWords(1)).toBe('1 hour')
    expect(ageInWords(20)).toBe('20 hours')
    expect(ageInWords(24)).toBe('1 day')
    expect(ageInWords(24 * 3 + 5)).toBe('3 days')
  })
})
