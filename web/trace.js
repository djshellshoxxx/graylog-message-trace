export const PROVENANCE = Object.freeze(['OBSERVED', 'RECORDED', 'HISTORICAL_REPLAY', 'CURRENT_REPLAY', 'RECONSTRUCTED', 'INFERRED', 'UNKNOWN']);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' && x.trim().length > 0;

// Traversal is iterative so even deliberately deep inputs fail with a useful
// validation error rather than a stack overflow in structuredClone or fieldDiff.
function checkEvidenceLimits(root) {
  const active = new WeakSet();
  const pending = [{ value: root, depth: 0, exit: false }];
  let visited = 0;
  while (pending.length) {
    const entry = pending.pop();
    const value = entry.value;
    if (entry.exit) { active.delete(value); continue; }
    if (++visited > 250000) throw new Error('Trace data exceeds node limit.');
    if (value === null || typeof value !== 'object') {
      if (!['string', 'number', 'boolean'].includes(typeof value) ||
          (typeof value === 'number' && !Number.isFinite(value)))
        throw new Error('Trace data contains a non-JSON value.');
      continue;
    }
    if (entry.depth > 64) throw new Error('Trace data exceeds nesting limit.');
    if (active.has(value)) throw new Error('Trace data contains cyclic references.');
    active.add(value);
    pending.push({ value, exit: true });
    for (const child of Object.values(value))
      pending.push({ value: child, depth: entry.depth + 1, exit: false });
  }
}

// Validate imported evidence; a local import cannot authenticate its origin.
export function validateTrace(value) {
  if (!object(value) || value.schema_version !== 1) throw new Error('Expected trace schema_version 1.');
  if (!object(value.message) || !text(value.message.id) || !text(value.message.index)) throw new Error('Message index and ID are required.');
  if (!object(value.message.fields)) throw new Error('Message fields must be an object.');
  if (!Array.isArray(value.steps) || value.steps.length > 10000) throw new Error('Expected at most 10,000 trace steps.');
  for (const step of value.steps) {
    if (!object(step) || !text(step.label) || !PROVENANCE.includes(step.provenance)) throw new Error('Each step needs a label and valid provenance.');
    if (step.duration_us !== undefined && (!Number.isFinite(step.duration_us) || step.duration_us < 0)) throw new Error('Duration must be a nonnegative finite number.');
    if (step.before !== undefined && !object(step.before)) throw new Error('Before fields must be an object.');
    if (step.after !== undefined && !object(step.after)) throw new Error('After fields must be an object.');
    if ((step.before === undefined) !== (step.after === undefined)) throw new Error('Field changes require both before and after snapshots.');
  }
  checkEvidenceLimits(value);
  return structuredClone(value);
}

function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
}

export function fieldDiff(before, after) {
  if (!object(before) || !object(after)) throw new Error('Field snapshots must be objects.');
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(field => {
    const presentBefore = Object.hasOwn(before, field), presentAfter = Object.hasOwn(after, field);
    if (presentBefore && presentAfter && equal(before[field], after[field])) return [];
    return [{ field, kind: !presentBefore ? 'CREATED' : !presentAfter ? 'REMOVED' : 'MODIFIED',
      presentBefore, presentAfter, before: structuredClone(before[field]), after: structuredClone(after[field]) }];
  });
}

export function fieldHistory(trace, field) {
  // Compute only the requested field: a trace can contain thousands of unrelated
  // fields, and re-diffing all of them for each selection is unnecessarily costly.
  return trace.steps.flatMap((step, sequence) => {
    if (step.before === undefined) return [];
    const before = Object.hasOwn(step.before, field) ? { [field]: step.before[field] } : {};
    const after = Object.hasOwn(step.after, field) ? { [field]: step.after[field] } : {};
    return fieldDiff(before, after)
      .map(change => ({ ...change, sequence, label: step.label, provenance: step.provenance }));
  });
}

export function traceSummary(trace) {
  const statuses = new Set(trace.steps.map(s => s.provenance));
  const replay = statuses.has('CURRENT_REPLAY') || statuses.has('HISTORICAL_REPLAY');
  // Completeness must come from the collector; never infer it from the presence of a recorded step.
  if (trace.capture?.complete === true && statuses.has('RECORDED') &&
      [...statuses].every(s => s === 'RECORDED' || s === 'OBSERVED')) return 'Recorded evidence (completeness claimed by imported file)';
  if (replay) return 'Replay evidence; original execution is not proven';
  if (statuses.has('RECORDED')) return 'Partial recorded evidence';
  return 'Stored facts and reconstruction; original execution is unknown';
}

export function diagnostics(trace) {
  const result = [];
  if (trace.steps.some(s => /REPLAY$/.test(s.provenance))) result.push('Replay timings and field changes describe the replay only.');
  if (trace.replay_input === 'FINAL_DOCUMENT') result.push('Replay starts from the final indexed document; original fields and stream state may be unavailable.');
  if (trace.capture?.complete !== true && trace.steps.some(s => s.provenance === 'RECORDED')) result.push('Recording is partial or its completeness is unknown.');
  if (Object.hasOwn(trace.message.fields, 'gl2_processing_error')) result.push('The indexed message contains a processing error.');
  return result;
}
