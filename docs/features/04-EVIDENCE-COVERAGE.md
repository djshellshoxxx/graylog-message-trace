# MT-004 — Evidence Coverage / Unknown Boundaries

**Priority P1 | Complexity low-to-medium.** Make absence of original-execution evidence obvious and prevent users from mistaking a reconstructed path or replay for a recording. Extend existing `traceSummary` and `diagnostics` rather than creating an unrelated confidence engine. Works on current standalone viewer with conservative coverage and improves with future attested server results.

## User story and visual design

At top of trace show `Evidence: stored document verified by API / imported unverified`, then a compact collapsible `Coverage` panel listing known pipeline boundaries. Status must say what is known *and why*.

Suggested boundaries (not a claim that all are always executed):
`INPUT_RECEIPT`, `CODEC_EXTRACTORS`, `MESSAGE_FILTER_CHAIN`, `PIPELINE_PROCESSING`, `STREAM_ROUTING`, `INDEX_STORAGE`, `EVENT_RELATIONSHIP`.

For each boundary show status and provenance/source:
- `SUPPORTED_RECORDED` — only a server-attested original capture explicitly covering this boundary;
- `STORED_FACT` — persisted authoritative fact at this boundary (e.g., physical index), **not** historical execution;
- `CURRENT_CONFIG_ONLY` — authorized current configuration/topology; not historic proof;
- `REPLAY_ONLY` — isolated simulation result, and which input origin/config was used;
- `UNVERIFIED_CLAIM` — imported JSON claims original execution; cannot authenticate it;
- `UNAVAILABLE` — insufficient evidence or unsupported collector;
- `PARTIAL` — recorder provides some steps but admits boundary gaps/loss;
- `REDACTED` — evidence exists or may exist but hidden due to authorization; don't imply what it contains.

A boundary can have multiple **claims** with different provenance; a single summary status is a **presentation priority**, not confidence. Never reduce conflicting claims into an unjustified definitive historical assertion.

Avoid percentage completeness, "exact", or green overall success based solely on stored fields. Display `Observed final index; pipeline history unknown` rather than `40% traced`. If all input evidence is imported without server attestation, explicitly display `Imported evidence is unverified`.

## Contracts and trust handling

```ts
type BoundaryId = 'INPUT_RECEIPT'|'CODEC_EXTRACTORS'|'MESSAGE_FILTER_CHAIN'|
  'PIPELINE_PROCESSING'|'STREAM_ROUTING'|'INDEX_STORAGE'|'EVENT_RELATIONSHIP';
type CoverageState = 'SUPPORTED_RECORDED'|'STORED_FACT'|'CURRENT_CONFIG_ONLY'|
  'REPLAY_ONLY'|'UNVERIFIED_CLAIM'|'UNAVAILABLE'|'PARTIAL'|'REDACTED';
interface CoverageClaim {
  boundary: BoundaryId; state: CoverageState;
  provenance: Provenance; sourceRef?: string;
  reason: string; lossReasons?: string[];
  scope?: string; isAttested: boolean;
}
interface CoverageReport {
  boundaries: Readonly<Record<BoundaryId,readonly CoverageClaim[]>>;
  warnings: readonly string[];
  importedClaimsUnverified: boolean;
  declaredCaptureBoundary: string|null;
}
function buildCoverage(view: NormalizedTraceView, context: EvidenceTrustContext): CoverageReport;
```

`EvidenceTrustContext` comes from trusted viewer entry point **not from parsed import fields**: `{ source: 'LOCAL_FILE'|'DEMO'|'GRAYLOG_AUTHORIZED_API'|'SERVER_ATTESTED_RECORDING', serverValidatedBoundaryIds?: string[] }`. A local file cannot set its own trust context to SERVER_ATTESTED_RECORDING. The existing CLI's authorized API result is observed final stored facts only; it cannot assert a live recorder. Native backend must include integrity, permissions and claimed boundary in an authenticated server envelope before recording attestation is considered.

For source v1 without `kind`/`capture.boundary`, determine only facts indisputably in `message(index,id,fields)`: `INDEX_STORAGE` = stored final document (with imported label unverified if sourced from local JSON). Other boundaries remain unavailable, even when labels mention "Input" or "pipeline". Do **not** parse labels to infer recorder coverage.

A step marked RECORDED in imported file is a visible user-supplied **claim**; it may appear as UNVERIFIED_CLAIM but cannot promote full trace. `capture.complete=true` alone never changes that.

## Rules, diagnostics and edge cases

- If `capture.loss_reasons` nonempty or a recorder declares incomplete node/partial data, show `PARTIAL`, not `SUPPORTED_RECORDED` for affected boundaries. Recording OFF => unavailable, not failure.
- When a stored stream list is present, status `STORED_FACT` for *final membership* but route history remains UNAVAILABLE; show both separately within stream-routing boundary.
- Capture starting at `PIPELINE_ONLY` cannot mark INPUT_RECEIPT or codec as recorded. Missing future event links remain UNKNOWN, not `no event`.
- Replay-only duration labels appear below the corresponding stage; don't compare replay performance with original execution.
- When a rule source is REDACTED, show REDACTED without leaking its name, existence count or cause unless authorized aggregate metadata explicitly permits it.
- No guarantee that every message passes each candidate boundary or that an absent trace means nothing ran. Current config retrieved later is separate from ingest-time config.
- Multiple nodes may have partial capture; per-node coverage and partitions must not be flattened to global exactness.

## UI integration and module plan

Create pure `web/features/coverage.js` from normalized trace + trust context. A component `web/components/evidence-coverage.js` displays status row, "Why?" expansion, provenance, source availability and explicit reasons. Add compact header link to panel from `#summary`; keep existing summary output until replacement is tested. Search and filters never change the computed coverage report.

In native integration, server can supply boundary-qualified claims from canonical recorded DTO, independently permission-checked. If an optional claim is missing or future version is unknown, gracefully display unavailable. Do not persist trust tokens in exported JSON or trust imported server-looking fields.

## Tests and acceptance

1. Unit fixtures: stored-facts only, unverified imported RECORDED complete=true, mixed recorded/replay, current-config only, recorded with missing node, loss/truncation, partial pipeline-only, final stream only, redacted rule, deleted current configuration and no steps.
2. Confirm local import with forgeable `source='SERVER_COLLECTOR'` remains UNVERIFIED and never causes "exact"; source-of-trust is runtime injection only.
3. Verify each status has a nonempty reason string and per-claim provenance; no field label heuristic.
4. Keyboard accessible collapse/expand, readable non-color labels, mobile layout, error/unknown screen states.
5. Confirm filters and Smart Trace Search cannot change coverage; exports reproduce coverage claim wording and never imply undisclosed history.

**Acceptance:** User can tell precisely which parts of a selected trace are stored, recorded, simulated, current-topology-only, incomplete, unavailable or redacted; no misleading historic confidence numbers appear; all calculations are pure and independently unit-tested.
