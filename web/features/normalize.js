// MT-000 shared view model: one immutable, typed pass over a validated trace.
// Never modifies the trace and never guesses missing outcome/kind evidence.
export const KINDS = Object.freeze(['INPUT', 'CODEC', 'EXTRACTOR', 'PROCESSOR', 'PIPELINE', 'STAGE', 'RULE', 'STREAM', 'INDEX', 'EVENT', 'DIAGNOSTIC', 'OTHER']);
export const OUTCOMES = Object.freeze(['EXECUTED', 'MATCHED', 'NOT_MATCHED', 'SKIPPED', 'FAILED', 'DROPPED', 'UNKNOWN']);
import { fieldDiff } from '../trace.js';
const cache = new WeakMap();

export function normalizeTraceView(trace) {
  if (cache.has(trace)) return cache.get(trace);
  const fieldNames = new Set(Object.keys(trace.message.fields));
  const steps = trace.steps.map((step, position) => {
    const paired = step.before !== undefined && step.after !== undefined;
    const diffs = paired ? fieldDiff(step.before, step.after) : [];
    const changedFields = diffs.map(d => d.field); // real value changes only
    const hasChange = changedFields.length > 0;
    for (const name of paired ? [...Object.keys(step.before), ...Object.keys(step.after)] : []) fieldNames.add(name);
    const scope = step.scope && typeof step.scope === 'object' && !Array.isArray(step.scope)
      ? Object.freeze({ ...step.scope }) : undefined;
    return Object.freeze({
      position,
      key: typeof step.id === 'string' && step.id ? step.id : `#${position}`,
      label: step.label,
      provenance: step.provenance,
      kind: KINDS.includes(step.kind) ? step.kind : 'OTHER',
      outcome: OUTCOMES.includes(step.outcome) ? step.outcome : undefined,
      sequence: Number.isInteger(step.sequence) && step.sequence >= 0 ? step.sequence : undefined,
      duration_us: step.duration_us,
      scope, hasChange, changedFields,
      step
    });
  });
  const view = Object.freeze({ trace, steps: Object.freeze(steps), fieldNames: Object.freeze([...fieldNames].sort()) });
  cache.set(trace, view);
  return view;
}
