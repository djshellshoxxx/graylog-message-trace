import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateTrace, fieldDiff, fieldHistory, traceSummary, diagnostics } from '../web/trace.js';
const fixture = () => ({ schema_version: 1, message: { id: 'a', index: 'network_42', fields: {} }, steps: [] });
test('requires canonical identity and known provenance', () => {
  assert.throws(() => validateTrace({}));
  const t = fixture(); t.steps = [{ label: 'rule', provenance: 'EXACT' }];
  assert.throws(() => validateTrace(t));
  t.steps = [{ label: 'rule', provenance: 'OBSERVED', before: {} }];
  assert.throws(() => validateTrace(t));
});
test('diff distinguishes missing, null, type changes and nested equality', () => {
  const diff = fieldDiff({ gone: null, type: 5, same: { a: 1, b: 2 } }, { added: null, type: '5', same: { b: 2, a: 1 } });
  assert.deepEqual(diff.map(d => [d.field, d.kind]), [['added', 'CREATED'], ['gone', 'REMOVED'], ['type', 'MODIFIED']]);
});
test('prototype-shaped keys remain data', () => {
  assert.equal(fieldDiff({}, JSON.parse('{"__proto__":null}'))[0].kind, 'CREATED');
});
test('field history retains provenance and execution order', () => {
  const t = fixture(); t.steps = [{ label: 'rule', provenance: 'CURRENT_REPLAY', before: {}, after: { x: 2 } }];
  assert.equal(fieldHistory(t, 'x')[0].provenance, 'CURRENT_REPLAY');
  assert.match(traceSummary(t), /not proven/);
});
test('partial and mixed traces cannot become complete recorded traces', () => {
  const t = fixture(); t.steps = [{ label: 'rule', provenance: 'RECORDED' }];
  assert.match(traceSummary(t), /Partial/);
  t.capture = { complete: true }; t.steps.push({ label: 'replay', provenance: 'CURRENT_REPLAY' });
  assert.match(traceSummary(t), /not proven/);
});
test('validation detaches evidence and rejects invalid timings', () => {
  const t = fixture(); const copy = validateTrace(t); copy.message.fields.x = 1;
  assert.equal(t.message.fields.x, undefined);
  t.steps = [{ label: 'x', provenance: 'OBSERVED', duration_us: -1 }];
  assert.throws(() => validateTrace(t));
});
test('final document replay has an explicit diagnostic', () => {
  const t = fixture(); t.replay_input = 'FINAL_DOCUMENT';
  assert.match(diagnostics(t)[0], /final indexed document/);
});
test('bundled example conforms to the development contract', async () => {
  const t = validateTrace(JSON.parse(await readFile(new URL('../web/example.json', import.meta.url), 'utf8')));
  assert.equal(t.message.id, 'synthetic-example');
  assert.equal(fieldHistory(t, 'stp_port')[0].kind, 'CREATED');
  assert.match(traceSummary(t), /not proven/);
});
test('nested diffs do not share mutable values with source snapshots', () => {
  const after = { x: [1, { y: 2 }] };
  const diff = fieldDiff({}, after); after.x[1].y = 3;
  assert.equal(diff[0].after[1].y, 2);
});
test('inferred steps prevent a complete-recording summary', () => {
  const t = fixture(); t.capture = { complete: true };
  t.steps = [{ label: 'rule', provenance: 'RECORDED' }, { label: 'input', provenance: 'INFERRED' }];
  assert.match(traceSummary(t), /Partial/);
});

test('field-history lookup does not scan unrelated nested fields', () => {
  const unrelated = () => new Proxy({}, {
    ownKeys() { throw new Error('Unrelated nested field was inspected'); }
  });
  const t = fixture();
  t.steps = [{ label: 'change', provenance: 'RECORDED',
    before: { selected: 1, unrelated: unrelated() },
    after: { selected: 2, unrelated: unrelated() }
  }];
  assert.deepEqual(fieldHistory(t, 'selected').map(change => [change.field, change.kind]),
    [['selected', 'MODIFIED']]);
});

test('field-history lookup retains prototype-shaped field names', () => {
  const t = fixture();
  t.steps = [{ label: 'field', provenance: 'RECORDED',
    before: {}, after: JSON.parse('{"__proto__":null}') }];
  assert.equal(fieldHistory(t, '__proto__')[0].kind, 'CREATED');
});

test('validator rejects deeply nested evidence before diff or rendering can overflow', () => {
  const trace = fixture();
  let value = 'leaf';
  for (let i = 0; i < 150; i++) value = { child: value };
  trace.message.fields.deep = value;
  assert.throws(() => validateTrace(trace), /nesting limit/i);
});

test('validator rejects non-JSON cyclic evidence', () => {
  const trace = fixture();
  const loop = {};
  loop.self = loop;
  trace.message.fields.cycle = loop;
  assert.throws(() => validateTrace(trace), /cyclic|reference/i);
});

test('validator preserves null values in imported JSON evidence', () => {
  const trace = fixture();
  trace.message.fields.optional = null;
  trace.steps = [{ label: 'create', provenance: 'RECORDED',
    before: {}, after: { optional: null } }];
  assert.equal(validateTrace(trace).message.fields.optional, null);
});
