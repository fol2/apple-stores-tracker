import { describe, expect, it } from 'vitest'
import {
  chooseWork,
  MAX_SWEEP_AGE_MS,
  PROBE_INTERVAL_MS,
  REFURB_INTERVAL_MS,
  type ScheduleInput,
} from '../src/shared/schedule'

const now = new Date('2026-08-27T12:00:00.000Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

const state = (overrides: Partial<ScheduleInput> = {}): ScheduleInput => ({
  step: -1,
  probeAt: ago(1000),
  refurbAt: ago(1000),
  finishedAt: ago(1000),
  ...overrides,
})

describe('chooseWork', () => {
  it('does nothing when every tier is fresh', () => {
    expect(chooseWork(state(), now)).toBe('idle')
  })

  /**
   * A half-collected pass is the one state that must not be left sitting: its
   * per-market slices are already in storage, and the snapshot is not rebuilt
   * until the pass reaches its assemble step.
   */
  it('finishes an unfinished sweep before starting anything else', () => {
    const midSweep = state({ step: 7, probeAt: null, refurbAt: null, finishedAt: null })
    expect(chooseWork(midSweep, now)).toBe('continue-sweep')
  })

  /**
   * Six requests for the whole second-hand catalogue, against ninety batches
   * for a price sweep -- so it runs on its own daily timer rather than waiting
   * for one, and ahead of the probe, which can afford to slip two hours.
   */
  it('re-reads the refurbished store daily, ahead of probing', () => {
    const due = state({ refurbAt: ago(REFURB_INTERVAL_MS + 1), probeAt: ago(PROBE_INTERVAL_MS + 1) })
    expect(chooseWork(due, now)).toBe('refresh-refurb')
    expect(chooseWork(state({ refurbAt: ago(REFURB_INTERVAL_MS - 1000) }), now)).toBe('idle')
  })

  it('never reads the refurbished store while a sweep is half done', () => {
    expect(chooseWork(state({ step: 4, refurbAt: null }), now)).toBe('continue-sweep')
  })

  it('probes once the interval has passed', () => {
    expect(chooseWork(state({ probeAt: ago(PROBE_INTERVAL_MS + 1) }), now)).toBe('probe')
  })

  /**
   * The probe compares prices, so it cannot notice a product Apple has only
   * just added. A slow forced sweep is what keeps the catalogue itself honest.
   */
  it('forces a full sweep when the catalogue is stale, ahead of probing', () => {
    const stale = state({ finishedAt: ago(MAX_SWEEP_AGE_MS + 1), probeAt: ago(PROBE_INTERVAL_MS + 1) })
    expect(chooseWork(stale, now)).toBe('start-sweep')
  })

  it('treats never-having-run as overdue, so a cold start collects', () => {
    expect(chooseWork(state({ probeAt: null, refurbAt: null, finishedAt: null }), now)).toBe('start-sweep')
  })

  it('never starts a second sweep while one is running', () => {
    const running = state({ step: 0, finishedAt: ago(MAX_SWEEP_AGE_MS * 10) })
    expect(chooseWork(running, now)).toBe('continue-sweep')
  })
})
