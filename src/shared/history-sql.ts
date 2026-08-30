import type { PricePoint } from './diff'

/**
 * Two limits, not one: D1 rejects an over-long statement with SQLITE_TOOBIG,
 * and each `execute` is a round trip worth amortising. So rows are grouped
 * into modest statements and many statements go up in one file.
 *
 * A row measures 242 bytes on average and 319 at its longest, most of it the
 * configKey, so a hundred of them is 31KB at worst -- comfortably inside the
 * limit that rejected 500.
 */
export const ROWS_PER_STATEMENT = 100
export const ROWS_PER_FILE = 10_000

/**
 * SQLite's own escape, and the only one it has: a literal quote is doubled.
 *
 * This matters more than it looks. D1's file interface takes statements, not
 * bound parameters, and every value here was read off an Apple page -- family
 * ids, dimension names, currency codes. An apostrophe in any of them would end
 * the literal early and corrupt the rest of the statement.
 */
export const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`

/**
 * `amount` is interpolated as a bare number, and is the one value here that
 * does not go through `quote()`.
 *
 * That is safe rather than an oversight: every amount originates in
 * `JSON.parse` of an Apple response, which cannot produce NaN or Infinity, and
 * `expandVariant` only ever sums deltas it has already found in the priced
 * options (`apple.ts`, `v.value in available`). A quoted number would also
 * bind as text and silently break `ORDER BY` on the column.
 */
const row = (p: PricePoint): string =>
  `(${quote(p.marketId)},${quote(p.familyId)},${quote(p.store)},${quote(p.configKey)},` +
  `${quote(p.currency)},${p.amount},${quote(p.observedOn)})`

/**
 * One file's worth of INSERTs, as a list of statements.
 *
 * `INSERT OR REPLACE` because a day's second run must correct the first rather
 * than duplicate it -- the table's key is the configuration and the day.
 */
export function historyStatements(points: PricePoint[]): string[] {
  const statements: string[] = []
  for (let i = 0; i < points.length; i += ROWS_PER_STATEMENT) {
    statements.push(
      `INSERT OR REPLACE INTO price_point
   (market_id, family_id, store, config_key, currency, amount, observed_on)
 VALUES ${points.slice(i, i + ROWS_PER_STATEMENT).map(row).join(',')};`,
    )
  }
  return statements
}
