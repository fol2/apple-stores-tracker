/**
 * Push a locally collected snapshot into the deployed KV namespace.
 *
 * A fresh deployment would otherwise show nothing until the cron has walked a
 * whole sweep, which takes hours by design. This is bootstrap only — after it,
 * the Worker's own schedule keeps the data current.
 *
 *   npx jiti scripts/seed.ts
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const local = JSON.parse(readFileSync('data/snapshot.json', 'utf8'))
const scratch = mkdtempSync(join(tmpdir(), 'parity-'))

const put = (key: string, value: unknown) => {
  const file = join(scratch, `${key.replace(':', '-')}.json`)
  writeFileSync(file, JSON.stringify(value))
  execFileSync(
    'npx',
    ['wrangler', 'kv', 'key', 'put', key, `--path=${file}`, '--binding=PRICES', '--remote'],
    { stdio: 'inherit' },
  )
}

put('snapshot:latest', {
  collectedAt: local.collectedAt,
  markets: local.markets,
  offers: local.offers,
  errors: local.errors,
})

if (local.fx) put('fx:latest', local.fx)

console.log(`\nSeeded ${local.offers.length} offers across ${local.markets.length} markets.`)
