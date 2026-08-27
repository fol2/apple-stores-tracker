/**
 * Two tiers of work, because they move at completely different speeds.
 *
 * Prices change a handful of times a year but cost twelve hundred requests to
 * read, so scanning everything on a timer spends that budget over and over to
 * learn that nothing happened. Ahead of it sits a probe: collect a small
 * rotating slice and compare it with what we already hold. When Apple moves
 * prices it moves many at once, so a slice is enough to notice, and a full
 * sweep only runs once there is something to find.
 *
 * Exchange rates used to be a third tier. They are not scheduled work at all:
 * they refresh on the request path, in `worker/rates.ts`.
 */
export const PROBE_INTERVAL_MS = 2 * 60 * 60 * 1000

/**
 * Sweep anyway if the last one is this old. The probe watches prices, but it
 * cannot see a product Apple has only just added, so the catalogue still needs
 * rediscovering on a slow timer.
 */
export const MAX_SWEEP_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type Work = 'continue-sweep' | 'start-sweep' | 'probe' | 'idle'

export interface ScheduleInput {
  /** Index into the plan; -1 when no full sweep is in progress. */
  step: number
  probeAt: string | null
  finishedAt: string | null
}

const age = (at: string | null, now: Date): number =>
  at ? now.getTime() - Date.parse(at) : Number.POSITIVE_INFINITY

/**
 * Decide what one cron tick should do.
 *
 * Order matters: an unfinished sweep is finished before anything else starts,
 * so a pass cannot be left half-collected while cheaper work keeps jumping the
 * queue.
 */
export function chooseWork(state: ScheduleInput, now: Date): Work {
  if (state.step >= 0) return 'continue-sweep'
  if (age(state.finishedAt, now) >= MAX_SWEEP_AGE_MS) return 'start-sweep'
  if (age(state.probeAt, now) >= PROBE_INTERVAL_MS) return 'probe'
  return 'idle'
}
