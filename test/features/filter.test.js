import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTrace } from '../../web/trace.js';
import { normalizeTraceView } from '../../web/features/normalize.js';
import {
  defaultFlowFilter, filterFlow, applyPreset, validateFlowFilter, FLOW_PRESETS
} from '../../web/features/filter.js';

// Indices 0..9 cover: unknown kind/outcome, null creation, reported failures, two provenance
// classes, equal-value and empty snapshots, replay, bogus kind, and explicit UNKNOWN outcome.
const RAW = {
  schema_version: 1,
  message: { index: 'network_42', id: 'msg-1', fields: { m: 'x' } },
  steps: [
    { label: 'Ingest', provenance: 'OBSERVED' },
    { label: 'Codec parse', provenance: 'RECORDED', kind: 'CODEC', outcome: 'EXECUTED', duration_us: 5, before: { a: 1 }, after: { a: 2 } },
    { label: 'Rule failed', provenance: 'RECORDED', kind: 'RULE', outcome: 'FAILED', duration_us: 900, before: {}, after: {} },
    { label: 'Stream check', provenance: 'RECORDED', kind: 'STREAM', outcome: 'MATCHED', before: { s: 'a' }, after: { s: 'a' } },
    { label: 'Pipeline replay', provenance: 'CURRENT_REPLAY', kind: 'PIPELINE', outcome: 'EXECUTED', duration_us: 1200, before: {}, after: { x: null } },
    { label: 'Stage replay', provenance: 'HISTORICAL_REPLAY', kind: 'STAGE', outcome: 'SKIPPED', duration_us: 50, before: { y: 1 }, after: {} },
    { label: 'Unknown outcome', provenance: 'UNKNOWN', kind: 'EVENT', outcome: 'UNKNOWN' },
    { label: 'Bogus kind', provenance: 'OBSERVED', kind: 'BOGUS', outcome: 'FAILED' },
    { label: 'Index write', provenance: 'RECORDED', kind: 'INDEX', outcome: 'DROPPED', duration_us: 10, before: { k: 1 }, after: { k: 1, m: 2 } },
    { label: 'Diagnostic', provenance: 'RECONSTRUCTED', kind: 'DIAGNOSTIC', before: {}, after: {} }
  ]
};

const T = validateTrace(RAW);
const VIEW = normalizeTraceView(T);
const run = filter => filterFlow(VIEW, filter).indices;
const withFilter = patch => ({ ...defaultFlowFilter(), ...patch });

test('defaults show every step and report trace-wide metadata gaps', () => {
  const result = filterFlow(VIEW, defaultFlowFilter());
  assert.deepEqual([...result.indices], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(result.total, 10);
  assert.equal(result.shown, 10);
  assert.deepEqual([...result.missingMetadata], ['kind', 'outcome']);
});

test('every preset yields its documented indices', () => {
  const expected = {
    'All steps': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    'Changed fields': [1, 4, 5, 8],
    'Known failures': [2, 7],
    'Stream routing': [3],
    'Rules and pipelines': [2, 4, 5],
    'Unknown / incomplete': [6],
    'Replay only': [4, 5]
  };
  assert.deepEqual([...FLOW_PRESETS], Object.keys(expected));
  for (const [name, indices] of Object.entries(expected)) {
    assert.deepEqual([...run(applyPreset(name))], indices, name);
  }
});

test('kind filter with unknown-kind control', () => {
  assert.deepEqual([...run(withFilter({ kinds: new Set(['CODEC']) }))], [0, 1, 7]);
  assert.deepEqual([...run(withFilter({ kinds: new Set(['CODEC']), includeUnknownKind: false }))], [1]);
  // Absent kind normalizes to OTHER, so OTHER matches it as well.
  assert.deepEqual([...run(withFilter({ kinds: new Set(['OTHER']), includeUnknownKind: false }))], [0, 7]);
});

test('ordinary outcome filter treats absent outcome as UNKNOWN', () => {
  assert.deepEqual([...run(withFilter({ outcomes: new Set(['UNKNOWN']) }))], [0, 6, 9]);
  assert.deepEqual([...run(withFilter({ outcomes: new Set(['FAILED']) }))], [2, 7]);
});

test('provenance filter uses exact provenance values', () => {
  assert.deepEqual([...run(withFilter({ provenance: new Set(['RECORDED']) }))], [1, 2, 3, 8]);
});

test('minimum duration excludes steps without duration and keeps source order', () => {
  assert.deepEqual([...run(withFilter({ minDurationUs: 100 }))], [2, 4]);
  assert.deepEqual([...run(withFilter({ minDurationUs: 0 }))], [1, 2, 4, 5, 8]);
  assert.ok(filterFlow(VIEW, withFilter({ minDurationUs: 100 })).missingMetadata.includes('duration_us'));
});

test('changed-only requires paired snapshots with a real value change', () => {
  // Step 2 (empty snapshots) and step 3 (equal values) must not match.
  assert.deepEqual([...run(withFilter({ changedOnly: true }))], [1, 4, 5, 8]);
  assert.deepEqual([...run(withFilter({ changedOnly: true, outcomes: new Set(['FAILED']) }))], []);
  assert.ok(filterFlow(VIEW, withFilter({ changedOnly: true })).missingMetadata.includes('snapshots'));
});

test('unknown/incomplete preset combines signals as OR, not AND', () => {
  // Provenance UNKNOWN (step 6) OR outcome FAILED (steps 2, 7) under OR mode.
  assert.deepEqual([...run(withFilter({
    provenance: new Set(['UNKNOWN']), outcomes: new Set(['FAILED']), unknownSignalsOr: true
  }))], [2, 6, 7]);
  // The same chips under ordinary AND semantics match nothing.
  assert.deepEqual([...run(withFilter({
    provenance: new Set(['UNKNOWN']), outcomes: new Set(['FAILED'])
  }))], []);
});

test('clearing filters restores the full sequence without touching the trace', () => {
  run(applyPreset('Replay only'));
  assert.deepEqual([...run(defaultFlowFilter())], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('validateFlowFilter rejects invalid input with messages', () => {
  assert.equal(validateFlowFilter(defaultFlowFilter()).valid, true);
  const bad = [
    withFilter({ minDurationUs: Number.NaN }),
    withFilter({ minDurationUs: Infinity }),
    withFilter({ minDurationUs: -1 }),
    withFilter({ minDurationUs: '100' }),
    withFilter({ kinds: ['RULE'] }),
    withFilter({ kinds: new Set() }),
    withFilter({ kinds: new Set(['NOPE']) }),
    withFilter({ outcomes: new Set(['NOPE']) }),
    withFilter({ provenance: new Set(['MADE_UP']) }),
    withFilter({ changedOnly: 'yes' }),
    null
  ];
  for (const filter of bad) {
    const result = validateFlowFilter(filter);
    assert.equal(result.valid, false, JSON.stringify(filter));
    assert.ok(result.errors.length > 0);
  }
});

test('filterFlow refuses invalid filters and non-views', () => {
  assert.throws(() => filterFlow(VIEW, withFilter({ minDurationUs: Number.NaN })), RangeError);
  assert.throws(() => filterFlow(T, defaultFlowFilter()), TypeError);
});

test('applyPreset returns fresh objects and rejects unknown names', () => {
  const a = applyPreset('Known failures');
  a.outcomes.add('EXECUTED');
  assert.deepEqual([...applyPreset('Known failures').outcomes], ['FAILED']);
  assert.throws(() => applyPreset('Nope'), RangeError);
  for (const name of FLOW_PRESETS) assert.equal(validateFlowFilter(applyPreset(name)).valid, true, name);
});

test('filtering never mutates the imported trace or the view', () => {
  const snapshot = structuredClone(T);
  const viewSnapshot = structuredClone(VIEW.steps.map(s => ({ ...s, step: undefined })));
  for (const name of FLOW_PRESETS) run(applyPreset(name));
  assert.deepEqual(T, snapshot);
  assert.deepEqual(VIEW.steps.map(s => ({ ...s, step: undefined })), viewSnapshot);
});

// Deterministic 10,000-step stress fixture with an independent oracle for each predicate.
function bigTrace() {
  const provs = ['OBSERVED', 'RECORDED', 'CURRENT_REPLAY', 'HISTORICAL_REPLAY', 'UNKNOWN', 'RECONSTRUCTED', 'INFERRED'];
  const kinds = ['RULE', 'PIPELINE', 'STAGE', 'STREAM', 'CODEC', 'OTHER'];
  const outcomes = ['EXECUTED', 'FAILED', 'MATCHED', 'NOT_MATCHED', 'SKIPPED', 'DROPPED', 'UNKNOWN'];
  const steps = [];
  for (let i = 0; i < 10000; i += 1) {
    const step = { label: `step ${i}`, provenance: provs[i % 7], outcome: outcomes[i % 7] };
    if (i % 11 !== 0) step.kind = kinds[i % 6];
    if (i % 3 === 0) { step.before = { v: i }; step.after = { v: i + 1 }; }
    else if (i % 3 === 1) { step.before = { v: 1 }; step.after = { v: 1 }; }
    if (i % 5 !== 0) step.duration_us = i % 1000;
    steps.push(step);
  }
  return validateTrace({ schema_version: 1, message: { index: 'big', id: 'big-1', fields: {} }, steps });
}

const indicesWhere = pred => Array.from({ length: 10000 }, (_, i) => i).filter(pred);

test('10,000-step stress: exact indices and bounded time per filter', () => {
  const big = bigTrace();
  const view = normalizeTraceView(big);
  const cases = [
    [applyPreset('Known failures'), i => i % 7 === 1],
    [applyPreset('Changed fields'), i => i % 3 === 0],
    [applyPreset('Stream routing'), i => i % 6 === 3 && i % 11 !== 0],
    [applyPreset('Rules and pipelines'), i => i % 6 <= 2 && i % 11 !== 0],
    [applyPreset('Replay only'), i => i % 7 === 2 || i % 7 === 3],
    [applyPreset('Unknown / incomplete'), i => i % 7 === 4 || i % 7 === 6],
    [withFilter({ minDurationUs: 500 }), i => i % 5 !== 0 && i % 1000 >= 500],
    [withFilter({ changedOnly: true, outcomes: new Set(['FAILED']) }), i => i % 3 === 0 && i % 7 === 1]
  ];
  for (const [filter, oracle] of cases) {
    const started = performance.now();
    const result = filterFlow(view, filter);
    const elapsed = performance.now() - started;
    assert.deepEqual([...result.indices], indicesWhere(oracle));
    assert.equal(result.shown, result.indices.length);
    assert.ok(elapsed < 250, `filter took ${elapsed.toFixed(1)} ms`);
  }
});
