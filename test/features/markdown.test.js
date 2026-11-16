import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTrace } from '../../web/trace.js';
import { normalizeTraceView } from '../../web/features/normalize.js';
import { escapeText, investigationFilename, makeInvestigationMarkdown, MAX_EXPORT_BYTES } from '../../web/features/markdown.js';

const ALL = new Set(['FLOW', 'FIELDS', 'DIAGNOSTICS', 'TOPOLOGY', 'RAW']);
const GENERATED = '2026-10-13T00:00:00Z';
const SECRET = 'zq9Xk';

function fixture(overrides = {}) {
  const raw = {
    schema_version: 1,
    message: { index: 'network_42', id: 'opaque-id', fields: { message: `hello ${SECRET}`, gl2_processing_error: 'boom' } },
    steps: [
      { label: `Stored final message document ${SECRET}`, provenance: 'OBSERVED', kind: 'INDEX' },
      { label: 'Rule evaluated', provenance: 'RECORDED', kind: 'RULE', outcome: 'MATCHED', id: 'r1', sequence: 0,
        before: { message: `raw ${SECRET}` }, after: { message: `hello ${SECRET}`, extra: 1 } },
      { label: 'Replay', provenance: 'CURRENT_REPLAY', kind: 'DIAGNOSTIC', duration_us: 12,
        before: {}, after: { extra: null } },
      { label: 'Stream route', provenance: 'RECORDED', kind: 'STREAM', outcome: 'UNKNOWN' }
    ],
    capture: { complete: false, source: 'FILE_IMPORT' },
    replay_input: 'FINAL_DOCUMENT',
    ...overrides
  };
  return validateTrace(raw);
}

const view = (trace) => normalizeTraceView(trace);
const opts = (extra = {}) => ({
  scope: 'FULL', includeFieldValues: false, sections: new Set(ALL), generatedAtIso: GENERATED, ...extra
});

test('escapeText neutralizes HTML, links, autolinks, pipes, backslashes and control characters', () => {
  const hostile = '<script>x</script> [a](javascript:alert(1)) <!-- c --> a|b \\ `code` http://evil.test www.x.test a@b.test\n‮end\u0007';
  const out = escapeText(hostile);
  assert.ok(!/(?<!\\)</.test(out), 'no unescaped <');
  assert.ok(!/(?<!\\)\]\(/.test(out), 'no unescaped link syntax');
  assert.ok(!out.includes('javascript:'), 'colon escaped');
  assert.ok(!out.includes('http://') && !out.includes('www.') && !out.includes('a@b'), 'no autolink triggers');
  assert.ok(!out.includes('\n') && !out.includes('‮') && !out.includes('\u0007'));
  assert.ok(out.includes('\\\\n') && out.includes('\\\\u202E') && out.includes('\\\\u0007'));
  assert.equal(escapeText('plain text 1'), 'plain text 1');
});

test('report has the required structure, UTF-8 and LF only', () => {
  const r = makeInvestigationMarkdown(view(fixture()), opts());
  const lines = r.text.split('\n');
  assert.equal(lines[0], '# Message Trace Investigation');
  assert.ok(r.text.includes('- Report format: 1'));
  assert.ok(r.text.includes(`- Generated: ${GENERATED}`));
  assert.ok(r.text.includes('- Physical index: network\\_42'));
  assert.ok(r.text.includes('- Message ID: opaque\\-id'));
  assert.ok(!r.text.includes('\r'));
  assert.equal(r.byteCount, Buffer.byteLength(r.text, 'utf8'));
  const headings = lines.filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
  assert.deepEqual(headings, ['Evidence Coverage', 'Diagnostics', 'Flow Evidence', 'Field Journey',
    'Raw Message', 'Current Topology', 'Unknowns and Limitations']);
  assert.equal(r.truncated, false);
  assert.deepEqual(r.warnings, []);
});

test('default names-and-types mode never leaks values, labels or scope IDs', () => {
  const r = makeInvestigationMarkdown(view(fixture()), opts());
  assert.ok(!r.text.includes(SECRET), 'no value or label text');
  assert.ok(r.text.includes('label omitted'));
  assert.ok(r.text.includes('message: string') || r.text.includes('message'), 'names and types present');
  assert.ok(r.text.includes('Field values are omitted'));
});

test('opt-in values appear escaped in the journey and raw sections', () => {
  const r = makeInvestigationMarkdown(view(fixture()), opts({ includeFieldValues: true }));
  assert.ok(r.text.includes(SECRET));
  assert.ok(r.text.includes(`\\"hello ${SECRET}\\"`));
});

const unlabelled = (steps) => steps.map((s) => ({ ...s, label: 'step' }));

test('server-redacted values are never shown even when values are enabled', () => {
  const trace = fixture({ visibility: { redacted_fields: ['message'] }, steps: unlabelled(fixture().steps) });
  const r = makeInvestigationMarkdown(view(trace), opts({ includeFieldValues: true }));
  assert.ok(!r.text.includes(SECRET));
  assert.ok(r.text.includes('REDACTED'));
  assert.ok(r.warnings.some((w) => w.includes('withheld')));
});

test('whole-trace permission redaction blocks values', () => {
  const trace = fixture({ visibility: { state: 'REDACTED_BY_PERMISSION' }, steps: unlabelled(fixture().steps) });
  const r = makeInvestigationMarkdown(view(trace), opts({ includeFieldValues: true }));
  assert.ok(!r.text.includes(SECRET));
});

test('step-level redaction hides that step snapshot values', () => {
  const raw = {
    schema_version: 1, message: { index: 'i', id: 'a', fields: {} },
    steps: [{ label: 'x', provenance: 'RECORDED', visibility: { state: 'REDACTED_BY_PERMISSION' },
      before: { f: SECRET }, after: { f: 'other' } }]
  };
  const r = makeInvestigationMarkdown(view(validateTrace(raw)), opts({ includeFieldValues: true }));
  assert.ok(!r.text.includes(SECRET));
  assert.ok(r.text.includes('other'));
});

test('evidence coverage marks missing original history and does not promote imported completeness', () => {
  const raw = { schema_version: 1, message: { index: 'i', id: 'a', fields: { m: 'x' } },
    steps: [{ label: 'Stored', provenance: 'OBSERVED' }], capture: { complete: true, source: 'FILE_IMPORT' } };
  const r = makeInvestigationMarkdown(view(validateTrace(raw)), opts());
  assert.ok(r.text.includes('- Original execution: UNKNOWN'));
  assert.ok(r.text.includes('- Historical pipeline execution: UNKNOWN'));
  assert.ok(r.text.includes('routing history: UNKNOWN'));
  assert.ok(!/\bexact\b/i.test(r.text));
});

test('imported recording claiming completeness is labeled unverified', () => {
  const r = makeInvestigationMarkdown(view(fixture({ capture: { complete: true, source: 'FILE_IMPORT' } })), opts());
  assert.ok(r.text.includes('import claims complete (not verified)'));
  assert.ok(r.text.includes('imported file (unverified)'));
  assert.ok(r.text.includes('Replay steps describe the replay only'));
});

test('visible selection keeps original order, labels the subset and keeps coverage from the full trace', () => {
  const v = view(fixture());
  const full = makeInvestigationMarkdown(v, opts());
  const sub = makeInvestigationMarkdown(v, opts({ scope: 'VISIBLE_SELECTION', selectedStepIndices: [3, 1] }));
  assert.ok(sub.text.includes('selected subset (2 of 4 steps) INCOMPLETE SUBSET'));
  assert.ok(sub.warnings[0].startsWith('INCOMPLETE SUBSET'));
  const flow = sub.text.split('## Flow Evidence')[1].split('## Field Journey')[0];
  assert.ok(flow.indexOf('step #1') < flow.indexOf('step #3'));
  assert.ok(!flow.includes('step #0') && !flow.includes('step #2'));
  const cov = (t) => t.split('## Evidence Coverage')[1].split('## Diagnostics')[0];
  assert.equal(cov(sub.text), cov(full.text));
});

test('empty selection is allowed and reports zero steps', () => {
  const r = makeInvestigationMarkdown(view(fixture()), opts({ scope: 'VISIBLE_SELECTION', selectedStepIndices: [] }));
  assert.ok(r.text.includes('No steps selected.'));
  assert.ok(r.text.includes('0 of 4 steps'));
});

test('disabled optional sections are explicit, not silently missing', () => {
  const r = makeInvestigationMarkdown(view(fixture()), opts({ sections: new Set(['RAW']) }));
  assert.ok(r.text.includes('## Flow Evidence\n- Not included'));
  assert.ok(r.text.includes('Sections not included: FLOW, FIELDS, DIAGNOSTICS, TOPOLOGY'));
  assert.ok(r.text.includes('## Unknowns and Limitations'));
});

test('hostile content stays inert in every section', () => {
  const hostile = '<script>alert(1)</script> [x](javascript:alert(1)) ![i](http://e.test/a.png) <img src=x onerror=1>';
  const raw = { schema_version: 1, message: { index: hostile, id: hostile, fields: { [hostile]: hostile } },
    steps: [{ label: hostile, provenance: 'RECORDED', id: hostile, kind: 'DIAGNOSTIC',
      before: { [hostile]: hostile }, after: { [hostile]: 1 } }] };
  const r = makeInvestigationMarkdown(view(validateTrace(raw)), opts({ includeFieldValues: true }));
  assert.ok(!/(?<!\\)</.test(r.text));
  assert.ok(!/(?<!\\)\]\(/.test(r.text));
  assert.ok(!r.text.includes('javascript:') && !r.text.includes('http://'));
});

test('long values are previewed within the per-value limit and warned about', () => {
  const big = 'é'.repeat(2000);
  const raw = { schema_version: 1, message: { index: 'i', id: 'a', fields: { big } }, steps: [] };
  const r = makeInvestigationMarkdown(view(validateTrace(raw)), opts({ includeFieldValues: true }));
  assert.equal(r.truncated, true);
  assert.ok(r.warnings.some((w) => w.includes('truncated to 1024 bytes')));
  assert.ok(r.text.includes('\\.\\.\\.'));
  assert.ok(!r.text.includes('é'.repeat(1000)));
});

test('whole export is capped at 2 MiB with explicit truncation warnings', () => {
  const value = 'v'.repeat(900);
  const steps = Array.from({ length: 10000 }, (_, i) => ({
    label: `step ${i}`, provenance: 'RECORDED', before: { f: value }, after: { f: value + i }
  }));
  const raw = { schema_version: 1, message: { index: 'i', id: 'a', fields: { f: value } }, steps };
  const r = makeInvestigationMarkdown(view(validateTrace(raw)), opts({ includeFieldValues: true }));
  assert.equal(r.truncated, true);
  assert.ok(r.byteCount <= MAX_EXPORT_BYTES);
  assert.ok(r.text.includes('> WARNING: Export truncated'));
  assert.ok(r.text.includes('> TRUNCATED:'));
  assert.ok(r.text.includes('## Unknowns and Limitations'), 'mandatory tail survives truncation');
});

test('output is deterministic and only the injected timestamp changes', () => {
  const v = view(fixture());
  const a = makeInvestigationMarkdown(v, opts({ includeFieldValues: true }));
  const b = makeInvestigationMarkdown(v, opts({ includeFieldValues: true }));
  assert.equal(a.text, b.text);
  const c = makeInvestigationMarkdown(v, opts({ includeFieldValues: true, generatedAtIso: '2026-10-14T01:02:03Z' }));
  assert.equal(c.text.replace('2026-10-14T01:02:03Z', GENERATED), a.text);
});

test('coverage text is supplied via option and escaped', () => {
  const r = makeInvestigationMarkdown(view(fixture()), opts({ coverageText: 'Stage A: <b>x</b>\n\n  Stage B [y](z)' }));
  assert.ok(r.text.includes('- Coverage report (caller supplied):'));
  assert.ok(r.text.includes('  - Stage A\\: \\<b\\>x\\<\\/b\\>'));
  assert.ok(r.text.includes('  - Stage B \\[y\\]\\(z\\)'));
  assert.ok(!/(?<!\\)</.test(r.text));
});

test('malformed options and selections are rejected', () => {
  const v = view(fixture());
  const bad = [
    [{ ...opts(), scope: 'ALL' }, RangeError],
    [{ ...opts(), includeFieldValues: 'yes' }, TypeError],
    [{ ...opts(), sections: ['RAW'] }, TypeError],
    [{ ...opts(), sections: new Set(['NOPE']) }, RangeError],
    [{ ...opts(), generatedAtIso: '2026-13-45T00:00:00Z' }, RangeError],
    [{ ...opts(), generatedAtIso: '2026-10-13T00:00:00+02:00' }, RangeError],
    [{ ...opts(), extra: 1 }, TypeError],
    [{ ...opts(), selectedStepIndices: [0] }, TypeError],
    [{ ...opts({ scope: 'VISIBLE_SELECTION' }) }, TypeError],
    [{ ...opts({ scope: 'VISIBLE_SELECTION', selectedStepIndices: [4] }) }, RangeError],
    [{ ...opts({ scope: 'VISIBLE_SELECTION', selectedStepIndices: [1, 1] }) }, RangeError],
    [{ ...opts({ scope: 'VISIBLE_SELECTION', selectedStepIndices: [-1] }) }, RangeError],
    [{ ...opts({ scope: 'VISIBLE_SELECTION', selectedStepIndices: [1.5] }) }, RangeError],
    [{ ...opts(), coverageText: 5 }, TypeError],
    [{ ...opts(), selectedFieldNames: 'message' }, TypeError]
  ];
  for (const [options, error] of bad) {
    assert.throws(() => makeInvestigationMarkdown(v, options), error);
  }
  assert.throws(() => makeInvestigationMarkdown({ trace: {}, steps: [] }, opts()), TypeError);
});

test('unknown selected field names are ignored with a warning', () => {
  const r = makeInvestigationMarkdown(view(fixture()), opts({ selectedFieldNames: ['message', 'nope'] }));
  assert.ok(r.warnings.some((w) => w.includes('1 selected field name(s)')));
  assert.ok(!r.text.includes('- nope'));
});

test('empty trace produces a complete report', () => {
  const raw = { schema_version: 1, message: { index: 'i', id: 'a', fields: {} }, steps: [] };
  const r = makeInvestigationMarkdown(view(validateTrace(raw)), opts());
  assert.ok(r.text.includes('- Original execution: UNKNOWN'));
  assert.ok(r.text.includes('No diagnostics derived'));
  assert.ok(r.text.includes('No fields in this trace.'));
});

test('filename uses fixed prefix, UTC date and a short hash without field content', () => {
  const name = investigationFilename(GENERATED, 'network_42', 'opaque-id');
  assert.match(name, /^message-trace-20261013-[0-9a-f]{6}\.md$/);
  assert.equal(name, investigationFilename(GENERATED, 'network_42', 'opaque-id'));
  assert.notEqual(name, investigationFilename(GENERATED, 'network_42', 'other-id'));
  assert.throws(() => investigationFilename('bad', 'i', 'a'), RangeError);
});
