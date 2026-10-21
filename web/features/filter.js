// MT-002 pure processing-flow filters over a normalized trace view (normalize.js).
// Pure: no DOM, no network, never mutates the view or the imported trace.
// Matching uses typed metadata only. Absent kind/outcome are never parsed from labels.
import { KINDS, OUTCOMES } from './normalize.js';
import { PROVENANCE } from '../trace.js';

const RULE_KINDS = Object.freeze(['RULE', 'PIPELINE', 'STAGE']);
const FILTER_FLAGS = Object.freeze(['changedOnly', 'includeUnknownKind']);

export const FLOW_PRESETS = Object.freeze([
  'All steps', 'Changed fields', 'Known failures', 'Stream routing',
  'Rules and pipelines', 'Unknown / incomplete', 'Replay only'
]);

// Initial state: no restriction (null sets), unknown-kind steps allowed, no duration threshold.
export function defaultFlowFilter() {
  return {
    kinds: null,
    outcomes: null,
    provenance: null,
    changedOnly: false,
    includeUnknownKind: true,
    minDurationUs: null,
    unknownSignalsOr: false
  };
}

// Documented preset predicates. 'Unknown / incomplete' sets unknownSignalsOr so that the
// provenance and outcome groups combine as OR (explicit outcome UNKNOWN only; absent outcome
// does not count). Kind presets disable unknown-kind steps so they assert only typed kinds.
const PRESET_BUILDERS = Object.freeze({
  'All steps': () => defaultFlowFilter(),
  'Changed fields': () => ({ ...defaultFlowFilter(), changedOnly: true }),
  'Known failures': () => ({ ...defaultFlowFilter(), outcomes: new Set(['FAILED']) }),
  'Stream routing': () => ({ ...defaultFlowFilter(), kinds: new Set(['STREAM']), includeUnknownKind: false }),
  'Rules and pipelines': () => ({ ...defaultFlowFilter(), kinds: new Set(RULE_KINDS), includeUnknownKind: false }),
  'Unknown / incomplete': () => ({
    ...defaultFlowFilter(),
    provenance: new Set(['UNKNOWN']),
    outcomes: new Set(['UNKNOWN']),
    unknownSignalsOr: true
  }),
  'Replay only': () => ({ ...defaultFlowFilter(), provenance: new Set(['CURRENT_REPLAY', 'HISTORICAL_REPLAY']) })
});

export function applyPreset(preset) {
  if (typeof preset !== 'string' || !Object.hasOwn(PRESET_BUILDERS, preset)) {
    throw new RangeError(`Unknown flow preset: ${String(preset)}`);
  }
  return PRESET_BUILDERS[preset]();
}

const isFiniteNonNegative = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;

function checkSet(value, allowed, name, errors) {
  if (value === null) return;
  if (!(value instanceof Set)) { errors.push(`${name} must be null or a Set.`); return; }
  if (value.size === 0) { errors.push(`${name} must select at least one value; use null for all.`); return; }
  for (const item of value) {
    if (!allowed.includes(item)) errors.push(`${name} contains unknown value ${String(item)}.`);
  }
}

// Returns { valid, errors }. An empty Set is rejected because it would hide every step.
export function validateFlowFilter(filter) {
  const errors = [];
  if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) {
    return { valid: false, errors: Object.freeze(['Filter must be an object.']) };
  }
  checkSet(filter.kinds, KINDS, 'kinds', errors);
  checkSet(filter.outcomes, OUTCOMES, 'outcomes', errors);
  checkSet(filter.provenance, PROVENANCE, 'provenance', errors);
  for (const flag of FILTER_FLAGS) {
    if (typeof filter[flag] !== 'boolean') errors.push(`${flag} must be a boolean.`);
  }
  if (filter.unknownSignalsOr !== undefined && typeof filter.unknownSignalsOr !== 'boolean') {
    errors.push('unknownSignalsOr must be a boolean when present.');
  }
  const min = filter.minDurationUs;
  if (min !== null && !isFiniteNonNegative(min)) {
    errors.push('minDurationUs must be null or a finite nonnegative number.');
  }
  return { valid: errors.length === 0, errors: Object.freeze(errors) };
}

function matchesKind(step, filter) {
  if (filter.kinds === null) return true;
  if (filter.kinds.has(step.kind)) return true;
  // Absent or unrecognized kind: allowed only by the distinct unknown-kind control.
  return filter.includeUnknownKind && !KINDS.includes(step.step.kind);
}

function matches(step, filter) {
  if (filter.unknownSignalsOr) {
    // OR across active groups; a null group is inactive. Outcome must be explicit.
    if (filter.provenance !== null || filter.outcomes !== null) {
      const byProvenance = filter.provenance !== null && filter.provenance.has(step.provenance);
      const byOutcome = filter.outcomes !== null && step.outcome !== undefined && filter.outcomes.has(step.outcome);
      if (!byProvenance && !byOutcome) return false;
    }
  } else {
    if (filter.provenance !== null && !filter.provenance.has(step.provenance)) return false;
    // Absent typed outcome is UNKNOWN for ordinary outcome matching.
    if (filter.outcomes !== null && !filter.outcomes.has(step.outcome ?? 'UNKNOWN')) return false;
  }
  if (!matchesKind(step, filter)) return false;
  if (filter.changedOnly && !step.hasChange) return false;
  if (filter.minDurationUs !== null && !(isFiniteNonNegative(step.duration_us) && step.duration_us >= filter.minDurationUs)) {
    return false;
  }
  return true;
}

// Trace-wide metadata gaps that explain an empty or partial result, in fixed order.
function missingMetadata(view, filter) {
  let kind = false, outcome = false, duration = false, snapshots = false;
  for (const step of view.steps) {
    if (!KINDS.includes(step.step.kind)) kind = true;
    if (step.outcome === undefined) outcome = true;
    if (filter.minDurationUs !== null && !isFiniteNonNegative(step.duration_us)) duration = true;
    if (filter.changedOnly && (step.step.before === undefined || step.step.after === undefined)) snapshots = true;
  }
  const missing = [];
  if (kind) missing.push('kind');
  if (outcome) missing.push('outcome');
  if (duration) missing.push('duration_us');
  if (snapshots) missing.push('snapshots');
  return Object.freeze(missing);
}

// indices are original trace step positions in source order; they are never renumbered.
export function filterFlow(view, filter) {
  if (view === null || typeof view !== 'object' || !Array.isArray(view.steps)) {
    throw new TypeError('filterFlow requires a normalized trace view.');
  }
  const check = validateFlowFilter(filter);
  if (!check.valid) throw new RangeError(`Invalid flow filter: ${check.errors.join(' ')}`);
  const indices = [];
  for (const step of view.steps) {
    if (matches(step, filter)) indices.push(step.position);
  }
  return Object.freeze({
    indices: Object.freeze(indices),
    total: view.steps.length,
    shown: indices.length,
    missingMetadata: missingMetadata(view, filter)
  });
}
