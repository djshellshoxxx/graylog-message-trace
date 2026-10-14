# MT-006 — Markdown Investigation Export

**Priority P1 | Low-to-medium effort | Works offline first.** Create a case-oriented Markdown report from an authorized trace without reimplementing Graylog's generic search result export. JSON export remains canonical.

## User story, controls and screen location

In the Trace header, Export menu offers JSON evidence (existing) and Markdown investigation (new). The Markdown dialog shows:
- Scope: `Full authorized evidence` default, or `Current visible subset`, which includes currently applied filters/search and must be labeled **INCOMPLETE SUBSET**.
- Values: `Field names and types only` default, or `Include authorized values` explicitly enabled by user. Server-redacted values can **never** be enabled.
- Sections: Message summary (mandatory), Evidence Coverage (mandatory), Flow steps (default on), Field Journey (default on), Diagnostics (default on), Current Topology (if supported), Raw message (off).
- Actions: Preview Plain Text, Download .md, Copy Markdown, Cancel. Show approximate bytes and any truncation before confirmation. Preview is plain text rather than rendering uncontrolled Markdown.

Output filename uses a fixed prefix, generated UTC date and a local short hash of message identity, e.g. `message-trace-20261013-a94d2c.md`; never include untrusted field content or credentials in filename.

## Required output

```markdown
# Message Trace Investigation
Report format: 1
Generated: 2026-10-13T00:00:00Z
Physical index: network_42
Message ID: opaque-id
Evidence source: authorized API / imported file (unverified)
Trace view: full / selected subset
Original execution: UNKNOWN / partial (not automatically verified)

## Evidence Coverage
- Final indexed document: OBSERVED (when authorized)
- Historical pipeline execution: UNKNOWN
- Final stream IDs: OBSERVED; routing history: UNKNOWN

## Diagnostics
- ...
## Flow Evidence
1. ... (provenance: ...)
## Field Journey
- ... (type, present/absent, provenance)
## Unknowns and Limitations
- ...
```

Even when optional sections are disabled, the file MUST contain provenance, capture boundary/replay origin if known, authorization/source labels and explicit uncertainties. The report must distinguish `RECORDED`, `CURRENT_REPLAY`, `HISTORICAL_REPLAY`, `RECONSTRUCTED`, `INFERRED` and `UNKNOWN` and indicate that local import provenance claims are not authenticated. No claim of "rule did not run" from lack of evidence.

## Pure module interface

```ts
type ExportSection = 'FLOW'|'FIELDS'|'DIAGNOSTICS'|'TOPOLOGY'|'RAW';
interface MarkdownOptions {
  scope: 'FULL'|'VISIBLE_SELECTION';
  includeFieldValues: boolean; // default false
  sections: ReadonlySet<ExportSection>;
  selectedStepIndices?: readonly number[];
  selectedFieldNames?: readonly string[];
  generatedAtIso: string;      // injected, not Date.now() inside serializer
}
interface MarkdownReport {
  text: string; byteCount: number; truncated: boolean;
  warnings: readonly string[];
}
function makeInvestigationMarkdown(
  view: NormalizedTraceView, coverage: CoverageReport, options: MarkdownOptions
): MarkdownReport;
```

Code location: `web/features/markdown.js` (pure serialization) and `web/components/export-dialog.js` (DOM). Tests `test/features/markdown.test.js` and one UI smoke test. Zero network calls from export; no credentials passed to formatter. Browser download uses Blob/ObjectURL only after click, then revokes URL. "Copy" invokes clipboard from user click and handles denied clipboard permissions.

## Value selection, authorization and safe formatting

- The server must have already reduced trace to authorized claims. Recheck permission at download/read boundary for native server exports; permission revocation between view and export must be honored. Local file imports cannot certify permission or origin.
- Opt-out field values must be excluded **everywhere**, including diagnostics, fields, path labels, snippets and examples. Any user-controlled label that could contain a value should be omitted or generalized in names/types-only mode. Don't rely on a single `includeValue` flag inside one section.
- Escape untrusted Markdown punctuation, pipes, HTML angle brackets and backslashes. Encode control characters as escaped text; do not output raw HTML or clickable arbitrary URLs from a trace. Use JSON-quoted strings with Markdown escaping for values.
- Avoid raw fenced blocks containing untrusted data, unless dynamically bounded fences plus sanitization are fully tested. Default to safe, shortened inline quoted values.
- Do not assemble Markdown links from arbitrary rule labels, stream IDs or field content. Native Graylog links may appear only if built from trusted, permission-checked adapter URLs.
- Byte limits: proposed 1 KiB per field value preview; 2 MiB total export. On truncation add an explicit warning at top and at truncated sections; no silently missing data. UTF-8 output with LF line endings.
- Reject invalid `generatedAtIso` or other malformed options; fixed injected timestamp enables deterministic golden tests.
- All observations and inferred relationships have supporting provenance; no AI-generated explanations or speculative conclusions in v0.

## Selection semantics

FULL uses all authorized trace steps in source order; never uses filtered subsets implicitly. VISIBLE_SELECTION takes explicit original step indices from combined search+filter state, validates bounds/uniqueness, preserves original sequence order, and lists count included vs available with warning. Coverage always comes from complete authorized trace and is not recalculated from selection. Field Journey exports use MT-005 semantics (missing/null/type, gaps, replay provenance); if MT-005 is not yet implemented, field history may be adapted through existing `fieldHistory` but must not invent producer attribution.

## Test-driven build order

1. RED tests for exact output structure and value suppression, imported forged recording, missing original history, partial capture, different replay inputs, selected subset, malicious messages and redacted values.
2. GREEN pure deterministic report builder and escaping utility with per-value / overall limits.
3. Add dialog + preview, copy, save; retain existing JSON export unchanged.
4. Test large Unicode, `<script>`, `[link](javascript:...)`, HTML comments, pipes, backslashes, embedded newlines, long backtick runs and hostile values. Verify strings never yield active HTML or interactive malicious Markdown links.
5. CI: Node golden tests, browser keyboard/accessibility smoke tests, redaction/authorization integration test when native plugin exists.

**Acceptance:** Markdown file opens as a readable, self-contained trace investigation with clearly supported claims and UNKNOWN gaps. Values default off and cannot leak through alternative sections; selected export is labeled as a subset; output is reproducible for fixed time/inputs; no remote access or server mutation; hostile content remains inert in the report.
