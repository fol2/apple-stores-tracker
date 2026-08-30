/**
 * Ask eBay one real question and report what came back.
 *
 * `src/scrape/ebay.ts` was written against eBay's published response example,
 * not against a live call. This closes that gap: it runs one search, reports
 * which fields the response actually carries, and shows what the parser made
 * of them -- so a contract drift shows up here rather than as a silently empty
 * second-hand tab.
 *
 *   npx jiti scripts/probe-ebay.ts "MacBook Pro M4"
 *
 * Needs EBAY_CLIENT_ID and EBAY_CLIENT_SECRET. Prints structure, prices and
 * titles -- never the credentials, which only ever reach the token exchange.
 */
import { existsSync } from 'node:fs'
import { applicationToken, parseListings, MARKETPLACE, REFURBISHED_CONDITIONS } from '../src/scrape/ebay'

if (existsSync('.env')) process.loadEnvFile('.env')

// Trimmed: a credential pasted into a secret field often carries a trailing
// newline, and eBay rejects the pair without saying which half was wrong.
const clientId = process.env.EBAY_CLIENT_ID?.trim()
const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim()
if (!clientId || !clientSecret) throw new Error('EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set')

/**
 * An App ID names its environment in its own segment --
 * `Name-app-PRD-1a2b3c4d5-6e7f8g9h`, or `-SBX-` for Sandbox. Matched on the
 * delimited segment rather than anywhere in the string, so a Production key
 * whose trailing hash happens to contain those three letters is not rejected.
 *
 * Worth checking at all because Sandbox lists nothing real, and an empty
 * result is indistinguishable from "nobody is selling this" -- a wrong answer
 * that looks like a finding.
 */
if (clientId.includes('-SBX-')) {
  throw new Error('the App ID is a Sandbox key (-SBX-); the probe needs the Production keyset')
}

/**
 * The other half names its environment too, as a prefix: `PRD-...` or
 * `SBX-...`. Checked separately because the halves are copied from separate
 * fields, and a Production App ID paired with a Sandbox Cert ID authenticates
 * as neither -- eBay answers `invalid_client` and does not say which half it
 * disliked.
 */
if (clientSecret.startsWith('SBX-')) {
  throw new Error('the Cert ID is a Sandbox secret (SBX-); it must match the Production App ID')
}
if (!clientSecret.startsWith('PRD-')) {
  console.log(`note: Cert ID does not begin with PRD- (starts "${clientSecret.slice(0, 4)}")`)
}

const query = process.argv[2] ?? 'Apple MacBook Pro M4'
console.log(`app id: ${clientId.slice(0, 12)}...${clientId.slice(-4)} (${clientId.length} chars)`)
console.log(`secret:  ${clientSecret.length} chars`)

const token = await applicationToken(clientId, clientSecret)
console.log(`✓ token obtained (${token.length} chars)`)

const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search')
url.searchParams.set('q', query)
url.searchParams.set('limit', '10')
url.searchParams.set('sort', 'price')
url.searchParams.set('filter', `conditionIds:{${REFURBISHED_CONDITIONS.join('|')}}`)

const response = await fetch(url, {
  headers: {
    authorization: `Bearer ${token}`,
    'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE,
    accept: 'application/json',
  },
})
console.log(`✓ search returned HTTP ${response.status}`)
if (!response.ok) {
  console.log(await response.text())
  throw new Error(`search failed: ${response.status}`)
}

const body = (await response.json()) as Record<string, unknown>
console.log(`\ntop-level keys: ${Object.keys(body).join(', ')}`)
console.log(`total: ${body.total}`)

const summaries = (body.itemSummaries ?? []) as Record<string, unknown>[]
console.log(`itemSummaries: ${summaries.length}`)

if (summaries[0]) {
  console.log(`\nfields on the first summary:\n  ${Object.keys(summaries[0]).sort().join('\n  ')}`)
  // The detail the parser depends on and a guess would get wrong.
  const price = summaries[0].price as Record<string, unknown> | undefined
  console.log(`\nprice.value is a ${typeof price?.value} (${JSON.stringify(price?.value)})`)
  console.log(`conditionId is a ${typeof summaries[0].conditionId}`)
}

const listings = parseListings(body)
console.log(`\nparser kept ${listings.length} of ${summaries.length}:\n`)
for (const l of listings) {
  console.log(`  ${l.currency} ${String(l.amount).padStart(9)}  [${l.conditionId}] ${l.condition}`)
  console.log(`      ${l.title.slice(0, 84)}`)
  console.log(`      seller ${l.sellerFeedbackPercent ?? '—'}% / ${l.sellerFeedbackScore ?? '—'}${l.url ? '' : '   NO URL'}`)
}
if (listings.length === 0) console.log('  (none) -- nothing matched, or the shape has changed.')
