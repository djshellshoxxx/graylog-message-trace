import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTrace } from '../../web/trace.js';
import { normalizeTraceView } from '../../web/features/normalize.js';
import { filterFlow, defaultFlowFilter, applyPreset } from '../../web/features/filter.js';
import {
  searchTrace, intersectFlowHits, buildSearchIndex, validateSearchQuery, SEARCH_LIMITS
} from '../../web/features/search.js';

const RAW = {
  schema_version: 1,
  message: {
    index: 'network_42', id: 'msg-1', fields: {
      src_ip: '10.0.0.1',
      'a.b': 'dotted',
      'a.*b': 'regex-looking',
      nested: { deep: { leaf: 'NeedleX' } },
      html: '<img src=x onerror=alert(1)>',
      name: 'Ålice',
      emoji: '😀 smile',
      n: 42,
      flag: true,
      nothing: null,
      gl2_processing_error: 'boom'
    }
  },
  steps: [
    { id: 'r1', label: 'Rule: normalize src_ip', provenance: 'RECORDED', kind: 'RULE', outcome: 'EXECUTED', scope: { pipeline: 'pl-7', rule: 'r-3' }, before: { src_ip: '10.0.0.1' }, after: { src_ip: '10.0.0.9' } },
    { label: 'Stream route', provenance: 'RECORDED', kind: 'STREAM', outcome: 'MATCHED', before: {}, after: {} },
    { label: 'Replay step', provenance: 'CURRENT_REPLAY', kind: 'PIPELINE', before: { note: 'Ünïcode café' }, after: { note: 'Ünïcode café', extra: 'needle' }, duration_us: 5 }
  ]
};

const viewOf = raw => normalizeTraceView(validateTrace(raw));
const VIEW = viewOf(RAW);
const search = (text, scope = 'ALL', view = VIEW) => searchTrace(view, { text, scope });
const summary = result => result.hits.map(h => [h.target, h.stepIndex ?? h.fieldName ?? h.diagnosticIndex, h.matchedProperty]);

test('literal field-name search reports step snapshot keys before final fields', () => {
  const result = search('src_ip');
  assert.deepEqual(summary(result), [
    ['STEP', 0, 'label'],
    ['STEP', 0, 'before.src_ip'],
    ['STEP', 0, 'after.src_ip'],
    ['FIELD', 'src_ip', 'src_ip']
  ]);
  assert.equal(result.total, 4);
  assert.equal(result.truncated, false);
  assert.equal(result.indexTruncated, false);
  assert.deepEqual([...result.hits[0].range], [16, 22]);
});

test('search is case-insensitive and reports nested leaf paths', () => {
  const result = search('NEEDLEX');
  assert.equal(result.total, 1);
  assert.equal(result.hits[0].fieldName, 'nested');
  assert.equal(result.hits[0].matchedProperty, 'nested.deep.leaf');
  assert.deepEqual([...result.hits[0].range], [0, 7]);
});

test('regex metacharacters are literal', () => {
  assert.deepEqual(summary(search('.*')), [['FIELD', 'a.*b', 'a.*b']]);
  assert.deepEqual(summary(search('a.b')), [['FIELD', 'a.b', 'a.b']]);
  assert.deepEqual(summary(search('a.*')), [['FIELD', 'a.*b', 'a.*b']]);
  assert.equal(search('.+').total, 0);
  assert.equal(search('[a-z]+').total, 0);
  assert.equal(search('(').total, 1); // literal parenthesis in the HTML fixture
});

test('composed and decomposed Unicode match the same text, with lowercase folding', () => {
  assert.equal(search('ålice').total, 1);
  assert.equal(search('Ålice').total, 1);
  assert.equal(search('ÅLICE').total, 1);
  assert.deepEqual(summary(search('ünïcode')), [['STEP', 2, 'before.note'], ['STEP', 2, 'after.note']]);
});

test('surrogate pairs match as whole characters and lone surrogates are rejected', () => {
  const result = search('😀');
  assert.equal(result.total, 1);
  assert.deepEqual([...result.hits[0].range], [0, 2]);
  assert.throws(() => search('\ud83d'), RangeError);
  assert.equal(validateSearchQuery({ text: '\ud800', scope: 'ALL' }).valid, false);
});

test('unpaired surrogates in imported data are indexed as replacement characters', () => {
  const view = viewOf({ schema_version: 1, message: { index: 'i', id: 'x', fields: { bad: 'ab\ud800cd' } }, steps: [] });
  assert.equal(search('ab', 'ALL', view).total, 1);
  assert.equal(search('�', 'ALL', view).total, 1);
});

test('hostile HTML is only text and never becomes markup', () => {
  const result = search('<img');
  assert.deepEqual(summary(result), [['FIELD', 'html', 'html']]);
  assert.equal(result.hits[0].range[0], 0);
});

test('null, boolean and number scalars are searchable as text', () => {
  assert.deepEqual(summary(search('null')), [['FIELD', 'nothing', 'nothing']]);
  assert.deepEqual(summary(search('true')), [['FIELD', 'flag', 'flag']]);
  assert.deepEqual(summary(search('42')), [['FIELD', 'n', 'n']]);
});

test('empty and whitespace-only queries return no hits', () => {
  for (const text of ['', '   ', '\t\n']) {
    const result = search(text);
    assert.deepEqual([...result.hits], []);
    assert.equal(result.total, 0);
    assert.equal(result.truncated, false);
  }
});

test('query length counts code points after trimming, with inline validation', () => {
  assert.equal(validateSearchQuery({ text: `  ${'a'.repeat(256)}  `, scope: 'ALL' }).valid, true);
  assert.equal(validateSearchQuery({ text: 'a'.repeat(257), scope: 'ALL' }).valid, false);
  assert.equal(validateSearchQuery({ text: '😀'.repeat(256), scope: 'ALL' }).valid, true);
  assert.equal(validateSearchQuery({ text: '😀'.repeat(257), scope: 'ALL' }).valid, false);
  assert.throws(() => search('a'.repeat(257)), RangeError);
  assert.throws(() => searchTrace(VIEW, { text: 'a', scope: 'EVERYTHING' }), RangeError);
});

test('scopes restrict targets independently', () => {
  assert.deepEqual(summary(search('src_ip', 'FIELDS')), [['FIELD', 'src_ip', 'src_ip']]);
  assert.equal(search('src_ip', 'FLOW').total, 3);
  assert.equal(search('src_ip', 'DIAGNOSTICS').total, 0);
});

test('diagnostics are searched from the deterministic diagnostics module', () => {
  const result = search('processing error', 'DIAGNOSTICS');
  assert.equal(result.total, 1);
  assert.equal(result.hits[0].target, 'DIAGNOSTIC');
  assert.equal(result.hits[0].diagnosticIndex, 2);
});

test('hits are capped at 500 with exact total and truncation flag', () => {
  const raw = {
    schema_version: 1,
    message: { index: 'i', id: 'x', fields: {} },
    steps: Array.from({ length: 600 }, (_, i) => ({ label: `needle ${i}`, provenance: 'OBSERVED' }))
  };
  const result = search('needle', 'ALL', viewOf(raw));
  assert.equal(result.hits.length, SEARCH_LIMITS.maxHits);
  assert.equal(result.total, 600);
  assert.equal(result.truncated, true);
  assert.equal(result.hits[0].stepIndex, 0);
  assert.equal(result.hits[499].stepIndex, 499);
});

test('index budget flags are reported so not-found is not treated as absence', () => {
  const long = viewOf({ schema_version: 1, message: { index: 'i', id: 'x', fields: { long: `${'x'.repeat(5000)}needle` } }, steps: [] });
  const result = search('needle', 'ALL', long);
  assert.equal(result.total, 0);
  assert.equal(result.indexTruncated, true);
  assert.equal(search('x', 'ALL', long).indexTruncated, true);
});

test('nesting beyond the limit is skipped and flagged', () => {
  const nest = (levels) => {
    let value = { leaf: 'needle' };
    for (let i = 0; i < levels; i += 1) value = { c: value };
    return value;
  };
  const shallow = viewOf({ schema_version: 1, message: { index: 'i', id: 'x', fields: { deep: nest(3) } }, steps: [] });
  assert.equal(search('needle', 'ALL', shallow).total, 1);
  assert.equal(search('needle', 'ALL', shallow).indexTruncated, false);
  const deep = viewOf({ schema_version: 1, message: { index: 'i', id: 'x', fields: { deep: nest(20) } }, steps: [] });
  const result = search('needle', 'ALL', deep);
  assert.equal(result.total, 0);
  assert.equal(result.indexTruncated, true);
});

test('total text budget stops indexing and flags truncation', () => {
  const fields = {};
  for (let i = 0; i < 3000; i += 1) fields[`f${i}`] = 'y'.repeat(4000);
  fields.zz_last = 'needle';
  const view = viewOf({ schema_version: 1, message: { index: 'i', id: 'x', fields }, steps: [] });
  const result = search('needle', 'ALL', view);
  assert.equal(result.total, 0);
  assert.equal(result.indexTruncated, true);
  assert.ok(buildSearchIndex(view).units <= SEARCH_LIMITS.maxIndexUnits);
});

test('result order is step order, then sorted field names, then diagnostics', () => {
  const raw = {
    schema_version: 1,
    message: { index: 'i', id: 'x', fields: { zeta: 'k', alpha: 'k' } },
    steps: [{ label: 'k one', provenance: 'RECORDED', kind: 'RULE' }]
  };
  const result = search('k', 'ALL', viewOf(raw));
  // Steps first, then fields by sorted name (alpha before zeta, although zeta was inserted first),
  // then diagnostics ("unknown" in the recording-partial diagnostic contains k).
  assert.deepEqual(result.hits.map(h => h.target), ['STEP', 'FIELD', 'FIELD', 'DIAGNOSTIC']);
  assert.deepEqual(result.hits.slice(1, 3).map(h => h.fieldName), ['alpha', 'zeta']);
  assert.equal(result.hits[0].matchedProperty, 'label');
  assert.equal(result.hits[3].diagnosticIndex, 0);
});

test('searching never mutates the trace or the view', () => {
  const snapshot = structuredClone(RAW);
  search('src_ip');
  search('needle');
  assert.deepEqual(RAW, snapshot);
});

test('flow intersection keeps only visible STEP hits and composes with filters', () => {
  const changed = filterFlow(VIEW, { ...defaultFlowFilter(), changedOnly: true });
  assert.deepEqual([...changed.indices], [0, 2]);
  const hits = search('src_ip').hits;
  assert.equal(intersectFlowHits(hits, changed.indices).length, 3);
  assert.deepEqual([...intersectFlowHits(hits, [1])], []);

  const streams = filterFlow(VIEW, applyPreset('Stream routing'));
  assert.deepEqual([...intersectFlowHits(search('needle').hits, streams.indices)], []);
  const pipelines = filterFlow(VIEW, { ...defaultFlowFilter(), kinds: new Set(['PIPELINE']), includeUnknownKind: false });
  const composed = intersectFlowHits(search('needle').hits, pipelines.indices);
  assert.equal(composed.length, 1);
  assert.equal(composed[0].stepIndex, 2);
});

// Deterministic 10,000-step fixture; oracle counts are computed by formula.
function bigView() {
  const steps = [];
  for (let i = 0; i < 10000; i += 1) {
    steps.push({
      label: `step ${i} ${i % 3 === 0 ? 'rule' : 'codec'}`,
      provenance: 'RECORDED',
      ...(i % 3 === 0 ? { kind: 'RULE' } : { kind: 'CODEC' }),
      scope: { pipeline: `pl-${i % 10}` },
      before: { src_ip: `10.0.${i % 256}.1` },
      after: { src_ip: `10.0.${i % 256}.2` }
    });
  }
  return normalizeTraceView(validateTrace({ schema_version: 1, message: { index: 'big', id: 'big-1', fields: {} }, steps }));
}

test('10,000-step stress: index once, exact totals, bounded time per query', () => {
  const view = bigView();
  let started = performance.now();
  buildSearchIndex(view);
  const buildMs = performance.now() - started;
  assert.ok(buildMs < 3000, `index build took ${buildMs.toFixed(1)} ms`);
  assert.equal(buildSearchIndex(view), buildSearchIndex(view));

  started = performance.now();
  const rule = searchTrace(view, { text: 'rule', scope: 'ALL' });
  const ruleMs = performance.now() - started;
  assert.equal(rule.total, 2 * 3334); // label and kind on every i % 3 === 0 step
  assert.equal(rule.hits.length, 500);
  assert.equal(rule.truncated, true);
  assert.ok(ruleMs < 200, `search took ${ruleMs.toFixed(1)} ms`);

  started = performance.now();
  const subnet = searchTrace(view, { text: '10.0.7.', scope: 'FLOW' });
  const subnetMs = performance.now() - started;
  assert.equal(subnet.total, 80); // 40 steps with i % 256 === 7, before and after
  assert.ok(subnetMs < 200, `search took ${subnetMs.toFixed(1)} ms`);
});
