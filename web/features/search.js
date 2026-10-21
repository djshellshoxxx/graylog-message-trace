// MT-003 pure single-trace search over a normalized trace view (normalize.js).
// Pure: no DOM, no network, no regular expressions. Never mutates its inputs.
// Matching is literal and case-insensitive: both sides are NFC-normalized and then
// lowercased per code point, keeping UTF-16 length so hit offsets refer to the NFC
// display text of the matched segment. Hits are deterministic: STEP hits in step order,
// then FIELD hits in sorted field-name order, then DIAGNOSTIC hits in source order.
import { KINDS, OUTCOMES } from './normalize.js';
import { diagnostics } from '../trace.js';

export const SEARCH_SCOPES = Object.freeze(['ALL', 'FLOW', 'FIELDS', 'DIAGNOSTICS']);
export const SEARCH_LIMITS = Object.freeze({
  maxQueryCodePoints: 256,
  maxHits: 500,
  maxLeafUnits: 4096,
  maxIndexUnits: 8 * 1024 * 1024, // UTF-16 code units of indexed display text per trace
  maxNesting: 16
});

const SCOPE_TARGET = Object.freeze({ FLOW: 'STEP', FIELDS: 'FIELD', DIAGNOSTICS: 'DIAGNOSTIC' });
const ASCII_ONLY = /^[\x00-\x7f]*$/;
const indexCache = new WeakMap();

// Lowercases each code point but keeps any mapping that changes UTF-16 length unchanged,
// so folded offsets equal display offsets.
function foldText(text) {
  if (ASCII_ONLY.test(text)) return text.toLowerCase();
  let out = '';
  for (const ch of text) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

function scalarText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  return undefined; // containers are handled by indexValue
}

function addText(state, ctx, property, value) {
  if (value.length === 0) return;
  let text = value.normalize('NFC').toWellFormed();
  if (text.length > SEARCH_LIMITS.maxLeafUnits) {
    text = text.slice(0, SEARCH_LIMITS.maxLeafUnits).toWellFormed();
    state.indexTruncated = true;
  }
  const room = SEARCH_LIMITS.maxIndexUnits - state.used;
  if (room <= 0) { state.indexTruncated = true; return; }
  if (text.length > room) { text = text.slice(0, room).toWellFormed(); state.indexTruncated = true; }
  if (text.length === 0) return;
  state.used += text.length;
  state.segments.push(Object.freeze({ ...ctx, matchedProperty: property, text, folded: foldText(text) }));
}

// Shallow-first (breadth-first) traversal. Indexes object key names and scalar values
// under dotted paths. Containers beyond maxNesting are skipped and flagged as truncated.
function indexValue(state, ctx, root, rootPath) {
  const queue = [{ value: root, path: rootPath, depth: 0 }];
  for (let head = 0; head < queue.length; head += 1) {
    const { value, path, depth } = queue[head];
    if (value === null || typeof value !== 'object') {
      const text = scalarText(value);
      if (text !== undefined) addText(state, ctx, path, text);
      continue;
    }
    const isArray = Array.isArray(value);
    const keys = isArray ? value.map((_, i) => String(i)) : Object.keys(value);
    if (keys.length === 0) continue;
    if (depth >= SEARCH_LIMITS.maxNesting) { state.indexTruncated = true; continue; }
    for (const key of keys) {
      const childPath = `${path}.${key}`;
      if (!isArray) addText(state, ctx, childPath, key);
      queue.push({ value: value[key], path: childPath, depth: depth + 1 });
    }
  }
}

// Built once per normalized view (cached by identity). Callers never need to rebuild per keystroke.
export function buildSearchIndex(view) {
  if (indexCache.has(view)) return indexCache.get(view);
  const state = { used: 0, indexTruncated: false, segments: [] };
  for (const step of view.steps) {
    const raw = step.step;
    const ctx = { target: 'STEP', stepIndex: step.position };
    addText(state, ctx, 'label', raw.label);
    if (KINDS.includes(raw.kind)) addText(state, ctx, 'kind', raw.kind);
    if (OUTCOMES.includes(raw.outcome)) addText(state, ctx, 'outcome', raw.outcome);
    addText(state, ctx, 'provenance', raw.provenance);
    if (step.scope) {
      for (const key of Object.keys(step.scope)) {
        const text = scalarText(step.scope[key]);
        if (text !== undefined) addText(state, ctx, `scope.${key}`, text);
      }
    }
    if (raw.before !== undefined) indexValue(state, ctx, raw.before, 'before');
    if (raw.after !== undefined) indexValue(state, ctx, raw.after, 'after');
  }
  for (const name of Object.keys(view.trace.message.fields).sort()) {
    const ctx = { target: 'FIELD', fieldName: name };
    addText(state, ctx, name, name);
    indexValue(state, ctx, view.trace.message.fields[name], name);
  }
  diagnostics(view.trace).forEach((text, diagnosticIndex) => {
    addText(state, { target: 'DIAGNOSTIC', diagnosticIndex }, 'text', text);
  });
  const index = Object.freeze({
    segments: Object.freeze(state.segments),
    indexTruncated: state.indexTruncated,
    units: state.used
  });
  indexCache.set(view, index);
  return index;
}

// Returns { valid, errors, text, folded }. Whitespace is trimmed; empty text is valid and means no search.
export function validateSearchQuery(query) {
  const errors = [];
  if (query === null || typeof query !== 'object') {
    errors.push('Query must be an object.');
  } else {
    if (typeof query.text !== 'string') errors.push('Search text must be a string.');
    if (!SEARCH_SCOPES.includes(query.scope)) errors.push(`Scope must be one of ${SEARCH_SCOPES.join(', ')}.`);
  }
  if (errors.length > 0) return Object.freeze({ valid: false, errors: Object.freeze(errors), text: '', folded: '' });
  const trimmed = query.text.trim();
  if (!trimmed.isWellFormed()) errors.push('Search text contains an unpaired surrogate.');
  if ([...trimmed].length > SEARCH_LIMITS.maxQueryCodePoints) {
    errors.push(`Search text may contain at most ${SEARCH_LIMITS.maxQueryCodePoints} characters.`);
  }
  if (errors.length > 0) return Object.freeze({ valid: false, errors: Object.freeze(errors), text: '', folded: '' });
  const text = trimmed.normalize('NFC');
  return Object.freeze({ valid: true, errors: Object.freeze([]), text, folded: foldText(text) });
}

function makeHit(seg, start, end) {
  return Object.freeze({
    target: seg.target,
    ...(seg.stepIndex !== undefined ? { stepIndex: seg.stepIndex } : {}),
    ...(seg.fieldName !== undefined ? { fieldName: seg.fieldName } : {}),
    ...(seg.diagnosticIndex !== undefined ? { diagnosticIndex: seg.diagnosticIndex } : {}),
    matchedProperty: seg.matchedProperty,
    range: Object.freeze([start, end])
  });
}

// total is exact (every occurrence is counted, non-overlapping per segment).
// hits holds at most maxHits navigable matches; truncated is true when total exceeds them.
// indexTruncated is true when any text was cut by a budget, so "no hits" is not proof of absence.
export function searchTrace(view, query) {
  const check = validateSearchQuery(query);
  if (!check.valid) throw new RangeError(`Invalid search: ${check.errors.join(' ')}`);
  const index = buildSearchIndex(view);
  const onlyTarget = query.scope === 'ALL' ? null : SCOPE_TARGET[query.scope];
  const hits = [];
  let total = 0;
  const needle = check.folded;
  if (needle !== '') {
    for (const seg of index.segments) {
      if (onlyTarget !== null && seg.target !== onlyTarget) continue;
      const hay = seg.folded;
      let at = hay.indexOf(needle);
      while (at !== -1) {
        total += 1;
        if (hits.length < SEARCH_LIMITS.maxHits) hits.push(makeHit(seg, at, at + needle.length));
        at = hay.indexOf(needle, at + needle.length);
      }
    }
  }
  return Object.freeze({
    hits: Object.freeze(hits),
    total,
    truncated: total > hits.length,
    indexTruncated: index.indexTruncated
  });
}

// Keeps only STEP hits whose step is in visibleStepIndices (typically filterFlow(...).indices).
// FIELD and DIAGNOSTIC hits are scoped independently and are excluded here by design.
export function intersectFlowHits(hits, visibleStepIndices) {
  const visible = new Set(visibleStepIndices);
  return Object.freeze(hits.filter(hit => hit.target === 'STEP' && visible.has(hit.stepIndex)));
}
