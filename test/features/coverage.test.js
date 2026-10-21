import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTrace } from '../../web/trace.js';
import { normalizeTraceView } from '../../web/features/normalize.js';
import { buildCoverage, BOUNDARIES, COVERAGE_STATES } from '../../web/features/coverage.js';

const view = raw => normalizeTraceView(validateTrace(raw));
const base = (extra = {}) => ({ schema_version: 1, message: { index: 'network_42', id: 'opaque-1', fields: { message: 'x' } }, steps: [], ...extra });
const states = (report, boundary) => report.boundaries[boundary].map(c => c.state);
const allClaims = report => BOUNDARIES.flatMap(b => report.boundaries[b]);
const LOCAL = { source: 'LOCAL_FILE' };
const API = { source: 'GRAYLOG_AUTHORIZED_API' };

test('stored facts only: index is a stored fact, everything else is unavailable', () => {
  const r = buildCoverage(view(base({ steps: [{ label: 'Stored final message document', provenance: 'OBSERVED' }] })), API);
  assert.deepEqual(states(r, 'INDEX_STORAGE'), ['STORED_FACT', 'UNAVAILABLE']);
  assert.equal(r.boundaries.INDEX_STORAGE[0].provenance, 'OBSERVED');
  for (const b of BOUNDARIES.filter(b => b !== 'INDEX_STORAGE')) assert.deepEqual(states(r, b), ['UNAVAILABLE'], b);
  assert.equal(r.importedClaimsUnverified, false);
});

test('imported RECORDED with capture.complete=true stays unverified and never supported', () => {
  const r = buildCoverage(view(base({
    capture: { complete: true },
    steps: [{ label: 'Input', provenance: 'RECORDED', kind: 'INPUT' }, { label: 'Rule', provenance: 'RECORDED', kind: 'RULE' }]
  })), LOCAL);
  assert.deepEqual(states(r, 'INPUT_RECEIPT'), ['UNVERIFIED_CLAIM', 'UNAVAILABLE']);
  assert.deepEqual(states(r, 'PIPELINE_PROCESSING'), ['UNVERIFIED_CLAIM', 'UNAVAILABLE']);
  assert.equal(allClaims(r).some(c => c.state === 'SUPPORTED_RECORDED'), false);
  assert.equal(r.importedClaimsUnverified, true);
  assert.ok(r.warnings.includes('Imported evidence is unverified.'));
  assert.ok(r.warnings.some(w => w.includes('capture.complete=true is an unverified claim')));
});

test('forgeable capture.source cannot change trust for a local import', () => {
  const r = buildCoverage(view(base({
    capture: { complete: true, source: 'SERVER_COLLECTOR', boundary: 'INPUT_TO_INDEX' },
    steps: [{ label: 'x', provenance: 'RECORDED', kind: 'INPUT' }]
  })), { source: 'LOCAL_FILE', serverValidatedBoundaryIds: BOUNDARIES });
  assert.equal(allClaims(r).some(c => c.state === 'SUPPORTED_RECORDED' || c.isAttested), false);
  assert.equal(r.importedClaimsUnverified, true);
  assert.ok(r.warnings.some(w => w.includes('capture.source is not trusted')));
});

test('a missing trust context is treated as the least trusted source', () => {
  const r = buildCoverage(view(base({ steps: [{ label: 'x', provenance: 'RECORDED', kind: 'INPUT' }] })), undefined);
  assert.deepEqual(states(r, 'INPUT_RECEIPT'), ['UNVERIFIED_CLAIM', 'UNAVAILABLE']);
});

test('server-attested boundaries become SUPPORTED_RECORDED only for validated ids', () => {
  const r = buildCoverage(view(base({
    steps: [{ label: 'in', provenance: 'RECORDED', kind: 'INPUT' }, { label: 'idx', provenance: 'RECORDED', kind: 'INDEX' }]
  })), { source: 'SERVER_ATTESTED_RECORDING', serverValidatedBoundaryIds: ['INPUT_RECEIPT', 'NOT_A_BOUNDARY'] });
  const input = r.boundaries.INPUT_RECEIPT.find(c => c.state === 'SUPPORTED_RECORDED');
  assert.ok(input);
  assert.equal(input.isAttested, true);
  assert.equal(input.provenance, 'RECORDED');
  assert.deepEqual(states(r, 'INDEX_STORAGE').includes('SUPPORTED_RECORDED'), false);
  assert.deepEqual(states(r, 'INDEX_STORAGE').includes('UNVERIFIED_CLAIM'), true);
  assert.equal(r.boundaries.NOT_A_BOUNDARY, undefined);
});

test('loss reasons or incomplete capture downgrade recorded claims to PARTIAL', () => {
  const steps = [{ label: 'in', provenance: 'RECORDED', kind: 'INPUT' }];
  const attested = { source: 'SERVER_ATTESTED_RECORDING', serverValidatedBoundaryIds: ['INPUT_RECEIPT'] };
  const lossy = buildCoverage(view(base({ steps, capture: { complete: true, loss_reasons: ['queue drop'] } })), attested);
  const partial = lossy.boundaries.INPUT_RECEIPT.find(c => c.state === 'PARTIAL');
  assert.ok(partial);
  assert.deepEqual(partial.lossReasons, ['queue drop']);
  assert.equal(lossy.boundaries.INPUT_RECEIPT.some(c => c.state === 'SUPPORTED_RECORDED'), false);

  const incomplete = buildCoverage(view(base({ steps, capture: { complete: false } })), LOCAL);
  assert.deepEqual(states(incomplete, 'INPUT_RECEIPT'), ['PARTIAL', 'UNAVAILABLE']);
});

test('replay steps are REPLAY_ONLY with input origin and never supported', () => {
  const r = buildCoverage(view(base({
    replay_input: 'FINAL_DOCUMENT',
    steps: [{ label: 'replay pipeline', provenance: 'CURRENT_REPLAY', kind: 'PIPELINE', duration_us: 5 }]
  })), { source: 'SERVER_ATTESTED_RECORDING', serverValidatedBoundaryIds: ['INPUT_RECEIPT'] });
  const replay = r.boundaries.PIPELINE_PROCESSING.find(c => c.state === 'REPLAY_ONLY');
  assert.ok(replay);
  assert.equal(replay.provenance, 'CURRENT_REPLAY');
  assert.ok(replay.reason.includes('FINAL_DOCUMENT'));
  assert.equal(r.boundaries.PIPELINE_PROCESSING.some(c => c.state === 'SUPPORTED_RECORDED'), false);
  assert.ok(r.warnings.includes('Replay evidence does not prove original execution.'));
});

test('reconstructed topology is CURRENT_CONFIG_ONLY, not recorded history', () => {
  const r = buildCoverage(view(base({ steps: [{ label: 'stream topology', provenance: 'RECONSTRUCTED', kind: 'STREAM' }] })), API);
  assert.deepEqual(states(r, 'STREAM_ROUTING'), ['CURRENT_CONFIG_ONLY', 'UNAVAILABLE']);
  assert.equal(r.boundaries.STREAM_ROUTING[0].provenance, 'RECONSTRUCTED');
});

test('final stream membership is a stored fact while route history stays unavailable', () => {
  const r = buildCoverage(view(base({ message: { index: 'i', id: 'a', fields: {}, streams: ['s1'] } })), API);
  assert.deepEqual(states(r, 'STREAM_ROUTING'), ['STORED_FACT', 'UNAVAILABLE']);
  assert.ok(r.boundaries.STREAM_ROUTING[1].reason.includes('Route history'));
});

test('redacted boundary shows REDACTED without implying absence', () => {
  const r = buildCoverage(view(base({
    visibility: { boundaries: { PIPELINE_PROCESSING: 'REDACTED_BY_PERMISSION' } },
    steps: [{ label: 'hidden', provenance: 'RECORDED', kind: 'RULE' }]
  })), API);
  assert.deepEqual(states(r, 'PIPELINE_PROCESSING'), ['REDACTED']);
  assert.ok(r.warnings.includes('Some evidence is hidden by permission; absence is not implied.'));
});

test('a declared PIPELINE_ONLY start cannot mark input or codec as recorded', () => {
  const r = buildCoverage(view(base({
    capture: { boundary: 'PIPELINE_ONLY' },
    steps: [{ label: 'in', provenance: 'RECORDED', kind: 'INPUT' }, { label: 'codec', provenance: 'RECORDED', kind: 'CODEC' }]
  })), { source: 'SERVER_ATTESTED_RECORDING', serverValidatedBoundaryIds: BOUNDARIES });
  assert.deepEqual(states(r, 'INPUT_RECEIPT'), ['UNAVAILABLE']);
  assert.deepEqual(states(r, 'CODEC_EXTRACTORS'), ['UNAVAILABLE']);
  assert.equal(r.declaredCaptureBoundary, 'PIPELINE_ONLY');
  assert.ok(r.warnings.includes('Recorded claims that conflict with the declared capture boundary were not used.'));
});

test('no steps yields a warning and only the stored document is known', () => {
  const r = buildCoverage(view(base()), LOCAL);
  assert.deepEqual(states(r, 'INDEX_STORAGE'), ['UNVERIFIED_CLAIM', 'UNAVAILABLE']);
  assert.ok(r.warnings.includes('No steps: only the stored final document is known.'));
});

test('steps are classified by kind, never by label text', () => {
  const r = buildCoverage(view(base({ steps: [{ label: 'Input received by pipeline', provenance: 'OBSERVED' }] })), LOCAL);
  assert.deepEqual(states(r, 'INPUT_RECEIPT'), ['UNAVAILABLE']);
});

test('inferred and unknown-provenance steps are never evidence', () => {
  const r = buildCoverage(view(base({ steps: [{ label: 'guess', provenance: 'INFERRED', kind: 'INPUT' }] })), LOCAL);
  assert.deepEqual(states(r, 'INPUT_RECEIPT'), ['UNAVAILABLE']);
  assert.ok(r.warnings.includes('Inferred or unknown-provenance steps are not treated as evidence.'));
});

test('event relationships are unknown rather than absent', () => {
  const r = buildCoverage(view(base()), API);
  const [claim] = r.boundaries.EVENT_RELATIONSHIP;
  assert.equal(claim.state, 'UNAVAILABLE');
  assert.ok(claim.reason.includes('unknown'));
});

test('every claim has a nonempty reason, provenance and a known state, and avoids overclaiming wording', () => {
  const r = buildCoverage(view(base({
    capture: { complete: false, loss_reasons: ['x'] },
    replay_input: 'FINAL_DOCUMENT',
    message: { index: 'i', id: 'a', fields: {}, streams: ['s'] },
    steps: [
      { label: 'a', provenance: 'RECORDED', kind: 'INPUT' },
      { label: 'b', provenance: 'HISTORICAL_REPLAY', kind: 'STAGE' },
      { label: 'c', provenance: 'RECONSTRUCTED', kind: 'STREAM' }
    ]
  })), { source: 'SERVER_ATTESTED_RECORDING', serverValidatedBoundaryIds: BOUNDARIES });
  for (const c of allClaims(r)) {
    assert.ok(COVERAGE_STATES.includes(c.state));
    assert.ok(c.reason.trim().length > 0);
    assert.ok(typeof c.provenance === 'string' && c.provenance.length > 0);
    assert.doesNotMatch(c.reason, /\bexact\b|%/i);
  }
  for (const w of r.warnings) assert.doesNotMatch(w, /\bexact\b|%/i);
});

test('is deterministic, does not mutate the input, and is frozen', () => {
  const raw = base({ capture: { complete: true }, steps: [{ label: 'in', provenance: 'RECORDED', kind: 'INPUT' }] });
  const snapshot = structuredClone(raw);
  const v = view(raw);
  const a = buildCoverage(v, LOCAL);
  assert.deepEqual(buildCoverage(v, LOCAL), a);
  assert.deepEqual(raw, snapshot);
  assert.throws(() => { 'use strict'; a.warnings.push('x'); });
  assert.equal(Object.isFrozen(a.boundaries.INPUT_RECEIPT), true);
});
