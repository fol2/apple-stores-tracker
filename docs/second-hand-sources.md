# Second-hand sources

**Status:** decision record. Apple's refurbished store is the only source in use.
**Last checked:** 2026-08-28

Every source below was probed directly, not assumed. Re-probe before re-litigating —
these are edge rules and terms, and they change.

## In use

**Apple Certified Refurbished** (`apple.com/uk/shop/refurbished/<category>`). Keyless, six
requests for the whole UK catalogue, permitted by `apple.com/robots.txt` under
`User-agent: *`, and — the reason it is worth more than its coverage — every unit carries a
part number and Apple's own facet map. That is what lets a match be checked rather than
asserted. See the second-hand section of `README.md`.

## Rejected, with the evidence

| Source | Finding | Date |
| --- | --- | --- |
| CeX (`wss2.cex.uk.webuy.io`) | Cloudflare WAF block: "Sorry, you have been blocked" | 2026-08-27 |
| Back Market | `robots.txt` disallows `*/ws/` and `*/bm/` — the paths its own site calls; category pages return 403 | 2026-08-28 |
| musicMagpie | Cloudflare challenge ("Just a moment…"); `robots.txt` also disallows `/Mac*` | 2026-08-28 |
| Amazon Renewed | `robots.txt` carries `Disallow: /` for ~90 named automated agents (ClaudeBot, GPTBot, PerplexityBot, Crawl4AI, xAI-Grok, ChatGPT-User…); a Renewed search returns HTTP 200 with zero results, being rendered client-side | 2026-08-28 |
| CamelCamelCamel | Cloudflare challenge; `robots.txt` opens with a content-signals licence. Also a mirror of Amazon — reading it would do indirectly what Amazon disallows directly | 2026-08-28 |

A bot challenge is an access decision by the site, not a technical obstacle to route around.
None of these are revisitable by changing headers or user agent; they are revisitable by
asking the operator for access.

CeX is the most trusted second-hand name in the UK — high street presence, 24-month
warranty, and the reference most buyers price against. If a second source is ever worth
real effort, asking CeX directly is a better use of it than any amount of engineering.

## Backlog: eBay

The one source that publishes an interface for this. Free, 5,000 Browse API calls a day, no
scraping and nothing to evade. **Blocked on credentials, which are the owner's to create.**

The owner has applied for a developer account (2026-08-28). When the keys exist:

1. `developer.ebay.com` → Application Keys → **Production** keyset → App ID (Client ID) and
   Cert ID (Client Secret).
2. The owner stores them; they must not pass through an agent:
   ```bash
   npx wrangler secret put EBAY_CLIENT_ID
   npx wrangler secret put EBAY_CLIENT_SECRET
   ```
3. Then build: OAuth client-credentials exchange for an application token (scope
   `https://api.ebay.com/oauth/api_scope`, cached in KV — it lasts about two hours), then
   `GET /buy/browse/v1/item_summary/search` with `X-EBAY-C-MARKETPLACE-ID: EBAY_GB`,
   filtered to Certified Refurbished.

### The constraint that must survive the build

eBay listings are seller-written titles with no part number. They cannot support the claim
Apple's units support, and the tab's whole design is about not making claims it has not
checked — four review rounds went into that. An eBay unit therefore belongs in its own
lower tier, described as *listings matching this description*, never as *this
configuration, used*, and never subtracted from a new price as a saving without that
qualification.

The existing `exact` / `unpinned` / `unconfirmed` reporting in `src/shared/secondhand.ts`
is the shape to extend, not to work around.
