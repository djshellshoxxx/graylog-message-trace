# MT-005 — Visual Field Journey

**Priority P1 | Low-to-medium effort | Builds on existing fieldHistory.** Display the evidence-supported state of one field across recorded or replayed steps, without inventing original execution history.

## User-facing behavior

From the existing Fields panel, selecting a field opens a Journey panel. It displays: field name and typed final value; transitions in source step order; operation CREATED/MODIFIED/REMOVED; before/after values; the provenance of each step; link to its source step; and explicit unknown gaps. A final "Stored value" node is a separate fact, never treated as an inferred processing operation.

Controls are Field Selector, Previous Change, Next Change, Value Display (Typed / JSON / Single Line), Expand Value, Copy Authorized Value, and Reveal Flow Step. Keyboard navigation focuses the selected transition. No text from a message is rendered as HTML.

Example (illustrative):

```text
Field src_ip, final: present (string)
#2 CREATED  <missing> -> "192.0.2.15"  CURRENT_REPLAY
#5 MODIFIED "192.0.2.15" -> "198.51.100.22" CURRENT_REPLAY
? Original input and intermediate actions: UNKNOWN
Final stored value: "198.51.100.22" OBSERVED (authorized API)
```

The replay steps must NOT be presented as original causes of the final stored value.

## Pure data API

```ts
type FieldState = { present: false } | { present: true; value: unknown; type: string };
interface Transition {
  stepIndex: number; stepId: string; kind: 'CREATED'|'MODIFIED'|'REMOVED';
  before: FieldState; after: FieldState; provenance: Provenance;
  durationUs?: number; orderScope?: string; associatedRuleId?: string;
}
interface Journey {
  field: string; finalState: FieldState; transitions: readonly Transition[];
  gaps: readonly {reason: string; beforeStep?: number; afterStep?: number}[];
  fullRecordedHistoryAttested: boolean;
}
function buildFieldJourney(view: NormalizedTraceView, field: string,
                           trust: EvidenceTrustContext): Journey;
```

Proposed files: `web/features/journey.js` for pure model, `web/components/field-journey.js` for accessible rendering, `test/features/journey.test.js` for deterministic tests. Continue using `fieldDiff`/`fieldHistory` in `web/trace.js`; do not duplicate the recursive comparison engine.

## Transition logic

1. Field keys are exact case-sensitive strings, including names that appeared temporarily but are absent from the final document. Field selector is the union of authorized final keys plus authorized snapshot keys, sorted.
2. For each step with paired before/after snapshots, inspect ONLY the selected field. Detect existence using `Object.hasOwn`, so `null` differs from missing. Existing `fieldDiff` supplies correct type-sensitive changes.
3. Assign original step index; use a stable step ID only when provided. Do not fabricate a globally ordered sequence for parallel pipelines. Step association is not attribution: show "associated with step" unless a recorder explicitly proves rule identity.
4. Detect gaps conservatively. If the next comparable `before` disagrees with previous `after`, show "Unobserved intermediate change" rather than synthesizing a step. No snapshots between two steps does not establish continuity unless recorder declares coverage.
5. Display final state from `message.fields`, not from replay or last snapshot. If replay last state differs, label "Replay/final discrepancy"; never merge these timelines.
6. `capture.complete=true` from an imported file is an unverified claim. `fullRecordedHistoryAttested` requires server-trusted original boundary-specific evidence, without loss or uncovered boundaries.
7. Show data types `null`, boolean, number, string, array and object. A string "42" and numeric 42 are different states. Nested value preview default first 300 characters and 1 KiB maximum per expansion preview; mention truncation.

## GUI integration and other features

Journey lives inline within Fields as a subpanel, not a popup obscuring Flow. Selecting a step shows provenance and "Open Step" control. MT-002 filters may hide related Flow steps but Journey still uses **all authorized steps**, with "Hidden by current filter" and Reveal action; no history silently disappears. MT-003 field search opens Journey and highlights field. MT-004 can annotate trustworthy boundary coverage but cannot promote a replay. MT-006 exports transitions with explicit gaps.

Keyboard: Prev/Next enabled only if a transition exists, no wrap by default; arrows must not steal focus from other fields. Use a semantic ordered list, textual operation names, and accessible focus/ARIA labels. Values are displayed with textContent. Large data should be windowed if a trace has thousands of transitions.

## Test-driven implementation plan

1. RED tests: CREATED missing->null, REMOVED null->missing, MODIFIED number->string, equal nested objects, modified then reverted, final key absent, field only in a snapshot, zero snapshots, replay-vs-final mismatch, partial capture gaps, imported false attestation, concurrent scope, redacted data and malicious HTML.
2. GREEN: pure `buildFieldJourney` using existing field-history selectors; no DOM or network access.
3. REFACTOR: add stable memoization by selected trace+field only after tests show need; keep shared API independent from UI.
4. Add component and DOM smoke tests for field change selection, keyboard use, long values, malicious text and switching traces.
5. Run full `npm test`, syntax checks and manual imported demo verification.

**Acceptance:** A missing->null->removed fixture displays two and only two typed transitions; retained field values are immutable; final stored state is separately labeled; no imported replay is claimed as original execution; original sequence indices are preserved; the UI works offline.
