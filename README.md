# Parity

Compare the price of one **exact** Apple configuration across 15 official Apple Store
markets, converted to pounds, with tourist tax-refund estimates and price history.

Live at [apple-price-tracker.eugnel.com](https://apple-price-tracker.eugnel.com).

Independent, and not affiliated with Apple.

## How it gets prices

Apple ships two kinds of product selector, and the scraper handles both:

**Build-to-order** (every Mac). The select page carries the option matrix but no prices
for upgrades. Prices come from Apple's own configurator endpoint:

```
GET https://www.apple.com{market}/shop/api/cto/update-config
      ?collection=MAC_MINI_2026_COLLECTION&fae=true&sv.<dimension>=<value>…
```

It needs no session and returns the selected build's price plus every option's delta from
it. Those deltas are additive — with 16GB selected, 24GB reads `+200`; select 24GB and the
base rises by exactly 200 while the storage deltas stay put — so

```
price(configuration) = base + Σ delta
```

and **one request yields a chip variant's entire matrix**. A Mac mini's 84 configurations
cost three requests, not eighty-four.

**Catalogue** (iPhone, iPad, Watch, Vision, AirPods, displays, TV & Home). A fixed set of
SKUs whose prices are already embedded in the select page, so pricing a market is one
request per family. Dimensions that never change the price — colour, almost always — are
collapsed, so 21 iPhone SKUs become 7 configurations.

`apple.com/robots.txt` disallows only `/*shop/browse/overlay/*`; these paths are permitted.
The scraper identifies itself, runs three requests at a time, and shares one cool-off
across all workers when Apple answers a burst with HTTP 541.

## How it runs

One Cloudflare Worker serves the site, the API and the MCP endpoint, and does its
collecting from a cron trigger. The work is layered, because the three things it needs to
keep current move at completely different speeds.

```
cron (*/3) ─► whichever tier is most overdue
  │
  ├─ 1. continue a sweep   in progress?      one planned batch
  ├─ 2. refresh rates      > 1 hour old?     1 request
  ├─ 3. full sweep         > 7 days old?     ~90 batches, ~4.6 hours
  ├─ 4. probe              > 2 hours old?    one rotating slice, ~15 requests
  └─    otherwise idle
```

**Rates** cost one request and every converted figure depends on them, so they refresh
hourly. **Prices** cost ~1,245 requests to read in full but change a handful of times a
year, so scanning on a timer would spend that budget over and over to learn that nothing
happened. Between the two sits the **probe**: it re-reads one rotating slice and compares
it with the stored snapshot. Apple moves many prices at once when it moves any, so a slice
is enough to notice, and a full sweep only runs when there is something to find. A forced
weekly sweep is the backstop, since comparing prices cannot reveal a product Apple has
only just added.

Steady state is roughly 200 requests a day rather than 2,500.

A sweep is split into ~90 planned batches, each sized to fit one invocation's subrequest
allowance, so a failed batch is a cheap retry rather than a lost pass. `GET /api/status`
reports where each tier has got to.

**KV** holds the snapshot — one blob, read on every request, cached at the edge.
**D1** holds history, and only rows that *changed*: Apple prices barely move, so writing
every configuration every day would be ~90k rows to record that nothing happened.

Education prices come from Apple's parallel `/<market>-edu` store. Only one market's
education price can apply to any one buyer, since you can only be a student in one
country, so the site adds a second row for the market you claim rather than quietly
substituting the number. iPhone is skipped there: it has no education price, and Apple
answers `541` for it — the same status it uses for throttling — so asking costs six
retries per family per market and yields nothing.

Exchange rates come from `open.er-api.com` (keyless, daily). It is the only free feed that
covers every currency here — the ECB feeds, and anything built on them, have no TWD.

## Development

```bash
npm install
npm run ci                             # governance contract, all tests, production build
npx jiti scripts/collect.ts uk us jp   # authorised live collection into data/snapshot.json
npm run dev                            # Vite serves that file as /api/snapshot
```

`scripts/collect.ts` runs the same code as the cron, from a terminal. Omit the market
arguments to sweep all 15 (about ten minutes, deliberately paced). Live collection is not
part of normal tests or CI.

Development follows the repository-owned AI-native SDLC in [`AGENTS.md`](AGENTS.md), with
the full operating model in [`docs/agents/ai-sdlc.md`](docs/agents/ai-sdlc.md). The default
is one owner, one branch, one PR, proportionate evidence, exact-head review where model
judgement matters, and autonomous merge/cleanup when the task and repository permissions
authorise it. Governance/documentation-only Markdown changes skip dependency installation;
every other change runs the complete fixture-backed tests and production build.

## Deploying

```bash
npx wrangler kv namespace create PRICES
npx wrangler d1 create price-history
# put both ids in wrangler.jsonc
npm run db:migrate
npm run deploy
```

The custom domain is declared in `wrangler.jsonc`; Wrangler creates the DNS record in the
`eugnel.com` zone on first deploy.

This runs on the **Workers free plan**, which is what the batching exists for: an
invocation there gets 50 subrequests, and a retry spends from the same allowance as a
first attempt. `RequestBudget` enforces a ceiling of 30 inside the fetch helper, and
`planSweep` sizes each batch to 15, so throttling costs a family rather than the whole
invocation. Exceeding the cap does not fail one request — it aborts the invocation and
discards everything it had already collected.

## For agents

`POST /mcp` is a stateless Streamable HTTP MCP server with three read-only tools:
`list_catalog`, `list_product_configurations`, `compare_prices`. Setup notes live at
`/agents`, and a plain-text summary at `/llms.txt`.

## A caution about the numbers

Prices are official list prices, and everything else is an estimate. US prices exclude
sales tax. Refund figures assume you qualify for a scheme, meet its minimum spend and
deadlines, and accept the operator's fee. Warranty terms, keyboard layouts, plug types and
stock differ by market, and bringing hardware home may attract import duty. A £300 gap on
this page is not £300 in your pocket.
