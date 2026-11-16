// MT-005 visual field journey: a pure model of one field's evidenced transitions.
// Reuses fieldHistory/fieldDiff from trace.js; never merges replay with original execution,
// never promotes provenance, and never synthesizes an intermediate step.
import { fieldDiff, fieldHistory } from '../trace.js';
import { BOUNDARIES, captureFacts, normalizeTrust } from './coverage.js';

const REPLAY = new Set(['CURRENT_REPLAY', 'HISTORICAL_REPLAY']);
const NOT_PRESENT = Object.freeze({ present: false });
const snap = (obj, field) => Object.hasOwn(obj, field) ? { [field]: obj[field] } : {};
const typeOf = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
const stateOf = (obj, field) => Object.hasOwn(obj, field)
  ? Object.freeze({ present: true, value: structuredClone(obj[field]), type: typeOf(obj[field]) })
  : NOT_PRESENT;

// view: result of normalizeTraceView(trace). trust: runtime-injected EvidenceTrustContext.
export function buildFieldJourney(view, field, trust) {
  if (typeof field !== 'string') throw new TypeError('Field name must be a string.');
  const trace = view.trace;
  const t = normalizeTrust(trust);
  const facts = captureFacts(trace);
  // Full history requires server-attested evidence for every boundary, with no declared loss.
  const fullRecordedHistoryAttested = t.attested && BOUNDARIES.every(b => t.validated.has(b)) &&
    facts.complete && facts.lossReasons.length === 0 && facts.declared === 'INPUT_TO_INDEX';

  const transitions = fieldHistory(trace, field).map(change => {
    const step = view.steps[change.sequence];
    const rule = step.kind === 'RULE' && typeof step.scope?.rule === 'string' ? step.scope.rule : undefined;
    return Object.freeze({
      stepIndex: change.sequence,
      stepId: step.key,
      kind: change.kind,
      before: change.presentBefore
        ? Object.freeze({ present: true, value: change.before, type: typeOf(change.before) }) : NOT_PRESENT,
      after: change.presentAfter
        ? Object.freeze({ present: true, value: change.after, type: typeOf(change.after) }) : NOT_PRESENT,
      provenance: step.provenance,
      ...(Number.isFinite(step.duration_us) ? { durationUs: step.duration_us } : {}),
      ...(rule !== undefined ? { associatedRuleId: rule } : {})
    });
  });

  const gaps = [];
  const paired = trace.steps.map((step, index) => ({ step, index })).filter(({ step }) => step.before !== undefined);
  if (!fullRecordedHistoryAttested) {
    gaps.push(Object.freeze({
      reason: 'Original input and intermediate actions: UNKNOWN. Listed transitions are only the snapshot changes available in this trace.'
    }));
  }
  if (paired.length === 0) {
    gaps.push(Object.freeze({ reason: 'No before/after snapshots in this trace; field history is unknown.' }));
  }

  // Continuity: a comparable before snapshot that disagrees with the previous known state is an unobserved change.
  let known = null;
  for (const { step, index } of paired) {
    const beforeSnap = snap(step.before, field);
    if (known && fieldDiff(known.snap, beforeSnap).length > 0) {
      gaps.push(Object.freeze({ reason: 'Unobserved intermediate change', beforeStep: known.index, afterStep: index }));
    }
    known = { snap: snap(step.after, field), index };
  }

  // Replay timelines are never merged with the stored final value; a mismatch is reported as-is.
  let lastReplay = null;
  for (const { step, index } of paired) {
    if (REPLAY.has(step.provenance)) lastReplay = { snap: snap(step.after, field), index };
  }
  if (lastReplay && fieldDiff(lastReplay.snap, snap(trace.message.fields, field)).length > 0) {
    gaps.push(Object.freeze({
      reason: 'Replay/final discrepancy: the last replay state differs from the stored final value; timelines are not merged.',
      beforeStep: lastReplay.index
    }));
  }

  const redacted = trace.visibility?.boundaries;
  if (redacted && typeof redacted === 'object' &&
      BOUNDARIES.some(b => redacted[b] === 'REDACTED_BY_PERMISSION')) {
    gaps.push(Object.freeze({
      reason: 'Some evidence is hidden by permission; absence of transitions for this field is not implied.'
    }));
  }

  return Object.freeze({
    field,
    finalState: stateOf(trace.message.fields, field),
    transitions: Object.freeze(transitions),
    gaps: Object.freeze(gaps),
    fullRecordedHistoryAttested
  });
}
