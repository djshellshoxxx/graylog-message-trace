# Message Trace implementation-ready feature specifications

**Document set version 1.0 | October 13, 2026 | Target Graylog 7.1.3 (unverified plugin compatibility).** These are development specifications, not completed features. They preserve the existing product decisions in `docs/SPECIFICATION.md` v1.2; no native Graylog plugin or exact original-execution recorder exists yet.

## Feature register and implementation status

| ID | Feature spec | Value | Phase | Status | Dependencies |
| --- | --- | --- | --- | --- | --- |
| MT-000 | [Shared data contract](00-SHARED-CONTRACT.md) | Stable plugin/UI evidence semantics and module boundaries | Foundation | Specified | Existing schema v1 and tests |
| MT-001 | [Native Graylog integration and execution proof](01-CORE-GRAYLOG-INTEGRATION.md) | Authorized message actions/topology; gated simulation and original recording | Core | Specified, not implemented | Official 7.1.3 sample, staging, module build |
| MT-002 | [Processing Flow Filters](02-PROCESSING-FLOW-FILTERS.md) | Reduce noise while preserving source order/provenance | Standalone v0.1 | Specified, not implemented | MT-000 normalization |
| MT-003 | [Smart Trace Search](03-SMART-TRACE-SEARCH.md) | Find field/rule/diagnostic evidence inside one trace | Standalone v0.1 | Specified, not implemented | MT-000; composes with MT-002 |
| MT-004 | [Evidence Coverage](04-EVIDENCE-COVERAGE.md) | Show which boundaries are recorded, stored, replayed, unknown or redacted | Standalone v0.1 | Specified, not implemented | MT-000 trust context |
| MT-005 | [Visual Field Journey](05-VISUAL-FIELD-JOURNEY.md) | Show typed creation/modification/removal over evidence steps | Standalone v0.1 | Specified, not implemented | Existing fieldHistory, MT-000 |
| MT-006 | [Markdown Investigation Export](06-MARKDOWN-INVESTIGATION-EXPORT.md) | Readable per-message investigations for incident notes | Standalone v0.1 | Specified, not implemented | MT-000, MT-004, optionally MT-005 |

**Not proposed as a new standalone feature:** Field Watchlist. Graylog has native Favorite Fields functionality in newer versions; adding a separate preference store would duplicate it. Keep compatibility fallback as a later interface decision, not a v0.1 task.

## Actual current repository

- Browser viewer: `web/index.html`, `web/app.js`, `web/trace.js`, `web/example.json`.
- Authenticated stored-message read-only CLI: `lib/graylog-api.js`, `lib/graylog-auth.js`, `tools/trace-message.mjs`.
- Tests: Node 22 built-in `node --test`, `npm run check:syntax`, GitHub Actions.
- Production Graylog: no plugin/JAR installed by this repository, no collector, no safe replay, no persistent configuration snapshots.
- Existing reference: [Engineering specification v1.2](../SPECIFICATION.md), [Research](../RESEARCH.md), [Audit](../AUDIT-2026-10-13.md), [Roadmap](../ROADMAP.md).

## Cross-feature module map

```text
TraceV1 imported file / authorized API DTO
  -> validateTrace (existing)
  -> normalizeTraceView (MT-000, pure, immutable)
       |-> filterFlow (MT-002) ---------+
       |-> searchTrace (MT-003) --------+-> Flow/list presenter
       |-> buildCoverage (MT-004) -----> Header / Coverage panel
       |-> buildFieldJourney (MT-005) -> Fields / Journey panel
       +-> makeInvestigationMarkdown (MT-006) -> Export dialog
Graylog native adapter (MT-001) -> authorized TraceV1 DTO (NOT directly to UI DOM)
```

Do not import UI components from pure functions or add Java/Graylog SDK dependencies to browser selectors. Each package has independently testable input/output contracts. If using parallel coding agents, assign exclusive module paths and separate test files to each, keep the shared contract frozen for each working branch, merge small green branches to main in dependency order.

## Recommended development sequence

**Stage A: usable standalone prototype with five enhancements.**

1. Commit contract fixtures + normalized typed view selector (MT-000). Update `validateTrace` only to accept validated OPTIONAL v1 fields.
2. MT-002 Processing Flow Filters and MT-003 Search can be separate small branches after selector merge; integrate by intersection, not duplicate independent filtering engines.
3. MT-005 Field Journey reuses existing `fieldHistory`; avoid independent diff engine.
4. MT-004 Evidence Coverage displays unknowns and imported-claim status; trust context must not originate from JSON import.
5. MT-006 Markdown report reuses coverage and journey; report defaults to metadata/types without field values.
6. Finish with browser DOM smoke tests and accessibility/large-input regression tests.

**Stage B: native Graylog proof and integration (parallel after contract freeze).**

1. Pin Graylog server + web plugin dependencies; compile/load/unload the minimal official plugin skeleton on an isolated 7.1.3 instance.
2. Permission-aware message lookup, native action/deep-link, current config/topology resolvers.
3. Separate safe simulator feasibility and live instrumentation feasibility **spikes**. Enable neither until proven safe and supported. Unsupported status is an acceptable feature outcome.
4. Implement collection/retention or replay only after their individual safety/integration gates pass.

**Stage C:** Event linkage, comparisons, historical revisions, advanced diagnostics, cluster-safe retention and performance validation as described in the main specification.

## Issue breakdown / independent implementation tickets

| Ticket | Files owned | Tests / deliverable |
| --- | --- | --- |
| A0 | `web/features/normalize.js`, schema fixtures | schema v1 compatibility, bounds, pure output |
| A1 | `web/features/filter.js`, `web/components/flow-filters.js` | exact predicates/presets, keyboard, zero-match |
| A2 | `web/features/search.js`, `web/components/trace-search.js` | bounded literal search, safe highlighting, navigation |
| A3 | `web/features/journey.js`, `web/components/field-journey.js` | present/null/type/gap semantics, cross-view navigation |
| A4 | `web/features/coverage.js`, `web/components/evidence-coverage.js` | unverified source, unknown boundaries, no false history |
| A5 | `web/features/markdown.js`, `web/components/export-dialog.js` | deterministic report, value opt-out, Markdown injection |
| A6 | `web/app.js`, `web/index.html`, `web/style.css` | combined integration and responsive UI smoke tests |
| B0 | future `server/*` pinned build | Graylog 7.1.3 plugin compiles/loads with no mutation |
| B1 | future server resolvers/REST/action | real authorized message, current claims, ACL matrix |
| B2 | future isolated simulation proof | no observable writes or unsafe functions |
| B3 | future collector feasibility proof | stable supported hook or explicit UNSUPPORTED verdict |

For each code ticket use RED failing test -> minimal implementation -> refactor -> full suite. Explicitly merge to main after CI passes; delete merged short-lived branches later under normal GitHub policies. Never overwrite work in concurrent branches or production Graylog config.

## Definition of development-ready

Every feature spec defines: observable user goal; exact controls/defaults; data shape and exported pure API; input validation and bounds; provenance/trust handling; integration with other features; error and empty-state behavior; security/privacy constraints; edge cases; test fixtures and pass/fail gates.

**Definition of implemented** is separate: passing code/CI, browser behavior where relevant, documentation, and for native functionality, a verified compatible build plus real isolated Graylog integration tests. Specifications alone do not make the plugin deployable.
