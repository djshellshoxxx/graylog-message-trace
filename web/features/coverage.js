// MT-004 evidence coverage: a pure, conservative projection of already authorized evidence.
// Trust comes only from the trusted runtime context argument, never from imported fields.
// Never converts a claim into a stronger one, never derives percentages or "exact" wording,
// and never reads step labels to infer what a recorder covered.

export const BOUNDARIES = Object.freeze(['INPUT_RECEIPT', 'CODEC_EXTRACTORS', 'MESSAGE_FILTER_CHAIN',
  'PIPELINE_PROCESSING', 'STREAM_ROUTING', 'INDEX_STORAGE', 'EVENT_RELATIONSHIP']);
export const COVERAGE_STATES = Object.freeze(['SUPPORTED_RECORDED', 'STORED_FACT', 'CURRENT_CONFIG_ONLY',
  'REPLAY_ONLY', 'UNVERIFIED_CLAIM', 'UNAVAILABLE', 'PARTIAL', 'REDACTED']);
export const TRUST_SOURCES = Object.freeze(['LOCAL_FILE', 'DEMO', 'GRAYLOG_AUTHORIZED_API', 'SERVER_ATTESTED_RECORDING']);
export const CAPTURE_BOUNDARIES = Object.freeze(['INPUT_TO_INDEX', 'PIPELINE_ONLY', 'PROCESSOR_ONLY', 'STORED_ONLY', 'UNKNOWN']);

// Only the normalized step kinds that name a boundary; INPUT/OTHER/DIAGNOSTIC map nowhere.
const KIND_BOUNDARY = Object.freeze({
  INPUT: 'INPUT_RECEIPT', CODEC: 'CODEC_EXTRACTORS', EXTRACTOR: 'CODEC_EXTRACTORS',
  PROCESSOR: 'MESSAGE_FILTER_CHAIN', PIPELINE: 'PIPELINE_PROCESSING', STAGE: 'PIPELINE_PROCESSING',
  RULE: 'PIPELINE_PROCESSING', STREAM: 'STREAM_ROUTING', INDEX: 'INDEX_STORAGE', EVENT: 'EVENT_RELATIONSHIP'
});

// Boundaries a declared capture start cannot mark as recorded.
const NOT_COVERED = Object.freeze({
  PIPELINE_ONLY: Object.freeze(['INPUT_RECEIPT', 'CODEC_EXTRACTORS']),
  PROCESSOR_ONLY: Object.freeze(BOUNDARIES.filter(b => b !== 'MESSAGE_FILTER_CHAIN')),
  STORED_ONLY: Object.freeze(BOUNDARIES.filter(b => b !== 'INDEX_STORAGE'))
});

const REPLAY = new Set(['CURRENT_REPLAY', 'HISTORICAL_REPLAY']);
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);

// Trust is injected by the trusted entry point. Unknown or missing sources fall back to the least trusted one.
export function normalizeTrust(context) {
  const source = TRUST_SOURCES.includes(context?.source) ? context.source : 'LOCAL_FILE';
  const attested = source === 'SERVER_ATTESTED_RECORDING';
  const ids = attested && Array.isArray(context.serverValidatedBoundaryIds) ? context.serverValidatedBoundaryIds : [];
  return Object.freeze({
    source,
    attested,
    authoritative: attested || source === 'GRAYLOG_AUTHORIZED_API',
    validated: new Set(ids.filter(b => BOUNDARIES.includes(b)))
  });
}

// Declared capture facts. These are untrusted imported values and are only used to downgrade claims.
export function captureFacts(trace) {
  const capture = isObject(trace.capture) ? trace.capture : {};
  const declared = CAPTURE_BOUNDARIES.includes(capture.boundary) ? capture.boundary : null;
  const lossReasons = Array.isArray(capture.loss_reasons)
    ? capture.loss_reasons.filter(r => typeof r === 'string' && r.trim().length > 0) : [];
  return Object.freeze({
    declared,
    lossReasons: Object.freeze(lossReasons),
    complete: capture.complete === true,
    partial: lossReasons.length > 0 || capture.complete === false,
    hasSource: isObject(trace.capture) && trace.capture.source !== undefined
  });
}

const DEFAULT_UNAVAILABLE = 'No authenticated original-execution evidence for this boundary in the trace.';
const EVENT_UNAVAILABLE = 'No authenticated event relationship evidence; missing links are unknown, not proof that no event exists.';
const CONFIG_REASON = 'Reconstructed from current or stored topology; it may differ from the configuration used at ingest.';

function replayReason(replayInput) {
  const origin = replayInput ? `input origin ${replayInput}` : 'input origin not declared';
  return `Replay simulation only (${origin}); not original execution.`;
}

// Projects a normalized view and trusted context into per-boundary claims. Pure and deterministic.
export function buildCoverage(view, context) {
  const trust = normalizeTrust(context);
  const trace = view.trace;
  const facts = captureFacts(trace);
  const notCovered = new Set(NOT_COVERED[facts.declared] ?? []);
  const replayInput = typeof trace.replay_input === 'string' && /^[A-Z_]{1,40}$/.test(trace.replay_input)
    ? trace.replay_input : null;
  const groups = new Map();
  const warnings = [];
  let droppedConflicts = false;
  let hasReplay = false;
  let hasInferred = false;
  // A redacted boundary shows only REDACTED: its contents, and even its step-derived claims, are not implied.
  const redacted = isObject(trace.visibility) && isObject(trace.visibility.boundaries) ? trace.visibility.boundaries : {};
  const redactedBoundaries = new Set(BOUNDARIES.filter(b => redacted[b] === 'REDACTED_BY_PERMISSION'));

  const add = ({ boundary, state, provenance, reason, sourceRef, isAttested = false, lossReasons, count = 1, stepBacked = false }) => {
    if (redactedBoundaries.has(boundary) && state !== 'REDACTED') return;
    const key = `${boundary}|${state}|${provenance}`;
    const existing = groups.get(key);
    if (existing) { existing.count += count; return; }
    groups.set(key, { boundary, state, provenance, reason, sourceRef, isAttested, lossReasons, count, stepBacked });
  };

  // Step-derived evidence. OBSERVED steps are covered by the stored message facts below.
  const recorded = new Map(); // boundary -> { count, firstKey }
  for (const s of view.steps) {
    if (REPLAY.has(s.provenance)) hasReplay = true;
    if (s.provenance === 'INFERRED' || s.provenance === 'UNKNOWN') { hasInferred = true; continue; }
    const boundary = KIND_BOUNDARY[s.kind];
    if (!boundary) continue;
    if (s.provenance === 'RECORDED') {
      const r = recorded.get(boundary) ?? { count: 0, firstKey: s.key };
      r.count++;
      recorded.set(boundary, r);
    } else if (REPLAY.has(s.provenance)) {
      add({ boundary, state: 'REPLAY_ONLY', provenance: s.provenance, reason: replayReason(replayInput),
        sourceRef: s.key, stepBacked: true });
    } else if (s.provenance === 'RECONSTRUCTED') {
      add({ boundary, state: 'CURRENT_CONFIG_ONLY', provenance: 'RECONSTRUCTED', reason: CONFIG_REASON,
        sourceRef: s.key, stepBacked: true });
    }
  }

  // Recorded claims. Only server-validated boundaries from an attested context can become SUPPORTED_RECORDED.
  for (const boundary of BOUNDARIES) {
    const r = recorded.get(boundary);
    const validated = trust.attested && trust.validated.has(boundary);
    if (notCovered.has(boundary)) {
      if (r || validated) {
        droppedConflicts = true;
        add({ boundary, state: 'UNAVAILABLE', provenance: 'UNKNOWN',
          reason: `Declared capture boundary ${facts.declared} does not cover this boundary; recorded claims are not used.` });
      }
      continue;
    }
    if (validated) {
      const partial = facts.partial;
      add({ boundary, state: partial ? 'PARTIAL' : 'SUPPORTED_RECORDED', provenance: 'RECORDED',
        reason: partial
          ? 'Server-attested recording reports loss or incomplete capture for this boundary.'
          : 'Server-attested original recording covers this boundary.',
        isAttested: !partial, lossReasons: partial ? [...facts.lossReasons] : undefined,
        count: r?.count ?? 0, stepBacked: r !== undefined, sourceRef: r?.firstKey });
    } else if (r) {
      const partial = facts.partial;
      add({ boundary, state: partial ? 'PARTIAL' : 'UNVERIFIED_CLAIM', provenance: 'RECORDED',
        reason: partial
          ? 'Imported claim reports loss or incomplete capture for this boundary; it is not authenticated.'
          : 'Imported file claims original execution for this boundary; the claim cannot be authenticated.',
        lossReasons: partial ? [...facts.lossReasons] : undefined,
        count: r.count, stepBacked: true, sourceRef: r.firstKey });
    }
  }

  // Stored facts. The final message is the only fact this module can state without step metadata.
  add({ boundary: 'INDEX_STORAGE',
    state: trust.authoritative ? 'STORED_FACT' : 'UNVERIFIED_CLAIM',
    provenance: trust.authoritative ? 'OBSERVED' : 'UNKNOWN',
    reason: trust.authoritative
      ? 'Persisted final document in the index; this is not evidence of pipeline history.'
      : 'Final document from an unauthenticated source; it is not treated as an index fact.' });

  // Final stream membership is a stored fact; route history is never implied by it.
  if (Array.isArray(trace.message.streams) && trace.message.streams.length > 0) {
    add({ boundary: 'STREAM_ROUTING',
      state: trust.authoritative ? 'STORED_FACT' : 'UNVERIFIED_CLAIM',
      provenance: trust.authoritative ? 'OBSERVED' : 'UNKNOWN',
      reason: 'Final stream membership is stored; it does not show which route matched or when.' });
    add({ boundary: 'STREAM_ROUTING', state: 'UNAVAILABLE', provenance: 'UNKNOWN',
      reason: 'Route history is not available.' });
  }

  // Hidden evidence is never treated as absent and never described beyond the generic reason.
  for (const boundary of redactedBoundaries) {
    add({ boundary, state: 'REDACTED', provenance: 'UNKNOWN',
      reason: 'Evidence is hidden by permission; its existence and contents are not implied.' });
  }

  // Unless an authenticated original recording covers a boundary, say so explicitly. Redaction suppresses this.
  for (const boundary of BOUNDARIES) {
    if (redactedBoundaries.has(boundary)) continue;
    const list = [...groups.values()].filter(g => g.boundary === boundary);
    if (list.some(g => g.state === 'UNAVAILABLE' || g.state === 'SUPPORTED_RECORDED')) continue;
    add({ boundary, state: 'UNAVAILABLE', provenance: 'UNKNOWN',
      reason: boundary === 'EVENT_RELATIONSHIP' ? EVENT_UNAVAILABLE : DEFAULT_UNAVAILABLE });
  }

  const claims = Object.fromEntries(BOUNDARIES.map(b => [b, []]));
  for (const g of groups.values()) {
    const reason = g.stepBacked ? `${g.reason} Matching steps: ${g.count}.` : g.reason;
    claims[g.boundary].push(Object.freeze({
      boundary: g.boundary, state: g.state, provenance: g.provenance, reason,
      isAttested: g.isAttested,
      ...(g.sourceRef !== undefined ? { sourceRef: g.sourceRef } : {}),
      ...(g.lossReasons !== undefined ? { lossReasons: Object.freeze(g.lossReasons) } : {})
    }));
  }
  for (const b of BOUNDARIES) claims[b] = Object.freeze(claims[b]);

  // Trust status: the imported file is unverified unless attested, and an API result is stored facts only.
  const importedClaimsUnverified = !trust.attested &&
    (trust.source !== 'GRAYLOG_AUTHORIZED_API' || view.steps.some(s => s.provenance !== 'OBSERVED'));
  if (importedClaimsUnverified) warnings.push('Imported evidence is unverified.');
  if (facts.complete && !trust.attested) warnings.push('Imported capture.complete=true is an unverified claim and does not certify completeness.');
  if (facts.partial) warnings.push('Recording is partial or its completeness is unknown.');
  if (facts.hasSource) warnings.push('Imported capture.source is not trusted; trust comes only from the viewer context.');
  if (view.steps.length === 0) warnings.push('No steps: only the stored final document is known.');
  if (hasReplay) warnings.push('Replay evidence does not prove original execution.');
  if (hasInferred) warnings.push('Inferred or unknown-provenance steps are not treated as evidence.');
  if (droppedConflicts) warnings.push('Recorded claims that conflict with the declared capture boundary were not used.');
  if (redactedBoundaries.size > 0) warnings.push('Some evidence is hidden by permission; absence is not implied.');

  return Object.freeze({
    boundaries: Object.freeze(claims),
    warnings: Object.freeze(warnings),
    importedClaimsUnverified,
    declaredCaptureBoundary: facts.declared
  });
}
