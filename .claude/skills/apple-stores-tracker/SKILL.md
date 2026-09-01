---
name: apple-stores-tracker
description: Repository-specific architecture, invariants, commands, and evidence for Apple Store price collection, comparison, Worker/API/MCP behaviour, UI, migrations, and Cloudflare operations.
---

# Apple Stores Tracker Skill

Load this skill only for product code, scraping, price data, Worker/API/MCP, UI, migration, scheduler, or deployment work. Process details live in `docs/agents/ai-sdlc.md`; do not duplicate them in task prompts.

## Architecture map

- `src/scrape/`: Apple selector/configurator and refurbished-grid parsing, provider requests, shared throttling, bounded retries, and `RequestBudget`.
- `src/shared/`: stable types, markets/stores, product families, conversion/refund logic, and price diffs.
- `src/worker/`: Cloudflare Worker HTTP/API/MCP entry point, KV/D1 reads, and request-path exchange-rate refresh. The Worker does not collect.
- `src/app/`: React/Vite reader UI and comparison controls.
- `migrations/`: ordered D1 schema history. Never rewrite an applied migration.
- `tests/fixtures/`: captured provider inputs for deterministic fixture-backed tests.
- `tests/`: parser, shared logic, request planning, scheduling, and MCP contracts.
- `wrangler.jsonc`: production Worker, assets, route, KV, and D1 binding authority.
- `.github/workflows/collect.yml` + `scripts/collect.ts`, `scripts/collect-refurb.ts`, `scripts/publish.ts`: the daily collection, which runs off Cloudflare because a free plan's cron cannot afford it.

## Standard commands

```bash
npm run check:governance
npm test -- tests/apple.test.ts
npm test -- tests/shared.test.ts
npm test -- tests/plan.test.ts
npm test -- tests/schedule.test.ts
npm test -- tests/mcp.test.ts
npm test -- tests/worker/rates.test.ts
npm test -- tests/secondhand.test.ts
npm test
npm run build
npm run ci
```

`npm run ci` is the complete maintained local gate. Normal tests and CI make no live Apple, FX, Cloudflare, KV, D1, DNS, or credentialed request.

## Price identity and source invariants

- One comparison row represents the same stable `configKey` in each market. Never compare labels, part numbers, or merely similar configurations as though they were identical — and never let the same configuration key unalike. Both directions break the comparison; only the second one hides, because a market that produces a key no other market produces simply reads as "not sold".
- A configuration's shape is decided once for the whole catalogue. The dimension set comes from the structure discovered once and reused for every market; a market's own page supplies that market's prices and labels, never the identity. Re-deriving the shape from the page being priced is what made every US iPad read "not sold".
- Whether a dimension is price-relevant is judged per family and globally: prices are compared only inside one market and store, but the verdict holds for every market. A dimension anyone charges for anywhere is carried everywhere. A field a SKU does not carry is absent, which is not the same as an option that costs nothing.
- Preserve market, store (`retail` or `education`), local currency, amount, dimensions, part number, and source URL provenance.
- Build-to-order families use one configurator request per chip/model variant and expand additive deltas into the hardware matrix. Catalogue families read embedded market-page prices.
- Do not include bundled software as hardware configuration dimensions.
- Education prices remain a distinct store identity. Do not quietly replace retail price, and do not request known education-ineligible families such as iPhone.
- Second-hand listings are matched, never keyed: the refurbished grid's facets and a configuration's dimensions overlap without either containing the other. A match must pin every facet both sides name, check the processor against the listing title, and report the price-driving facets it could not pin. Never present an unpinned match as the same machine or subtract its price as a saving without that qualification.
- Partial errors remain visible. Never manufacture completeness by carrying an unrelated offer into a missing market/family/store result, and never let a failed read render as a product fact: a market whose page did not answer is unread, not a market Apple does not sell in.

## Provider and request-budget invariants

- Keep the contactable scraper user agent.
- Preserve shared origin-wide cool-off and throttling treatment for HTTP 429, 503, and Apple's 541 response.
- Preserve bounded retries, pool size three, and pacing unless an authorised measured experiment demonstrates a safer policy.
- Every outbound attempt, including retries, spends from `RequestBudget`.
- Collection runs on a GitHub runner, not the Worker: parsing a page costs ~1.8ms of cold CPU and a full sweep ~5 CPU-seconds, against the 4.8 a free plan's cron can spend in a day. Do not move collection back into the Worker without that budget changing.
- Assembly/history work is also bounded. Large first-run or migration backlogs must drain over later ticks rather than publish a snapshot and silently lose history.
- Live Apple compatibility or politeness claims require an explicitly authorised, bounded read-only probe with a stated request budget and stop rule. They never run in routine CI.

## Data and migration invariants

- KV owns the current snapshot, exchange rates, and refurbished listings. There is no sweep state.
- D1 owns changed historical price points rather than daily rewrites of unchanged data.
- Price-history identity includes market, family, store, configuration, and observation date.
- Add a new ordered migration for schema changes. Never edit an already-applied migration to make a fresh database look correct.
- A schema or API change needs compatibility acceptance, migration proof, and tests against both existing and new identity assumptions.

## Refund and reader-trust invariants

- Official Apple list price is source data; currency conversion and tourist refund amounts are estimates.
- Keep country scheme availability separate from confirmed participation by Apple's own stores.
- Unverified participation must remain visibly uncertain. Do not turn general country policy into a confident Apple-specific claim.
- US list prices exclude sales tax; do not present one national percentage or a concrete tax-adjusted total without location-specific evidence.
- Warranty, keyboard, plug, stock, import duty, and eligibility caveats remain separate from the mathematical ranking.

## API, MCP, and UI evidence

- The Worker is the authority for site/API/MCP responses; the workflow is the authority for collection.
- The MCP endpoint is stateless and read-only unless an explicit public-contract change says otherwise.
- API/MCP behaviour needs request/response tests; source presence is insufficient.
- UI logic changes need deterministic tests where possible, a successful production build, and visual inspection when layout, hierarchy, readability, or mobile containment is claimed.
- A screenshot proves only the captured composition; it does not prove parser, conversion, scheduling, or history correctness.

## External-effect boundary

These commands or effects require explicit task authority and current target verification:

```bash
npm run deploy
npm run db:migrate
npx wrangler ... --remote
```

The same applies to credential use, KV/D1 mutation, DNS/custom-domain change, workflow-schedule change, and a broad live sweep. State the rollback or fail-closed stop before acting and observe the resulting production state afterwards.
