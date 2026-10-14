# MT-002 — Processing Flow Filters

**Priority P1 | Complexity low-to-medium | Standalone viewer first.** Feature filters the list of *evidenced trace steps*, not the underlying Graylog message index. Depends on MT-000 normalized view-model contract; compatible with any `schema_version:1` import. Not a replacement for Graylog native search or processor configuration.

## User story and observable behavior

As an administrator inspecting a long trace, I can isolate field changes, known failures, stream/routing-related steps, replayed execution or unknown boundaries, and restore the full sequence without losing or altering evidence.

In the Flow section, add a toolbar with labeled preset dropdown and independent filter chips, an optional duration minimum, result count, `Clear filters`, and an explicit indicator that the entire evidence set remains loaded.

Presets: `All steps` (default), `Changed fields`, `Known failures`, `Stream routing`, `Rules and pipelines`, `Unknown / incomplete`, `Replay only`. Any preset sets filters to its documented combination; the user can then adjust chips. Preset label becomes `Custom` on manual modification. Do not assume a corresponding stage exists. Empty results should say "No matching **visible** steps; this is not evidence that a rule did not run."

**Control groups and exact definitions:**

| Control | Initial value | Matching semantics |
| --- | --- | --- |
| Kind multi-select | all | Match optional typed `step.kind`; absent metadata is `OTHER`; do not parse `step.label` heuristically. |
| Outcome multi-select | all | Match explicit typed `step.outcome`; absent becomes `UNKNOWN`. `FAILED` means reported failure, not missing steps. |
| Changed-fields only | off | `before` and `after` both exist **and** at least one fieldDiff item is CREATED/MODIFIED/REMOVED. Empty snapshots or equal values do not match. |
| Provenance multi-select | all | Exact `step.provenance` values, including `UNKNOWN`. |
| Minimum duration | unset | Finite nonnegative µs; steps without `duration_us` do not match when threshold is set; duration from replay remains replay-labeled. |
| Show steps without kind | on | When kinds are restricted, allow a distinct `unknown-kind` checkbox without asserting a category. |
| Clear | enabled when filtered | Reset all filter controls; do not modify search text or loaded trace. |

Recommended preset semantics: `Changed fields` selects changed-only; `Known failures` selects explicit `FAILED` only; `Stream routing` selects typed `STREAM` only (not an inferred final stream); `Rules and pipelines` selects `RULE`/`PIPELINE`/`STAGE`; `Unknown/incomplete` selects `UNKNOWN` provenance or an explicitly marked unknown outcome (OR across these two signals); `Replay only` selects CURRENT/HISTORICAL_REPLAY. If no typed event-kind/outcome is available in imported v1 file, show a brief "this trace lacks typed step metadata" explanation.

## Data and module contracts

```ts
interface FlowFilter {
  kinds: ReadonlySet<StepKind>|null;       // null -> all
  outcomes: ReadonlySet<Outcome>|null;     // null -> all
  provenance: ReadonlySet<Provenance>|null;
  changedOnly: boolean;
  includeUnknownKind: boolean;
  minDurationUs: number|null;
}
interface FilterResult {
  indices: readonly number[]; // indices into immutable original trace.steps, ordered as source
  total: number;               // original authorized step count
  shown: number;
  missingMetadata: readonly string[];
}
function filterFlow(view: NormalizedTraceView, filter: FlowFilter): FilterResult;
```

Proposed module `web/features/filter.js` exports `defaultFlowFilter()`, `filterFlow(view, filter)`, `applyPreset(preset)` and `validateFlowFilter`. Normalize missing metadata without mutating imported steps. All filter tests use the same normalized selector and deterministic `fieldDiff`. For "unknown/incomplete" OR predicate, do not combine union semantics with the ordinary AND chip groups invisibly; document explicit preset predicate and show chip state.

Visibility/redaction: only steps already included in the user's authorized trace are considered. Do not synthesize redacted steps; maintain any aggregate visibility indicators provided by server without exposing their contents. Filtering does not change `capture.complete` or per-step provenance.

## UI layout and integration

```text
Flow heading    Showing 19 of 240 visible steps  [Clear filters]
[Preset: All steps v] [Kinds v] [Outcomes v] [Provenance v]
[ ] Only changed fields   Minimum duration [___] µs
--------------------------------------------------------------------
1. Stored final message         OBSERVED
2. Process/rule...              RECORDED   modified: src_ip
...
```

Integrate in `web/app.js` via `web/components/flow-filters.js` and renderer. Existing `#flow` retains ordered-list accessibility semantics. If filtered, show original step positions (e.g. "#27") rather than silently renumbering events. A search query in MT-003 is applied as an **intersection** with the filter result, and controls show both filter count and combined visible count. The coverage module MT-004 and report generator MT-006 always operate on complete authorized data unless the user explicitly selects filtered export.

State resets when a new trace is loaded; defaults are per-session. No requirement to store preferences in the browser. In native plugin, retain the same controls in Flow tab and place collapsed filters above steps rather than a separate modal.

## Edge cases

- Empty trace; zero changes; an empty/single-step trace; missing `kind`/`outcome`; absent snapshot pair (already invalid); field changed from missing to JSON null; changed then reverted; multiple writes to same field; unknown custom kinds; redacted items.
- Invalid duration input (negative, exponential overflow, NaN, nonnumeric): surface field validation; don't apply broken filters or spin.
- Dataset up to 10,000 steps; avoid repeated full `fieldDiff` calculation per keystroke by caching per-step hasChanges boolean once per imported trace; no eager deep clone each render.
- Recorded stage priority is not evidence of a single global order. Keep supplied order and concurrency indicators.
- If a runtime has only stored facts (no steps with typed `RULE`), "Known failures" may be empty even if `gl2_processing_error` is present. Show diagnostic elsewhere; never fabricate a FAILED rule.

## Work units and test requirements

1. Add typed optional metadata validation/normalization and tests, preserving existing `validateTrace`/`fieldHistory` outputs.
2. Write failing unit tests for every predicate and each preset; create `filterFlow` selectors; refactor for cached hasChanges.
3. Render controls with labels, focus order, ARIA count; implement clear and preset-to-custom transitions.
4. Add combined Flow+Search test for AND semantics, transition to new file, export full vs filtered data, and a 10k-step stress test.

**Acceptance:**
- All presets yield exactly documented indices on a fixture that includes unknown metadata, null creation, failures, two different provenance classes and no-change steps.
- No mutation of original trace and no undocumented reordering of original positions.
- Keyboard-only selection and clear work; zero-match message is distinct from missing evidence.
- Disabled or unavailable rules/streams claims are never synthesized; inherited provenance is displayed.
- `npm test` and syntax checks succeed; developer manual QA on current standalone web viewer passes.
