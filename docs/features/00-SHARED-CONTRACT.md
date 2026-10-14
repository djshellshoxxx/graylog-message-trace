# Shared implementation contract (MT-000)

Status: **implementation specification**, not a claim of implemented code.
Target: current Node 22+ dependency-free viewer, future pinned Graylog 7.1.3 server/web plugin. This file governs MT-001 through MT-006. Existing `docs/SPECIFICATION.md` v1.2 remains the authoritative product scope. Do not silently change the version-1 JSON import format.

## Product invariants

1. A stored final message, an actual recorded execution, a current/historical replay, and a reconstructed topology are different types of evidence. Preserve the existing provenance values `OBSERVED`, `RECORDED`, `HISTORICAL_REPLAY`, `CURRENT_REPLAY`, `RECONSTRUCTED`, `INFERRED`, `UNKNOWN`. `REDACTED_BY_PERMISSION` is a **visibility** state, not provenance.
2. Imported trace files supply their own labels and are **not attested**. A `capture.complete` property alone is insufficient to certify original execution. UI can say "import claims complete" but not "exact".
3. UI operations (filter, search, journey, coverage, export) are **purely local projections** of already authorized evidence. They never read Graylog secrets, query the index, change server state or execute a rule. Native integration gets all server objects through a permission-aware adapter.
4. Do not infer an evaluated, executed or failed rule from field changes or text labels; if typed evidence is unavailable show `UNKNOWN`. Stored final stream membership is not the route history.
5. A final document is not a raw input. Do not derive original codec/extractor results or a full input-to-index history from it.
6. Keep provenance attached to each claim, not only a headline. A hidden or redacted item must never be treated as absent. Filtering must not change evidence completeness.
7. Raw HTML and arbitrary Markdown from logs are always untrusted. No server credentials, API tokens or privileged URLs may appear in exports, diagnostics or logs.

## Canonical data model (proposed backwards-compatible v1 extension)

The existing required shape remains:

```json
{
  "schema_version": 1,
  "message": { "index": "network_42", "id": "opaque-id", "fields": { "message": "text" } },
  "steps": [
    { "label": "Stored final message document", "provenance": "OBSERVED" }
  ],
  "capture": { "complete": false }
}
```

New **optional** attributes may be emitted only after tests prove current `validateTrace` remains compatible:

| Path | Type | Meaning |
| --- | --- | --- |
| `steps[n].id` | nonempty string | Stable within a trace. If absent, viewer computes an ephemeral array-position key. |
| `steps[n].kind` | enum | `INPUT`, `CODEC`, `EXTRACTOR`, `PROCESSOR`, `PIPELINE`, `STAGE`, `RULE`, `STREAM`, `INDEX`, `EVENT`, `DIAGNOSTIC`, `OTHER`. Default `OTHER`. |
| `steps[n].outcome` | enum or omitted | `EXECUTED`, `MATCHED`, `NOT_MATCHED`, `SKIPPED`, `FAILED`, `DROPPED`, `UNKNOWN`. Missing means unknown; never guess it. |
| `steps[n].scope` | object or omitted | Opaque IDs for pipeline, stage, rule, input, stream and processor when evidenced. **Do not** substitute names as IDs. |
| `steps[n].sequence` | nonnegative integer or omitted | Recorded order within a collector's **declared ordered scope**, not global concurrency order. |
| `steps[n].before`/`after` | objects | Existing paired field snapshots. Missing means no change evidence. Empty objects are genuine empty snapshots. |
| `steps[n].duration_us` | finite nonnegative number | Duration at declared provenance, never represented as historic if replayed. |
| `capture.boundary` | enum or omitted | `INPUT_TO_INDEX`, `PIPELINE_ONLY`, `PROCESSOR_ONLY`, `STORED_ONLY`, `UNKNOWN`. |
| `capture.loss_reasons` | array of strings or omitted | Queue drop, truncated values, inactive node, retention expiry, missing listener, etc.; untrusted unless attested. |
| `capture.source` | enum or omitted | `FILE_IMPORT`, `AUTHORIZED_API`, `SERVER_COLLECTOR`, `REPLAY`. |
| `capture.version` | string or omitted | Graylog/adapter version where evidenced. |
| `visibility` | object or omitted | Authorized disclosure/redaction metadata from the server, not a client trust decision. |

```ts
type Provenance = 'OBSERVED'|'RECORDED'|'HISTORICAL_REPLAY'|
  'CURRENT_REPLAY'|'RECONSTRUCTED'|'INFERRED'|'UNKNOWN';
type StepKind = 'INPUT'|'CODEC'|'EXTRACTOR'|'PROCESSOR'|'PIPELINE'|
  'STAGE'|'RULE'|'STREAM'|'INDEX'|'EVENT'|'DIAGNOSTIC'|'OTHER';
type Outcome = 'EXECUTED'|'MATCHED'|'NOT_MATCHED'|'SKIPPED'|
  'FAILED'|'DROPPED'|'UNKNOWN';
type Visibility = 'VISIBLE'|'REDACTED_BY_PERMISSION';
interface TraceStepV1 {
  label: string; provenance: Provenance; id?: string;
  kind?: StepKind; outcome?: Outcome; sequence?: number;
  duration_us?: number; scope?: Record<string,string>;
  before?: Record<string,unknown>; after?: Record<string,unknown>;
}
```

These are **design contracts**, not existing compiled TypeScript types. Preserve unknown optional data for round-trip JSON exports, but render only validated known fields. For future collected traces, a schema v2 migration must be explicitly versioned rather than silently requiring v2 fields in v1.

## Module boundaries

Proposed browser modules (pure functions unless identified as a view):

```text
web/trace.js                      existing schema validation, fieldDiff, fieldHistory
web/features/normalize.js        one-time typed view model and stable local IDs
web/features/filter.js           MT-002: select steps
web/features/search.js           MT-003: query normalized authorized data
web/features/coverage.js         MT-004: evidence/unknown boundary reports
web/features/journey.js          MT-005: field-state transitions
web/features/markdown.js         MT-006: safe, deterministic Markdown serialization
web/components/*                 DOM-only controls, keyboard access, rendering
web/app.js                        orchestration; replace monolithic logic incrementally
test/features/*.test.js          Node built-in test runner, deterministic fixtures
```

One `normalizeTraceView(trace)` pass computes immutable normalized steps and field-key indexes, never modifies the input trace. It can memoize by trace-object identity inside a viewer session. Filter and search share this model, not their UI state. Keep reusable functions browser-compatible (avoid Node-only imports and unnecessary dependencies). Keep the existing `fieldHistory` public behavior unchanged.

All feature selectors expose a pure function accepting immutable inputs; UI stores just the search/filter/selection state. Importing a new trace resets stale matches, selection and navigation. Never attach DOM nodes, server credentials, or persisted secrets to the normalized model.

## Bounds, privacy and performance

- Existing raw imported file limit 5 MiB, maximum 10,000 steps and bounded evidence traversal remain in force. Test extra CPU/memory cost from derived indexes and large nested field snapshots.
- Target UI behavior: interactions on a synthetic fixture of 10,000 steps and a 5 MiB input should remain responsive in supported browsers; measure performance in CI and document real measurements before claiming targets. Use chunked rendering/virtualized list when necessary; do not block ingestion since the viewer is isolated from ingestion.
- Search terms max 256 Unicode code points; show first 500 matches with total/overflow indicator; cap indexed text and bounded nested flattening. Avoid regular-expression execution on untrusted search terms in the initial version.
- No raw trace data in localStorage or URL fragments. Only ephemeral, non-sensitive display preferences may be saved with explicit product permission and default-off.
- UI escape via `textContent`; report generator must escape untrusted field strings and prohibit raw HTML. No active links from imported trace data.
- Never generate a shareable URL containing IDs or field values by default. JSON/Markdown exports obey current viewer authorization and server redaction.

## User experience and accessibility

Single Trace view: header (canonical message ID, evidence summary, file vs server provenance); controls (search, filters, coverage badge, export); main Flow and Fields; Field Journey in an inline detail panel or adjacent tab. Full keyboard navigation, explicit labels, `aria-live` counts/selection, visible focus, WCAG AA intent. Every disabled/unsupported control has a reason. Empty states distinguish no message, no matching results and missing evidence.

## Dependency order and CI

1. Freeze tested fixture schema; add optional-property validation and a standalone normalized view selector.
2. Implement MT-002 filters and MT-003 search against normalized selector; independently test pure logic before DOM.
3. Implement MT-005 journey by reusing fieldDiff/fieldHistory and typed step metadata.
4. Implement MT-004 coverage from evidence capabilities; never from current UI filters.
5. Implement MT-006 Markdown using the same unsliced authorized model and explicit export options.
6. Add DOM keyboard/accessibility smoke tests. Keep `npm test`, `npm run check:syntax` passing; add integration tests for import, filter+search composition, and export.

Definition of done for each feature: standalone pure tests, combined end-to-end interaction tests, no provenance promotion, no changes to original data, redaction/large-input tests, accessible states, README/help instructions, and green CI. Production Graylog remains untouched.
