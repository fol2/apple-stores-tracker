# Apple Stores Tracker Agent Contract

Apple Stores Tracker is a TypeScript/React/Vite application and Cloudflare Worker that compares one exact Apple configuration across official regional Apple Stores, exposes read-only API/MCP tools, advances a request-budgeted retail/education sweep, stores the current snapshot in KV, and stores changed history in D1.

This is the small always-loaded execution kernel. `docs/agents/ai-sdlc.md` is the development-process single source of truth. Load `.claude/skills/apple-stores-tracker/SKILL.md` only when product code, scraping, data, Worker, migration, UI, or deployment behaviour is in scope.

## Authority and context

Use this precedence:

1. the user's complete instruction or active GitHub issue, including acceptance and non-goals;
2. current invariants in code, tests, migrations, `wrangler.jsonc`, and `README.md`;
3. this file and the one relevant skill;
4. `docs/agents/ai-sdlc.md` and executable routing in `scripts/sdlc/route.mjs`.

Historical commits, closed issues, old PR descriptions, logs, generated files, and rejected experiments are evidence of past work, not current instructions.

Start with the smallest sufficient context: task contract, current head, changed surface, nearby tests, and exact dependency radius. Keep one task capsule containing outcome, non-goals, constraints, acceptance, affected paths, proof map, decisions, exact head, and next action. Do not preload the whole repository, every fixture, reference repositories, or prior transcripts.

## Four-rule objective

1. Apply AI-native SDLC behaviour across plan, design, build, test, integration, and maintenance.
2. Maximise decision quality and throughput while minimising wall time and feedback latency.
3. Minimise model context, repeated investigation, compute, and token consumption.
4. Never obtain 2 or 3 by leaving a reachable material risk without relevant evidence.

“No compromise” means the cheapest decisive evidence for every material claim, not every available check.

- **Under-engineered:** a material risk cannot be falsified by the selected evidence.
- **Over-engineered:** an activity cannot change a decision, catch a reachable defect, or remove recurring critical-path cost at lower lifetime cost than it adds.
- **Right-sized:** the least costly maintained mechanism that observes the risk or removes the bottleneck.

## Autonomous delivery loop

A complete owner instruction or active issue is accepted intent. Do not create a mirror issue or ceremonial `intent.md`, `spec.md`, or `plan.md` when one owner can carry a bounded task end to end. Use a durable artifact only for a real cross-owner handoff, multi-PR programme, audit requirement, automated trigger, or reusable design decision.

For one independently mergeable outcome:

1. orient once and create the task capsule;
2. plan the smallest complete change and map each material claim to evidence;
3. use one owner, one branch, and one ordinary PR;
4. implement narrowly and validate progressively, from fast diagnostic checks to the smallest relevant integration proof;
5. use exactly one final-candidate review when policy, semantics, external behaviour, or interacting multi-file risk needs model judgement; fully mechanical work with decisive deterministic proof skips ceremonial review;
6. batch-fix findings, rerun only invalidated evidence, verify the exact final head, merge when authorised and green, and clean up the branch where tooling permits.

Human judgement stays above the routine loop. Do not ask a person to approve a routine plan, choose among materially equivalent implementations, repeat a green check, or press the merge button. Escalate one concise decision only for contradictory binding authority, a breaking public/data contract, irreversible or regulated external effect, credentials or provider terms, a product-defining subjective choice absent from the source of truth, or an unavailable/inconclusive relevant gate.

Separate uncertain discovery from delivery. Research uses immutable inputs, an explicit question, the cheapest discriminating experiment, bounded attempts/time/context, and a stop rule. It does not create a PR or run product CI per trial. Only the selected result and reproducible acceptance cross into delivery.

## Validation and evidence

`scripts/sdlc/route.mjs` classifies the complete base-to-head changed path set. Strictly governance/documentation Markdown changes run the zero-dependency governance contract. Every other change, an empty/unresolved diff, or a comparison failure selects the complete maintained product gate. Renames are disabled during classification so deleting production code cannot hide behind a Markdown destination.

Use:

```bash
npm run check:governance   # agent/CI contract and routing fixtures
npm test                   # all deterministic product tests
npm run build              # TypeScript projects and production bundle
npm run ci                 # complete maintained local gate
```

During iteration, run the narrow test file that answers the current question; the product skill maps surfaces to commands. Run the coherent final candidate once through every selected check. Do not retry an unchanged failure to manufacture green.

Evidence must observe the claim. Fixtures/tests prove parser, conversion, scheduling, request-budget, API, and MCP behaviour. A build proves compilation/bundling, not visual quality. Layout or comprehension claims need running visual inspection. Live Apple compatibility needs an explicitly authorised bounded probe. Deployment, cron, KV, D1, route, or migration claims need explicit effect authority and post-effect observation.

## Product invariants

- Compare the same stable `configKey`; never rank unlike configurations.
- Tests and normal CI are fixture-backed and make no live Apple or FX requests.
- Preserve catalogue versus build-to-order source semantics, price/store/currency/source provenance, visible partial errors, and the stateless read-only MCP contract.
- Preserve contactable scraper identity, shared origin-wide cool-off, 429/503/541 handling, bounded retries, pool size three, pacing, discovered-cost planning, per-invocation `RequestBudget`, and request headroom unless measured provider-safe evidence supports a change.
- Keep tourist scheme availability separate from confirmed Apple participation; uncertain Apple participation remains visibly uncertain.
- KV owns the current snapshot and bounded pending work; D1 records changed price points with market, family, store, configuration, and date identity. Applied migrations are immutable.
- Never commit secrets, `.dev.vars`, logs, local snapshots, build output, or TypeScript build information.

## External-effect boundary

A code task does not implicitly authorise `npm run deploy`, a remote D1 migration, KV/D1 mutation, DNS/custom-domain change, cron change, credential use, or a broad live sweep. These require explicit task authority, current target/config verification, relevant preflight evidence, and a rollback or fail-closed stop. A bounded live read-only probe is allowed only when fixtures cannot establish the claim and the task authorises provider contact.

## Stop conditions

Stop and report the concrete blocker rather than weakening acceptance when work would:

- compare non-identical configurations or discard source/error provenance;
- change a public API/MCP/data schema without migration and compatibility acceptance;
- increase live request concurrency, remove shared throttling, or widen a sweep without measured provider-safe evidence;
- publish a tax-refund claim whose Apple participation is materially unverified;
- require unavailable credentials or an unauthorised external mutation;
- leave a selected deterministic gate unavailable or inconclusive.

## Progressive-disclosure map

- Full process, research promotion, evidence, review, autonomy, and metrics: `docs/agents/ai-sdlc.md`
- Product architecture, commands, invariants, and proof map: `.claude/skills/apple-stores-tracker/SKILL.md`
- Independent exact-head semantic review: `.claude/agents/ai-sdlc-reviewer.md`
- Product and operational overview: `README.md`
- Executable CI routing and fixtures: `scripts/sdlc/route.mjs`, `scripts/sdlc/route.test.mjs`
