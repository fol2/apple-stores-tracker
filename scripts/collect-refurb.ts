/**
 * Read one market's refurbished catalogue into `data/snapshot.json`.
 *
 *   npx jiti scripts/collect-refurb.ts
 *
 * Six requests, the same ones the cron makes.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { collectRefurb } from '../src/scrape/refurb'
import { RequestBudget } from '../src/scrape/sweep'
import { MARKETS, REFURB_MARKET } from '../src/shared/markets'

const market = MARKETS.find((m) => m.id === REFURB_MARKET)!
const collection = await collectRefurb(market, new RequestBudget(30))

const snapshot = JSON.parse(readFileSync('data/snapshot.json', 'utf8'))
writeFileSync('data/snapshot.json', JSON.stringify({ ...snapshot, refurb: collection }))

console.log(`${collection.listings.length} listings, ${collection.errors.length} categories failed`)
for (const error of collection.errors) console.log(`  ${error.category}: ${error.message}`)
