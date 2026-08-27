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

One Cloudflare Worker serves the site, the API and the MCP endpoint, and runs the sweep on
a cron trigger.

```
cron (*/15) ─► one step per tick ─┬─ discover  : read all 29 selectors once
                                  ├─ <market>  : price one market  → KV raw:<id>
                                  └─ assemble  : merge, diff, store → KV snapshot:latest
                                                                      D1 price_point
```

A full pass is 17 steps, then the Worker idles until the last pass is twelve hours old.
Splitting by market keeps each invocation well inside the subrequest limit and makes a
failed market a cheap retry rather than a lost sweep.

**KV** holds the snapshot — one blob, read on every request, cached at the edge.
**D1** holds history, and only rows that *changed*: Apple prices barely move, so writing
every configuration every day would be ~90k rows to record that nothing happened.

Exchange rates come from `open.er-api.com` (keyless, daily). It is the only free feed that
covers every currency here — the ECB feeds, and anything built on them, have no TWD.

## Development

```bash
npm install
npx jiti scripts/collect.ts uk us jp   # collect real prices into data/snapshot.json
npm run dev                            # Vite serves that file as /api/snapshot
npm test                               # parser, refund maths, history diff, MCP
```

`scripts/collect.ts` runs the same code as the cron, from a terminal. Omit the market
arguments to sweep all 15 (about ten minutes, deliberately paced).

## Deploying

```bash
npx wrangler kv namespace create PRICES
npx wrangler d1 create price-history
# put both ids in wrangler.jsonc
npm run db:migrate
npm run deploy
```

The custom domain is declared in `wrangler.jsonc`; Wrangler creates the DNS record in the
`eugnel.com` zone on first deploy. Scheduled runs need the Workers Paid plan — parsing 29
selector pages does not fit the free plan's 10ms CPU budget.

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
