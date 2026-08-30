/**
 * Publish a locally collected snapshot: prices to KV, changes to D1.
 *
 * The Worker used to do this at the end of a cron sweep. It never once got
 * there -- parsing a store page costs about 1.8ms of cold CPU, a full sweep
 * needs some five CPU-seconds, and a free plan's cron can spend 4.8 in a whole
 * day. So the collection runs where there is no such ceiling and hands the
 * result over here.
 *
 *   npx jiti scripts/collect.ts
 *   npx jiti scripts/collect-refurb.ts
 *   npx jiti scripts/publish.ts
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packOffers } from '../src/shared/offers'
import { changedPoints, type PricePoint } from '../src/shared/diff'
import { historyStatements, ROWS_PER_FILE } from '../src/shared/history-sql'
import type { StoredOffer } from '../src/shared/offers'

/**
 * Credentials come from the environment and are never read by anything that
 * prints. On a runner the Action supplies them; on a laptop a gitignored
 * `.env` does -- see `.env.example`. Node loads it natively, so there is no
 * dotenv here to go stale.
 */
if (existsSync('.env')) process.loadEnvFile('.env')

const local = JSON.parse(readFileSync('data/snapshot.json', 'utf8'))
const scratch = mkdtempSync(join(tmpdir(), 'publish-'))
const wrangler = (...args: string[]) =>
  execFileSync('npx', ['wrangler', ...args], { stdio: ['ignore', 'pipe', 'inherit'] }).toString()

/**
 * Stored packed, as `shared/offers.ts` describes: `configKey` and `sourceUrl`
 * restate the other fields and are rebuilt on read. Collecting yields whole
 * offers, so the packing happens here -- without it this writes a third more
 * bytes than KV needs, which on a catalogue carrying every Mac's memory and
 * storage matrix is 17.6MB against a 25MB ceiling.
 */
const offers = packOffers(local.offers)
const snapshot = {
  collectedAt: local.collectedAt,
  markets: local.markets,
  offers,
  errors: local.errors,
}

// ---------------------------------------------------------------- history

/**
 * Whether anything has ever been charted.
 *
 * `changedPoints` records first sightings and moves, so an empty table with a
 * published snapshot to compare against yields nothing at all, and every chart
 * stays empty until a price happens to move. Treating that as a first run
 * writes the baseline the charts hang off.
 */
function historyIsEmpty(): boolean {
  const out = wrangler('d1', 'execute', 'price-history', '--remote', '--json', '--command',
    'SELECT COUNT(*) AS rows FROM price_point')
  return JSON.parse(out)[0]?.results?.[0]?.rows === 0
}

/** What is published now, so today's changes are measured against it. */
function previousOffers(): StoredOffer[] {
  const file = join(scratch, 'previous.json')
  try {
    if (historyIsEmpty()) {
      console.log('no history recorded yet; taking this snapshot as the baseline')
      return []
    }
    writeFileSync(file, wrangler('kv', 'key', 'get', 'snapshot:latest', '--binding=PRICES', '--remote'))
    return JSON.parse(readFileSync(file, 'utf8')).offers ?? []
  } catch (error) {
    // A first run has nothing published yet. Every price then reads as new,
    // which is exactly right: it is the baseline every later chart hangs off.
    console.log(`no published snapshot to compare against (${error}); treating every price as new`)
    return []
  }
}

/**
 * D1 takes these as a file of statements rather than bound parameters, so the
 * values -- which come from Apple's pages, not from us -- are escaped by hand.
 * `shared/history-sql.ts` holds that escaping and the batching, where a test
 * can reach them.
 */
function writeHistory(points: PricePoint[]): void {
  for (let i = 0; i < points.length; i += ROWS_PER_FILE) {
    const file = join(scratch, `history-${i}.sql`)
    writeFileSync(file, historyStatements(points.slice(i, i + ROWS_PER_FILE)).join('\n'))
    wrangler('d1', 'execute', 'price-history', '--remote', `--file=${file}`, '--yes')
    console.log(`  history: ${Math.min(i + ROWS_PER_FILE, points.length)}/${points.length} rows`)
  }
}

const points = changedPoints(previousOffers(), offers, local.collectedAt.slice(0, 10))
console.log(`${points.length} price changes to record`)
// Written before the prices they describe: a failure here must not leave the
// site publishing a move that nothing charted.
if (points.length > 0) writeHistory(points)

// ---------------------------------------------------------------- prices

const put = (key: string, value: unknown) => {
  const file = join(scratch, `${key.replace(':', '-')}.json`)
  writeFileSync(file, JSON.stringify(value))
  wrangler('kv', 'key', 'put', key, `--path=${file}`, '--binding=PRICES', '--remote')
  console.log(`  wrote ${key}`)
}

put('snapshot:latest', snapshot)
if (local.fx) put('fx:latest', local.fx)
if (local.refurb) put(`refurb:${local.refurb.marketId}`, local.refurb)

console.log(
  `\nPublished ${offers.length} offers across ${local.markets.length} markets` +
    `${local.refurb ? `, ${local.refurb.listings.length} refurbished listings` : ''}` +
    `, ${points.length} history rows.`,
)
