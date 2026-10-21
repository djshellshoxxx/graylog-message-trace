import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTrace } from '../../web/trace.js';
import { normalizeTraceView } from '../../web/features/normalize.js';
import { buildFieldJourney } from '../../web/features/journey.js';
import { BOUNDARIES } from '../../web/features/coverage.js';

const view = raw => normalizeTraceView(validateTrace(raw));
const base = (fields, steps, extra = {}) => ({
  schema_version: 1, message: { index: 'network_42', id: 'opaque-1', fields }, steps, ...extra
});
const LOCAL = { source: 'LOCAL_FILE' };
const ATTESTED_ALL = { source: 'SERVER_ATTESTED_RECORDING', serverValidatedBoundaryIds: BOUNDARIES };
const hasGap = (j, text) => j.gaps.some(g => g.reason.includes(text));

test('missing to null to removed yields exactly two typed transitions', () => {
  const j = buildFieldJourney(view(base({}, [
    { label: 'create', provenance: 'RECORDED', before: {}, after: { f: null } },
    { label: 'remove', provenance: 'RECORDED', before: { f: null }, after: {} }
  ])), 'f', LOCAL);
  assert.equal(j.transitions.length, 2);
  assert.deepEqual(j.transitions.map(t => t.kind), ['CREATED', 'REMOVED']);
  assert.deepEqual(j.transitions[0].before, { present: false });
  assert.deepEqual(j.transitions[0].after, { present: true, value: null, type: 'null' });
  assert.deepEqual(j.transitions[1].after, { present: false });
  assert.deepEqual(j.finalState, { present: false });
});

test('null differs from a missing field and sits in the step order', () => {
  const j = buildFieldJourney(view(base({ f: null }, [
    { label: 'a', provenance: 'OBSERVED', before: {}, after: { f: null } }
  ])), 'f', LOCAL);
  assert.equal(j.transitions[0].kind, 'CREATED');
  assert.deepEqual(j.finalState, { present: true, value: null, type: 'null' });
});

test('number to string is a MODIFIED transition with distinct types', () => {
  const j = buildFieldJourney(view(base({ f: '42' }, [
    { label: 'cast', provenance: 'RECORDED', before: { f: 42 }, after: { f: '42' } }
  ])), 'f', LOCAL);
  assert.equal(j.transitions[0].kind, 'MODIFIED');
  assert.equal(j.transitions[0].before.type, 'number');
  assert.equal(j.transitions[0].after.type, 'string');
  assert.equal(j.finalState.type, 'string');
});

test('equal nested objects produce no transition', () => {
  const j = buildFieldJourney(view(base({ f: { a: [1, { b: 2 }] } }, [
    { label: 'same', provenance: 'RECORDED', before: { f: { a: [1, { b: 2 }] } }, after: { f: { a: [1, { b: 2 }] } } }
  ])), 'f', LOCAL);
  assert.deepEqual(j.transitions, []);
});

test('modified then reverted keeps both transitions', () => {
  const j = buildFieldJourney(view(base({ f: 'a' }, [
    { label: 'to b', provenance: 'RECORDED', before: { f: 'a' }, after: { f: 'b' } },
    { label: 'back', provenance: 'RECORDED', before: { f: 'b' }, after: { f: 'a' } }
  ])), 'f', LOCAL);
  assert.deepEqual(j.transitions.map(t => t.kind), ['MODIFIED', 'MODIFIED']);
  assert.deepEqual(j.transitions.map(t => t.stepIndex), [0, 1]);
});

test('a field removed from the final document is absent in finalState but its history remains', () => {
  const j = buildFieldJourney(view(base({}, [
    { label: 'add', provenance: 'RECORDED', before: {}, after: { tmp: 'x' } }
  ])), 'tmp', LOCAL);
  assert.equal(j.finalState.present, false);
  assert.equal(j.transitions.length, 1);
});

test('field names are case sensitive', () => {
  const j = buildFieldJourney(view(base({ Src: 'x' }, [
    { label: 'a', provenance: 'RECORDED', before: {}, after: { src: 'y' } }
  ])), 'Src', LOCAL);
  assert.equal(j.transitions.length, 0);
  assert.equal(j.finalState.present, true);
});

test('zero snapshots yields no transitions and an explicit unknown history', () => {
  const j = buildFieldJourney(view(base({ f: 1 }, [{ label: 'stored', provenance: 'OBSERVED' }])), 'f', LOCAL);
  assert.deepEqual(j.transitions, []);
  assert.ok(hasGap(j, 'No before/after snapshots'));
  assert.ok(hasGap(j, 'Original input and intermediate actions: UNKNOWN'));
  assert.deepEqual(j.finalState, { present: true, value: 1, type: 'number' });
});

test('a comparable before that disagrees with the previous after is an unobserved change, not a step', () => {
  const j = buildFieldJourney(view(base({ f: 3 }, [
    { label: 'one', provenance: 'RECORDED', before: {}, after: { f: 1 } },
    { label: 'two', provenance: 'RECORDED', before: { f: 2 }, after: { f: 3 } }
  ])), 'f', LOCAL);
  assert.equal(j.transitions.length, 2);
  const gap = j.gaps.find(g => g.reason === 'Unobserved intermediate change');
  assert.deepEqual(gap, { reason: 'Unobserved intermediate change', beforeStep: 0, afterStep: 1 });
});

test('steps without snapshots do not establish continuity', () => {
  const j = buildFieldJourney(view(base({ f: 1 }, [
    { label: 'snap', provenance: 'RECORDED', before: {}, after: { f: 1 } },
    { label: 'no snapshot', provenance: 'OBSERVED' }
  ])), 'f', LOCAL);
  assert.equal(j.gaps.some(g => g.reason === 'Unobserved intermediate change'), false);
});

test('replay last state that differs from the final value is reported without merging', () => {
  const j = buildFieldJourney(view(base({ f: 'final' }, [
    { label: 'replay', provenance: 'CURRENT_REPLAY', before: {}, after: { f: 'replayed' } }
  ])), 'f', LOCAL);
  assert.equal(j.transitions[0].provenance, 'CURRENT_REPLAY');
  assert.equal(j.transitions[0].after.value, 'replayed');
  assert.equal(j.finalState.value, 'final');
  assert.ok(hasGap(j, 'Replay/final discrepancy'));
});

test('replay steps keep their provenance and never supply an original-history attestation', () => {
  const j = buildFieldJourney(view(base({ f: 'x' }, [
    { label: 'replay', provenance: 'HISTORICAL_REPLAY', before: {}, after: { f: 'x' } }
  ])), 'f', ATTESTED_ALL);
  assert.equal(j.transitions[0].provenance, 'HISTORICAL_REPLAY');
  assert.equal(j.fullRecordedHistoryAttested, false);
  assert.ok(hasGap(j, 'Original input and intermediate actions: UNKNOWN'));
});

test('imported capture.complete=true is not a full attested history', () => {
  const j = buildFieldJourney(view(base({ f: 1 }, [
    { label: 'rec', provenance: 'RECORDED', before: {}, after: { f: 1 } }
  ], { capture: { complete: true, boundary: 'INPUT_TO_INDEX' } })), 'f', LOCAL);
  assert.equal(j.fullRecordedHistoryAttested, false);
});

test('a forged server source in a local import never attests history', () => {
  const j = buildFieldJourney(view(base({ f: 1 }, [
    { label: 'rec', provenance: 'RECORDED', before: {}, after: { f: 1 } }
  ], { capture: { complete: true, source: 'SERVER_COLLECTOR', boundary: 'INPUT_TO_INDEX' } })), 'f', { source: 'LOCAL_FILE', serverValidatedBoundaryIds: BOUNDARIES });
  assert.equal(j.fullRecordedHistoryAttested, false);
});

test('server-attested complete capture without loss attests full history and drops the general gap', () => {
  const j = buildFieldJourney(view(base({ f: 1 }, [
    { label: 'rec', provenance: 'RECORDED', before: {}, after: { f: 1 } }
  ], { capture: { complete: true, boundary: 'INPUT_TO_INDEX' } })), 'f', ATTESTED_ALL);
  assert.equal(j.fullRecordedHistoryAttested, true);
  assert.equal(hasGap(j, 'Original input and intermediate actions'), false);
});

test('loss reasons prevent full attested history', () => {
  const j = buildFieldJourney(view(base({ f: 1 }, [
    { label: 'rec', provenance: 'RECORDED', before: {}, after: { f: 1 } }
  ], { capture: { complete: true, boundary: 'INPUT_TO_INDEX', loss_reasons: ['queue drop'] } })), 'f', ATTESTED_ALL);
  assert.equal(j.fullRecordedHistoryAttested, false);
});

test('a redacted boundary adds a gap rather than implying the field was absent', () => {
  const j = buildFieldJourney(view(base({ f: 1 }, [], { visibility: { boundaries: { RULE_SOURCE: 'REDACTED_BY_PERMISSION', PIPELINE_PROCESSING: 'REDACTED_BY_PERMISSION' } } })), 'f', LOCAL);
  assert.ok(hasGap(j, 'hidden by permission'));
});

test('a malicious string value is kept as data and not interpreted', () => {
  const payload = '<img src=x onerror=alert(1)><script>x()</script>';
  const j = buildFieldJourney(view(base({ f: payload }, [
    { label: 'a', provenance: 'RECORDED', before: {}, after: { f: payload } }
  ])), 'f', LOCAL);
  assert.equal(j.transitions[0].after.value, payload);
  assert.equal(j.finalState.value, payload);
});

test('transitions keep original step indices, stable IDs and optional rule association', () => {
  const j = buildFieldJourney(view(base({ f: 2 }, [
    { label: 'skip', provenance: 'OBSERVED' },
    { label: 'rule', provenance: 'RECORDED', kind: 'RULE', id: 'r1', scope: { rule: 'rule-7' }, duration_us: 12, before: { f: 1 }, after: { f: 2 } },
    { label: 'plain', provenance: 'RECORDED', before: { f: 2 }, after: { f: 2, g: 1 } }
  ])), 'f', LOCAL);
  assert.equal(j.transitions.length, 1);
  assert.equal(j.transitions[0].stepIndex, 1);
  assert.equal(j.transitions[0].stepId, 'r1');
  assert.equal(j.transitions[0].associatedRuleId, 'rule-7');
  assert.equal(j.transitions[0].durationUs, 12);

  const noRule = buildFieldJourney(view(base({ f: 2 }, [
    { label: 'plain', provenance: 'RECORDED', before: { f: 1 }, after: { f: 2 } }
  ])), 'f', LOCAL);
  assert.equal(noRule.transitions[0].stepId, '#0');
  assert.equal('associatedRuleId' in noRule.transitions[0], false);
});

test('field selection uses the same trace and does not change its inputs', () => {
  const raw = base({ f: 'b' }, [{ label: 'x', provenance: 'RECORDED', before: { f: 'a' }, after: { f: 'b' } }]);
  const before = structuredClone(raw);
  const v = view(raw);
  const a = buildFieldJourney(v, 'f', LOCAL);
  assert.deepEqual(buildFieldJourney(v, 'f', LOCAL), a);
  assert.deepEqual(raw, before);
  assert.equal(Object.isFrozen(a), true);
  assert.equal(Object.isFrozen(a.transitions), true);
});

test('non-string field names are rejected', () => {
  assert.throws(() => buildFieldJourney(view(base({}, [])), 42, LOCAL), TypeError);
});
