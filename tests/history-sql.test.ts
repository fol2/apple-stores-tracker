import { describe, expect, it } from 'vitest'
import { historyStatements, quote, ROWS_PER_STATEMENT } from '../src/shared/history-sql'
import type { PricePoint } from '../src/shared/diff'

const point = (over: Partial<PricePoint> = {}): PricePoint => ({
  marketId: 'uk',
  familyId: 'macbook-pro',
  store: 'retail',
  configKey: 'memory-dimensionMemory=24gb|storage-dimensionCapacity=512gb',
  currency: 'GBP',
  amount: 1999,
  observedOn: '2026-08-30',
  ...over,
})

/**
 * D1's file interface takes statements, not bound parameters, so every value
 * that reaches it was escaped by hand -- and every value came off an Apple
 * page. This is the seam where a product name decides what SQL runs.
 */
describe('building history statements', () => {
  it('doubles a quote rather than ending the literal early', () => {
    expect(quote("Apple's")).toBe("'Apple''s'")
    // The shape an injection would need: close the literal, start a statement.
    expect(quote("x', 0, '2026-01-01'); DROP TABLE price_point; --")).toBe(
      "'x'', 0, ''2026-01-01''); DROP TABLE price_point; --'",
    )
  })

  it('carries a quote in scraped data through to one intact statement', () => {
    const [sql] = historyStatements([point({ familyId: "apple's-mac" })])
    expect(sql).toContain("'apple''s-mac'")
    // One statement, one terminator: nothing broke out of the VALUES list.
    expect(sql.match(/;/g)).toHaveLength(1)
    expect(sql.match(/INSERT/g)).toHaveLength(1)
  })

  /**
   * The limit that actually bit: 500 rows a statement came back SQLITE_TOOBIG
   * against a real catalogue, so the batching is what keeps a publish working
   * rather than a tidiness preference.
   */
  it('splits into statements no larger than the row limit', () => {
    const points = Array.from({ length: ROWS_PER_STATEMENT * 2 + 1 }, (_, i) =>
      point({ amount: i }),
    )
    const statements = historyStatements(points)
    expect(statements).toHaveLength(3)
    expect(statements[0].match(/\),\(/g)).toHaveLength(ROWS_PER_STATEMENT - 1)
    expect(statements[2].match(/\),\(/g)).toBeNull()
    // Every row survives the split.
    expect(statements.join('').match(/\(/g)!.length - statements.length).toBe(points.length)
  })

  it('replaces rather than duplicates when a day is published twice', () => {
    expect(historyStatements([point()])[0]).toContain('INSERT OR REPLACE')
  })

  it('has nothing to say about no changes', () => {
    expect(historyStatements([])).toEqual([])
  })
})
