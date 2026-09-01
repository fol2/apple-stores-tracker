---
title: US iPad and iPhone rows read not sold because configKey was derived per market
date: 2026-09-01
category: logic-errors
module: scrape/apple
problem_type: logic_error
component: service_object
symptoms:
  - The United States row read not sold for iPad Pro, and in fact for every iPad family and most iPhone families
  - US iPad Pro collapsed from 96 SKUs to 12 Wi-Fi-only configurations, silently dropping every cellular price
  - US configKeys omitted dimensionConnection, so they matched no key any other market produced
  - Other markets rendered the same hardware normally, so the snapshot looked complete rather than wrong
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - config-key
  - cross-market-comparison
  - apple-scraper
  - price-relevance
  - dimensions
  - us-store
  - catalogue-families
  - publish-guard
---

# US iPad and iPhone rows read not sold because configKey was derived per market

## Problem

This repo compares one hardware configuration's price across fifteen Apple markets. A comparison row is a `configKey` — the offer's dimensions sorted and joined (`configKeyOf`, `src/shared/offers.ts:6`):

```ts
export const configKeyOf = (dimensions: DimensionValue[]): string =>
  dimensions.map((d) => `${d.field}=${d.value}`).sort().join('|')
```

That key is the join column between markets. A market whose parser produces a key no other market produces has no cell in any row, and the UI rendered the absence as **not sold** (`src/app/components/MarketTable.tsx:122`), captioned "Apple does not list this configuration in this market."

The key was being derived per market, from that market's own page. So the join column was market-dependent — a contradiction in terms: any market whose page differed structurally from the rest silently deleted itself from every comparison, and did so while looking like a fact about Apple's catalogue.

## Symptoms

The report was one line: "ipad pro united status not sold?". The blast radius was much larger:

- Every US row of all four iPad families read *not sold*.
- Every US iPhone row read *not sold* too — by a **different** mechanism reaching the same key mismatch.
- The US iPhone spec picker leaked raw Apple ids into the UI for every visitor in every market (`ATT_IPHONE17`, `TMOBILE_IPHONE17`, `UNLOCKED/US`), because the carrier step had been promoted to a real dimension.

Two root causes, one visible symptom — worth stating plainly, because the first was found and fixed before anyone noticed the second. **The symptom is "a market's keys do not intersect the others'", and any number of mechanisms can produce it.**

### Cause 1 — a dimension that looked free (iPads)

`parseCatalogOffers` re-derived which dimensions are price-relevant from each market's page, via `priceRelevantFields`. The old test grouped SKUs by "all the other fields at once" and asked whether any group held two distinct prices (`src/scrape/apple.ts` at `1e97a72`):

```ts
// before
return fields.filter((field) => {
  const groups = new Map<string, Set<number>>()
  for (const product of products) {
    const key = fields.filter((f) => f !== field).map((f) => source[f]).join('|')
    // …collect this SKU's price into that group
  }
  return [...groups.values()].some((seen) => seen.size > 1)
})
```

Apple's US store adds a `carrierModel` step that **only cellular iPads carry**: a Wi-Fi SKU has no carrier value at all, its cellular twin does. Grouping on "every other field" therefore never put a Wi-Fi price and a cellular price in the same group — the absent value joins as an empty segment, so the two SKUs' group keys differ. No group held two prices, `dimensionConnection` looked free, and it was dropped. All 96 US iPad Pro SKUs collapsed onto 12 Wi-Fi configurations keyed with no connectivity at all, while the UK keyed the same machines *with* `dimensionConnection=wifi`. Zero overlap.

### Cause 2 — the same handset sold twice (iPhones)

Apple's US store lists a cellular device once per carrier ($799 on AT&T/T-Mobile/Verizon) and once SIM-free ($829). Here `carrierModel` was *genuinely* price-relevant — the prices really do differ — so the relevance test correctly kept it, and US iPhones were keyed on a step no other market has. Same *not sold*, second route. Naively taking the cheaper line would have compared a carrier contract against the bare £799 machine beside it.

## What Didn't Work

Four dead ends worth keeping, because each is the obvious move.

1. **Patching only the reported family.** The report named iPad Pro. The same root cause covered four iPad families, and a second mechanism covered the iPhones. Grepping every caller of `priceRelevantFields` before editing is what turned a one-row bug report into a two-cause fix.

2. **Deciding relevance per market.** This *is* the status quo that caused the bug — it only looks defensible until you name a second instance of it. Apple's Irish education store charges €2 more for two iMac colours, so a per-market verdict would keep colour in Ireland and drop it in the other fourteen: the same divergence, a new market vanishing. Pinned by `tests/offers.test.ts` ("keeps a finish everywhere when one market charges for it").

3. **The first draft of the collapse rule** (the payload work, PR #18): *"a dimension is unpaid if no pair differing only in it ever changes the price."* This deleted a Mac's **chip**. The chip always moves with its core count, so no pair of offers differs in the chip alone, so the rule found no evidence anyone pays for it — it would have deleted the word "M6" from the page while merging exactly zero offers. The rule needed a second half. Pinned by `tests/offers.test.ts` ("keeps a dimension that never varies alone").

4. **Dropping colour unconditionally.** Tempting — colour is *usually* free — and wrong: some colour-bearing configuration groups genuinely differ in price. A one-off count over the collected snapshot during this work put it at 32 of 5,070 groups, all of them the Irish education iMac; the qualitative fact is confirmed in the PR #18 evidence. A special case for colour would also not have generalised to connectivity, which is the field that actually broke.

## Solution

Three merged PRs, in escalating depth.

**PR #16 — fix both mechanisms.** For the iPads, compare *pairs* of SKUs that differ in exactly one **shared** field, treating a field one side does not carry as agreement rather than disagreement (`priceRelevantFields`, `src/scrape/apple.ts:287`):

```ts
// after
const agreesElsewhere = (a, b, field) =>
  fields.every((f) => f === field || a[f] === b[f] || a[f] === undefined || b[f] === undefined)

return fields.filter((field) =>
  priced.some((a, i) => priced.slice(i + 1).some((b) =>
    a.price !== b.price &&
    typeof a.source[field] === 'string' && typeof b.source[field] === 'string' &&
    a.source[field] !== b.source[field] &&
    agreesElsewhere(a.source, b.source, field))))
```

For the iPhones, read only the SIM-free line — Apple labels it per SKU, so no heuristic is needed (`src/scrape/apple.ts:263`):

```ts
const isSimFree = (product: Record<string, any>): boolean =>
  typeof product.carrierPolicyType !== 'string' || product.carrierPolicyType === 'UNLOCKED'
```

Plus a guard so the by-part price fallback cannot hand a carrier-contract price to a SIM-free part number — contract and SIM-free price entries list the *same* part numbers in `validProducts`, so a SKU missing its own price key would otherwise silently take the contract price.

**PR #19 — remove the class of bug.** #16 fixed the two instances; it did not close the door. Identity now comes from the structure discovered **once for the whole catalogue** and is passed in as a required parameter, rather than re-derived from the page being priced (`parseCatalogOffers`, `src/scrape/apple.ts:363`). The structure is discovered from one market — `discoverStructures(MARKETS[0], budget)` (`scripts/collect.ts:25`), `MARKETS[0]` being the UK — and threaded through `collectFamilies` into the parser (`src/scrape/sweep.ts:197`). Each market's page still supplies its own **prices** and its own **labels** (`catalogLabel`, `src/scrape/apple.ts:322`), so translations survive even for a dimension that market's own prices would not have judged worth carrying. Where a market prices something the catalogue does not carry, its extra SKUs land on one key and the **cheapest** is quoted — an arbitrary first row would have been a coin flip between two real prices.

**PR #18 — the same question, asked once globally.** Asking "is this dimension paid for?" across the whole catalogue rather than per page also revealed that Apple lists finishes as priced options even when every finish costs the same: 10,890 of 22,442 offers were colour duplicates. `collapseUnpaidDimensions` (`src/shared/offers.ts:129`), on top of `paidDimensions` (`src/shared/offers.ts:89`), drops them — 22,442 → 16,592 offers, 18.6MB → 12.9MB against KV's 25MB value limit. The rule's two halves are visible in the code: `varies` records that *some* pair differed in this field alone, and a bucket holding two distinct amounts records that such a pair differed in price. A field that never varies alone returns `!varies === true` and is kept.

The publish guard had to learn the same distinction: it refuses a collection that lost too much of the catalogue, and a deliberate 26% shrink describing identical machines would have tripped it every day. It now collapses the published side too, so it compares machines rather than rows (`src/shared/publish-guard.ts`).

## Why This Works

The key is a join column. A join column each side computes for itself from its own local evidence is not a join column — it is fifteen incomparable local ids that happen to look alike most of the time. Both mechanisms here are the same failure: local evidence (this market's price spread) was allowed to decide global identity (what a configuration *is*).

Once identity is decided once, from evidence pooled across the catalogue, the two mechanisms lose their power independently of whether anyone anticipated them:

- The US carrier step can no longer promote itself into a dimension, because dimensions are no longer read from the US page.
- A future market that charges for something everyone else gives away can no longer key its machines uniquely; its extra SKUs fold onto the shared key and the cheapest price wins.
- Absence is handled explicitly. `agreesElsewhere` and `paidDimensions` both treat "this SKU does not carry that field" as *no information*, never as a value. That distinction is what made the original grouping wrong, and `tests/offers.test.ts` pins the same distinction on the collapse side: the base iMac has no nano-texture option at all, and reading that absence as a value would merge two different machines whenever they happen to cost the same.

Prices and labels stay local because they genuinely are local — currency and translation are per market. Only identity is global. That split is the whole fix.

## Prevention

**The transferable rule: the identity of a cross-instance comparison key must be decided once, from evidence pooled across all instances, never re-derived per instance.** Each instance may contribute values (its price, its label, its translation), but never the *schema* of the key. If instance A can compute a key that instance B could not have computed, A silently drops out of every comparison — and it will do so quietly, rendering as a plausible domain fact ("not sold here") rather than as an error. This generalises well past scraping: partition keys derived from per-shard schema, dedup hashes computed from per-source field sets, join keys built from whatever columns a given feed happens to include.

**This class had already shipped once here, and was not recognised as a class.** (session history) In PR #8, three Mac families lost memory and storage entirely because Apple ships a configurable option in one of two places — top-level `configSections`, or nested inside a `customizableSpecs` group that carries no values of its own — and the parser read only the top level. Same shape: the dimension set was taken from the incidental layout of one page, so families whose page had a local quirk ended up keyed differently from their siblings. The regression test for it still lives in `tests/apple.test.ts` ("options nested inside a collapsed group"). The lesson the first occurrence did not produce, and this one did, is that **the fix is not another special case — it is removing the per-page derivation.**

Corollary on rendering: when a comparison shows *nothing* for one instance, suspect the key before you suspect the data. "Absent", "unavailable" and "not collected" are three different facts. This repo separated them in PR #17, so a market whose page failed to answer now reads "no answer" (`src/app/components/MarketTable.tsx:117`) instead of the false claim "not sold". The same session-history record shows an earlier variant of the same trap: adding the `store` dimension while KV still held a snapshot written before that field existed made the page render **completely empty while the server returned HTTP 200** and every health check passed. (session history)

Concrete guardrails now in the repo:

- **The shared-structure parameter.** `structure: FamilyStructure` is a *required* positional parameter of `parseCatalogOffers`, sitting before the optional `store`. Re-introducing per-page identity means deleting a required parameter — a type error, not a silent behaviour change.
- **The two-part collapse rule.** `paidDimensions` drops a field only when *both* hold: some pair differs in that field alone, **and** every such pair costs the same. Its verdict is per family and global across markets and stores, with prices only ever compared inside one market and store (two currencies say nothing about each other).
- **Tests that fail if either regresses.** `tests/apple.test.ts`: "a market that adds a step only some SKUs answer" (connectivity must survive at $200; carrier and colour must stay out of the key), "a market that sells the same handset on contract" (the SIM-free machine at $829, keyed as every other market keys it), "a market that prices an option the catalogue does not carry" (keys the shared way, quotes the cheaper price, keeps its own labels). `tests/offers.test.ts`: a finish charged for in one market is kept in every market; a dimension that never varies alone survives; a missing option is not a free one.
- **Fixtures for the shapes that broke it,** trimmed from live pages: `tests/fixtures/apple-us-ipad-pro-select.html`, `tests/fixtures/apple-us-iphone-17-select.html`. Before these, every fixture was a UK page — so no test could observe a key disagreement between markets, and the whole suite (173 tests at the time) passed against a site where a whole market read "not sold".
- **The gate.** `npm run ci` runs the governance contract, the full suite, then `tsc -b && vite build`.

One accepted residual, recorded in the PR #16 and #18 bodies: corrected configurations re-key, so historical price rows written under the old keys are orphaned and the affected charts restart at the next sweep. Backfilling would mean rewriting history under keys that were never comparable.

## Related Issues

- PR #16 (`eaf3731`) — both mechanisms fixed: pairwise price-relevance, SIM-free-only US reads.
- PR #17 (`58a0362`) — "no answer" versus "not sold"; not a cause, but the reason the bug stayed invisible.
- PR #18 (`b8fbc2c`) — dimensions nobody pays for collapsed globally; publish guard counts machines, not rows.
- PR #19 (`7fb79e6`) — identity comes from one shape discovered for the whole catalogue.
- `.claude/skills/apple-stores-tracker/SKILL.md` — "Price identity and source invariants" states the goal ("one comparison row represents the same stable `configKey` in each market") but guards only the false-equality direction: treating unlike configurations as identical. The inverse failure this bug took — the same configuration keyed unalike — is not named there, and nothing in the section says where a configuration's *shape* comes from, which is what PR #19 made a global fact. (Its sentence about catalogue families reading market-page prices remains correct: prices are still read per market; only identity moved.) Refresh candidate.
- `docs/agents/ai-sdlc.md` — the evidence table already requires a "`configKey` unit/property test" for cross-market identity. That was satisfied literally by a single-market fixture the whole time this bug shipped. Refresh candidate: require fixtures from more than one market.
- `README.md` — offer-count and snapshot-size figures predate PR #18, and its description of collapsing price-irrelevant dimensions does not say the verdict is global across markets. Refresh candidate.
