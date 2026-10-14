# MT-003 — Smart Search within a single trace

**Priority P1 | Complexity low-to-medium | No new Graylog API calls.** Search existing authorized trace evidence, not Graylog's global message corpus. Works offline with the synthetic sample and local JSON files.

## User story and UX

As an investigator I type a field name, field value, rule/step label, pipeline reference or error text, see highlighted matches, and navigate Previous/Next to the relevant step or field without scanning thousands of entries.

Layout: toolbar above Flow/Fields: `Search trace [____________] [Scope: All v] [Clear]`, followed by `37 matches (showing first 500)  [Previous] 8/37 [Next]`. Scope values `All`, `Flow steps`, `Fields`, `Diagnostics`. Query is literal text, case-insensitive; use Unicode text normalization consistently (document behavior; no regex/wildcard/Graylog DSL in v0). Advanced query syntax deferred until real need emerges. Empty query means no restriction, no highlighted matches.

Index these authorized items:
- each step: label, typed kind/outcome/provenance, processor/pipeline/rule/stream **identifiers already present**, and safe bounded scalar before/after field names and values;
- final message: field names, scalar values, nested object path leaf names and primitive values up to bounds;
- deterministic diagnostic text emitted by our `diagnostics` module;
- **exclude** hidden/unreturned server objects, unknown source code, credentials, redacted values and arbitrary raw HTML as searchable text.

Search in computed view data; never query remote servers from this control. Track match target type `STEP`, `FIELD`, `DIAGNOSTIC` and target index/field, not HTML nodes. Highlight using safe text-node spans (never `innerHTML`); no input or trace text becomes executable regex.

## Contracts

```ts
type SearchScope = 'ALL'|'FLOW'|'FIELDS'|'DIAGNOSTICS';
type MatchTarget = 'STEP'|'FIELD'|'DIAGNOSTIC';
interface TraceSearchQuery { text: string; scope: SearchScope; }
interface SearchHit {
  target: MatchTarget;
  stepIndex?: number;               // index into original trace.steps
  fieldName?: string;
  diagnosticIndex?: number;
  matchedProperty: string;          // e.g. "label", "before.src_ip"
  range: [number,number];           // offsets in the indexed display text
}
interface SearchResult { hits: readonly SearchHit[]; total: number; truncated: boolean; }
function searchTrace(view: NormalizedTraceView, query: TraceSearchQuery): SearchResult;
function intersectFlowHits(hits: readonly SearchHit[], visibleStepIndices: readonly number[]): readonly SearchHit[];
```

Implementation split:
- `web/features/search.js` pure indexing/search and stable ordering. Create bounded `buildSearchIndex(view)` **once** on file load; don't stringify the entire message for every keystroke. Use a shallow-first iterative flatten with maximum nesting 16 and text budget; typed arrays and objects displayed as JSON-safe representations where bounded.
- `web/components/trace-search.js` input, scope, result list and navigation; `web/components/highlight.js` safe DOM text segments.
- A presenter converts hits into visible Flow/Field selection without making `searchTrace` depend on the DOM. A hit at hidden step shows "Match hidden by current flow filters" and offers **Show matching step** by adjusting the filter **after explicit user click**. Do not silently reset filters.

**Stable ordering:** Step hits in original step array order; field hits by sorted field name; diagnostics by source order. Multiple matches in the same step are navigable individually, but a separate grouped-result count may show unique targets. Previous wraps to last and Next wraps to first (document visible result selection). Debounce UI keystrokes (e.g. ~150ms) or use lazy scheduling for long datasets, but keep pure selector deterministic.

## Bounds/security/performance

- Trim whitespace; max 256 Unicode code points; show inline validation rather than truncating silently. Empty/whitespace-only search clears results.
- Cap output at first 500 navigable matches; independently compute a bounded approximate/known total and set `truncated` accurately. If full count is not computed for performance, say `500+`, never a precise invented total.
- Cap indexed field/value text per leaf (initial target 4 KiB) and total per trace (initial target 8 MiB); record `indexTruncated` and display warning so "not found" does not imply absent evidence. These are design budgets; use performance tests to adjust.
- Test Unicode combining characters, surrogate pairs, non-Latin scripts, empty/null/bool/number values, dots in field names, regex metacharacters treated literally, JSON control characters and hostile HTML. No catastrophic regex or user-supplied arbitrary code.
- Search logic works on a **permission-filtered** trace passed by server; a client filter cannot grant access. Trace exports don't include search indexes or query strings by default.

## Interaction with other features

- MT-002 filters: flow steps shown = `filterFlow.indices` intersected with matching step IDs when search active. Final-field and diagnostic hits are scoped independently. Counts must label `matches` vs `visible steps`.
- MT-005 Field Journey: selecting a FIELD hit opens journey for that field; selecting a STEP hit opens step detail with provenance and may highlight fields in the step.
- MT-004 Coverage: coverage is computed over the **unfiltered whole trace**. Search cannot change capability/completeness state.
- MT-006 Markdown export: default report includes whole authorized trace; optional "current selection" mode records filter/search context explicitly, never claims this is the whole execution.

## Test plan, implementation sequence and acceptance

1. Write tests for text-token extraction, nested fields, types, redacted/missing values, fixed ordering and literal metacharacters.
2. Implement index builder and search selectors, with small deterministic fixture and 10k-step synthetic stress fixture. Verify stable result order and truncation.
3. Add controlled UI state and safe highlighter, keyboard shortcuts when search has focus: `Enter` next, `Shift+Enter` previous, `Escape` clear; no global keyboard interception when other text inputs focused.
4. Integrate scroll-to-step and focus for keyboard navigation, field selection, filter intersection, new-trace reset.
5. Add DOM tests that assert escaped malicious message contents and accurate ARIA live announcements.

**Acceptance:** A literal query for `src_ip` finds a field, before/after step mutations and diagnostics where those exact facts are present; navigation selects the correct trace position without changing source; search of strings containing HTML/metacharacters never creates elements or executes scripts; empty/no-results states are clear; 500-hit cap and index-truncation indicator work; Node and browser tests pass.
