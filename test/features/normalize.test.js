import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTraceView } from '../../web/features/normalize.js';

const trace = { schema_version: 1, message: { index: 'i', id: 'a', fields: { m: 'x' } }, steps: [
  { label: 'a', provenance: 'OBSERVED' },
  { label: 'b', provenance: 'RECORDED', kind: 'RULE', outcome: 'FAILED', id: 'r1', before: { a: 1 }, after: { a: 1 } },
  { label: 'c', provenance: 'CURRENT_REPLAY', kind: 'bogus', before: {}, after: { z: null } }
] };

test('normalizes without guessing and memoizes', () => {
  const v = normalizeTraceView(trace);
  assert.equal(v, normalizeTraceView(trace));
  assert.equal(v.steps[0].kind, 'OTHER');
  assert.equal(v.steps[0].outcome, undefined);
  assert.equal(v.steps[1].key, 'r1');
  assert.equal(v.steps[1].hasChange, false);
  assert.deepEqual(v.steps[2].changedFields, ['z']);
  assert.equal(v.steps[2].kind, 'OTHER');
  assert.deepEqual(v.fieldNames, ['a', 'm', 'z']);
});
