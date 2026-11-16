// MT-006 pure Markdown investigation report (serialization only, no DOM).
// Deterministic and offline: no clock, randomness, network, storage or credentials.
// Every trace-derived string is escaped so it renders as inert text: no raw HTML,
// no links, no autolinks. Field values appear only on explicit opt-in and never
// when the server marked them REDACTED_BY_PERMISSION.
import { diagnostics, fieldDiff, PROVENANCE } from '../trace.js';

export const EXPORT_SECTIONS = Object.freeze(['FLOW', 'FIELDS', 'DIAGNOSTICS', 'TOPOLOGY', 'RAW']);
export const EXPORT_SCOPES = Object.freeze(['FULL', 'VISIBLE_SELECTION']);
export const MAX_VALUE_BYTES = 1024;
export const MAX_EXPORT_BYTES = 2 * 1024 * 1024;

const REDACTED = 'REDACTED_BY_PERMISSION';
const RESERVE_BYTES = 4096; // room for top-of-file truncation warning and cut note
const OPTION_KEYS = new Set(['scope', 'includeFieldValues', 'sections', 'selectedStepIndices',
  'selectedFieldNames', 'generatedAtIso', 'coverageText']);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ASCII_PUNCTUATION = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');
const CONTROL_SHORT = new Map([['\n', '\\\\n'], ['\r', '\\\\r'], ['\t', '\\\\t']]);
const SOURCE_LABELS = new Map([
  ['AUTHORIZED_API', 'authorized API'],
  ['SERVER_COLLECTOR', 'server collector (authorized)'],
  ['FILE_IMPORT', 'imported file (unverified)'],
  ['REPLAY', 'replay (source unverified)']
]);
const BOUNDARIES = new Set(['INPUT_TO_INDEX', 'PIPELINE_ONLY', 'PROCESSOR_ONLY', 'STORED_ONLY', 'UNKNOWN']);
const PIPELINE_KINDS = new Set(['PIPELINE', 'STAGE', 'RULE', 'PROCESSOR', 'CODEC', 'EXTRACTOR']);
const REPLAY_PROVENANCE = new Set(['CURRENT_REPLAY', 'HISTORICAL_REPLAY']);
const DERIVED_PROVENANCE = new Set(['RECONSTRUCTED', 'INFERRED']);
const NOT_INCLUDED = '- Not included: section disabled by export options.';
const encoder = new TextEncoder();
const byteLength = (s) => encoder.encode(s).length;
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const hex4 = (cp) => cp.toString(16).toUpperCase().padStart(4, '0');

// Code points that are invisible or can reorder/spoof text in a rendered page.
function isInvisible(cp) {
  return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029 ||
    (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x206f) || cp === 0xfeff || (cp >= 0xfff9 && cp <= 0xfffb);
}

// Escapes untrusted text for inline Markdown. Every ASCII punctuation character is
// backslash-escaped, which disables emphasis, links, autolinks (http://, www., @),
// HTML and entities; control and bidi characters become visible \uXXXX text.
export function escapeText(value) {
  let out = '';
  for (const ch of String(value)) {
    const cp = ch.codePointAt(0);
    if (CONTROL_SHORT.has(ch)) out += CONTROL_SHORT.get(ch);
    else if (cp >= 0xd800 && cp <= 0xdfff) out += `\\\\u${hex4(cp)}`; // lone surrogate
    else if (isInvisible(cp)) out += `\\\\u${hex4(cp)}`;
    else if (ASCII_PUNCTUATION.has(ch)) out += '\\' + ch;
    else out += ch;
  }
  return out;
}

// JSON-quoted preview of a value, cut at a code point boundary to MAX_VALUE_BYTES.
function previewValue(value) {
  const json = JSON.stringify(value) ?? 'undefined';
  if (byteLength(json) <= MAX_VALUE_BYTES) return { text: json, truncated: false };
  const limit = MAX_VALUE_BYTES - 3;
  let out = '';
  let bytes = 0;
  for (const ch of json) {
    const b = byteLength(ch);
    if (bytes + b > limit) break;
    out += ch;
    bytes += b;
  }
  return { text: `${out}...`, truncated: true };
}

const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const isRedacted = (v) => v === REDACTED || (isObject(v) && v.state === REDACTED);

function redactionFor(trace) {
  if (isRedacted(trace.visibility)) return { all: true, fields: new Set() };
  const listed = isObject(trace.visibility) && Array.isArray(trace.visibility.redacted_fields)
    ? trace.visibility.redacted_fields.filter((x) => typeof x === 'string') : [];
  return { all: false, fields: new Set(listed) };
}

function checkOptions(options, total) {
  if (!isObject(options)) throw new TypeError('Export options must be an object.');
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.has(key)) throw new TypeError(`Unknown export option: ${key}.`);
  }
  const scope = options.scope;
  if (!EXPORT_SCOPES.includes(scope)) throw new RangeError(`scope must be one of ${EXPORT_SCOPES.join(', ')}.`);
  const includeFieldValues = options.includeFieldValues ?? false;
  if (typeof includeFieldValues !== 'boolean') throw new TypeError('includeFieldValues must be a boolean.');
  if (!(options.sections instanceof Set)) throw new TypeError('sections must be a Set of export sections.');
  for (const section of options.sections) {
    if (!EXPORT_SECTIONS.includes(section)) throw new RangeError(`Unknown export section: ${String(section)}.`);
  }
  const generatedAtIso = options.generatedAtIso;
  if (typeof generatedAtIso !== 'string' || !ISO_UTC.test(generatedAtIso) || Number.isNaN(Date.parse(generatedAtIso))) {
    throw new RangeError('generatedAtIso must be a UTC ISO-8601 timestamp such as 2026-10-13T00:00:00Z.');
  }
  let selectedStepIndices;
  if (scope === 'FULL') {
    if (options.selectedStepIndices !== undefined) throw new TypeError('selectedStepIndices requires scope VISIBLE_SELECTION.');
  } else {
    const list = options.selectedStepIndices;
    if (!Array.isArray(list)) throw new TypeError('VISIBLE_SELECTION requires selectedStepIndices.');
    const seen = new Set();
    for (const index of list) {
      if (!Number.isInteger(index) || index < 0 || index >= total) throw new RangeError(`Invalid step index: ${String(index)}.`);
      if (seen.has(index)) throw new RangeError(`Duplicate step index: ${index}.`);
      seen.add(index);
    }
    selectedStepIndices = [...list].sort((a, b) => a - b);
  }
  let selectedFieldNames;
  if (options.selectedFieldNames !== undefined) {
    if (!Array.isArray(options.selectedFieldNames) || !options.selectedFieldNames.every((n) => typeof n === 'string')) {
      throw new TypeError('selectedFieldNames must be an array of strings.');
    }
    selectedFieldNames = [...new Set(options.selectedFieldNames)];
  }
  if (options.coverageText !== undefined && typeof options.coverageText !== 'string') {
    throw new TypeError('coverageText must be a string.');
  }
  return {
    scope, includeFieldValues, generatedAtIso, selectedStepIndices, selectedFieldNames,
    sections: new Set(options.sections), coverageText: options.coverageText
  };
}

function fnv1a(text) {
  let h = 0x811c9dc5;
  for (const b of encoder.encode(text)) h = (Math.imul(h ^ b, 0x01000193)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// Fixed-prefix filename: UTC date plus a short hash of message identity. Never includes field content.
export function investigationFilename(generatedAtIso, messageIndex, messageId) {
  if (typeof generatedAtIso !== 'string' || !ISO_UTC.test(generatedAtIso) || Number.isNaN(Date.parse(generatedAtIso))) {
    throw new RangeError('generatedAtIso must be a UTC ISO-8601 timestamp.');
  }
  if (typeof messageIndex !== 'string' || typeof messageId !== 'string') throw new TypeError('Message identity must be strings.');
  const day = generatedAtIso.slice(0, 10).replaceAll('-', '');
  return `message-trace-${day}-${fnv1a(`${messageIndex}\n${messageId}`).slice(0, 6)}.md`;
}

const section = (title, lines) => [`## ${title}`, ...lines, ''];

// Builds the investigation report. `view` is a normalizeTraceView() result; `options.coverageText`
// is optional, caller-supplied coverage text (escaped, never interpreted).
export function makeInvestigationMarkdown(view, options) {
  if (!isObject(view) || !isObject(view.trace) || !Array.isArray(view.steps) || !Array.isArray(view.fieldNames)) {
    throw new TypeError('Expected a normalized trace view from normalizeTraceView().');
  }
  const trace = view.trace;
  const fields = trace.message.fields;
  const all = view.steps;
  const total = all.length;
  const opts = checkOptions(options, total);
  const subset = opts.scope === 'VISIBLE_SELECTION';
  const picked = subset ? opts.selectedStepIndices : all.map((_, i) => i);
  const has = (name) => opts.sections.has(name);
  const red = redactionFor(trace);
  const nameSet = new Set(view.fieldNames);
  const names = opts.selectedFieldNames ? view.fieldNames.filter((n) => opts.selectedFieldNames.includes(n)) : view.fieldNames;
  const missingNames = opts.selectedFieldNames ? opts.selectedFieldNames.filter((n) => !nameSet.has(n)) : [];
  let withheld = 0;
  let previewCut = 0;

  // Returns null when values are off; otherwise the escaped value or the redaction placeholder.
  const valueText = (name, rawStep, value) => {
    if (!opts.includeFieldValues) return null;
    if (red.all || red.fields.has(name) || isRedacted(rawStep?.visibility)) {
      withheld++;
      return escapeText(`[${REDACTED}]`);
    }
    const preview = previewValue(value);
    if (preview.truncated) previewCut++;
    return escapeText(preview.text);
  };
  const side = (name, rawStep, present, value) => {
    if (!present) return 'absent';
    const text = valueText(name, rawStep, value);
    return text === null ? typeName(value) : `${typeName(value)} ${text}`;
  };
  const labelOf = (s) => (opts.includeFieldValues ? `"${escapeText(s.label)}"` : 'label omitted (names and types mode)');

  // Coverage always comes from the complete trace, never from the selection.
  const counts = new Map();
  for (const s of all) counts.set(s.provenance, (counts.get(s.provenance) ?? 0) + 1);
  const rank = (p) => { const i = PROVENANCE.indexOf(p); return i < 0 ? PROVENANCE.length : i; };
  const provText = [...counts.entries()].sort(([a], [b]) => rank(a) - rank(b))
    .map(([p, c]) => `${escapeText(p)} ${c}`).join(', ') || 'none';
  const recordedPresent = all.some((s) => s.provenance === 'RECORDED');
  const boundary = BOUNDARIES.has(trace.capture?.boundary) ? trace.capture.boundary : 'UNKNOWN';
  const source = SOURCE_LABELS.get(trace.capture?.source) ?? 'imported file / unspecified (unverified)';
  const replayOrigin = typeof trace.replay_input === 'string' && /^[A-Z_]{1,40}$/.test(trace.replay_input)
    ? trace.replay_input : 'UNKNOWN';
  const originalExecution = recordedPresent
    ? `partial (not automatically verified)${trace.capture?.complete === true ? '; import claims complete (not verified)' : ''}`
    : 'UNKNOWN';

  const coverageLines = () => {
    const finalDoc = Object.keys(fields).length > 0 || all.some((s) => s.provenance === 'OBSERVED');
    const pipeline = all.some((s) => s.provenance === 'RECORDED' && PIPELINE_KINDS.has(s.kind));
    const streamObserved = all.some((s) => s.kind === 'STREAM' && s.provenance === 'OBSERVED');
    const streamRecorded = all.some((s) => s.kind === 'STREAM' && s.provenance === 'RECORDED');
    const replay = all.some((s) => REPLAY_PROVENANCE.has(s.provenance));
    const derived = all.some((s) => DERIVED_PROVENANCE.has(s.provenance));
    const lines = [
      `- Final indexed document: ${finalDoc ? 'OBSERVED (when authorized)' : 'UNKNOWN'}`,
      `- Historical pipeline execution: ${pipeline ? 'PARTIAL RECORDED (completeness not verified)' : 'UNKNOWN'}`,
      `- Final stream IDs: ${streamObserved ? 'OBSERVED' : 'UNKNOWN'}; routing history: ${streamRecorded ? 'PARTIAL RECORDED (not verified)' : 'UNKNOWN'}`,
      `- Replay evidence: ${replay ? 'present; describes the replay only, not original execution' : 'none in this trace'}`,
      `- Reconstructed or inferred steps: ${derived ? 'present; not evidence of original execution' : 'none in this trace'}`,
      `- Capture boundary: ${boundary}`,
      `- Steps by provenance (complete trace, ${total} steps): ${provText}`
    ];
    if (typeof opts.coverageText === 'string') {
      lines.push('- Coverage report (caller supplied):');
      for (const line of opts.coverageText.split('\n')) {
        if (line.trim()) lines.push(`  - ${escapeText(line.trim())}`);
      }
    }
    return lines;
  };

  const diagnosticLines = () => {
    if (!has('DIAGNOSTICS')) return [NOT_INCLUDED];
    const lines = diagnostics(trace).map((text) => `- ${escapeText(text)}`);
    for (const pos of picked) {
      const s = all[pos];
      if (s.kind === 'DIAGNOSTIC') {
        lines.push(`- Diagnostic step #${pos}: ${labelOf(s)} (provenance: ${escapeText(s.provenance)}; outcome ${s.outcome ?? 'UNKNOWN'})`);
      }
    }
    if (lines.length === 0) {
      lines.push('- No diagnostics derived from this trace. The absence of a diagnostic is not evidence that nothing failed.');
    }
    return lines;
  };

  const flowLines = () => {
    if (!has('FLOW')) return [NOT_INCLUDED];
    if (picked.length === 0) return ['- No steps selected.'];
    return picked.map((pos, n) => {
      const s = all[pos];
      const bits = [`kind ${s.kind}`, `outcome ${s.outcome ?? 'UNKNOWN'}`];
      if (s.sequence !== undefined) bits.push(`sequence ${s.sequence}`);
      if (typeof s.duration_us === 'number' && Number.isFinite(s.duration_us)) {
        bits.push(`duration_us ${s.duration_us} (declared for ${escapeText(s.provenance)})`);
      }
      if (opts.includeFieldValues && s.scope) {
        bits.push(`scope ${Object.entries(s.scope).map(([k, v]) => `${escapeText(k)}=${escapeText(v)}`).join(', ')}`);
      }
      if (s.step.before === undefined) bits.push('no before/after snapshots (no field change evidence)');
      else bits.push(s.changedFields.length
        ? `changed fields ${s.changedFields.map((f) => escapeText(f)).join(', ')}`
        : 'snapshots paired with no field changes');
      return `${n + 1}. step #${pos}: ${labelOf(s)}; ${bits.join('; ')}. (provenance: ${escapeText(s.provenance)})`;
    });
  };

  const journeyLines = () => {
    if (!has('FIELDS')) return [NOT_INCLUDED];
    const changes = new Map(names.map((n) => [n, []]));
    let noSnapshot = 0;
    for (const pos of picked) {
      const raw = all[pos].step;
      if (raw.before === undefined || raw.after === undefined) { noSnapshot++; continue; }
      for (const d of fieldDiff(raw.before, raw.after)) {
        const list = changes.get(d.field);
        if (list) list.push({ pos, raw, d });
      }
    }
    const out = [`- Steps in view without before/after snapshots: ${noSnapshot} of ${picked.length}. They carry no field-change evidence and do not show that a field was unchanged.`];
    if (names.length === 0) out.push('- No fields in this trace.');
    for (const name of names) {
      const present = Object.hasOwn(fields, name);
      out.push(`- ${escapeText(name)}: final indexed document ${side(name, undefined, present, fields[name])}`);
      for (const { pos, raw, d } of changes.get(name)) {
        out.push(`  - step #${pos} (provenance: ${escapeText(all[pos].provenance)}): ${d.kind}; before ${side(name, raw, d.presentBefore, d.before)}; after ${side(name, raw, d.presentAfter, d.after)}`);
      }
    }
    return out;
  };

  const rawLines = () => {
    if (!has('RAW')) return [NOT_INCLUDED];
    const keys = Object.keys(fields).sort();
    if (keys.length === 0) return ['- No message fields.'];
    return keys.map((k) => `- ${escapeText(k)}: ${side(k, undefined, true, fields[k])}`);
  };

  const topologyLines = () => (has('TOPOLOGY')
    ? ['- Not supported by this trace source; no topology evidence is included.']
    : [NOT_INCLUDED]);

  // Body is generated in full first so that counters and warnings are complete.
  const body = [
    ...section('Evidence Coverage', coverageLines()),
    ...section('Diagnostics', diagnosticLines()),
    ...section('Flow Evidence', flowLines()),
    ...section('Field Journey', journeyLines()),
    ...section('Raw Message', rawLines()),
    ...section('Current Topology', topologyLines())
  ];

  const warnings = [];
  if (subset) warnings.push(`INCOMPLETE SUBSET: ${picked.length} of ${total} steps included. Coverage describes the complete trace.`);
  if (missingNames.length) warnings.push(`${missingNames.length} selected field name(s) are not present in this trace and were ignored.`);
  if (withheld) warnings.push(`${withheld} field value(s) withheld: server-redacted values (${REDACTED}) cannot be enabled.`);
  if (previewCut) warnings.push(`${previewCut} field value preview(s) truncated to ${MAX_VALUE_BYTES} bytes.`);

  const disabled = EXPORT_SECTIONS.filter((s) => !has(s)).join(', ') || 'none';
  const tail = section('Unknowns and Limitations', [
    '- Original execution is not verified by this report. Absence of evidence does not show that a rule, stage, or stream did or did not run.',
    '- Historical pipeline execution and routing history stay UNKNOWN unless typed RECORDED evidence says otherwise.',
    '- Provenance labels and capture claims come from the trace file or adapter and are not authenticated here. A local import cannot certify origin or permission.',
    '- Server permission is not rechecked by this offline formatter; the report reflects only the authorized data it was given.',
    opts.includeFieldValues
      ? '- Field values are included on explicit opt-in; server-redacted values are never included.'
      : '- Field values are omitted (names and types only); server-redacted values are never included.',
    ...(subset ? [`- Selected subset: ${picked.length} of ${total} steps. Coverage describes the complete trace.`] : []),
    ...(all.some((s) => REPLAY_PROVENANCE.has(s.provenance)) ? ['- Replay steps describe the replay only, not the original execution.'] : []),
    `- Sections not included: ${disabled}.`,
    '- If the export is truncated, the warning at the top lists the limit that was reached.'
  ]);

  const headerBase = [
    '# Message Trace Investigation',
    '',
    '- Report format: 1',
    `- Generated: ${opts.generatedAtIso}`,
    `- Physical index: ${escapeText(trace.message.index)}`,
    `- Message ID: ${escapeText(trace.message.id)}`,
    `- Evidence source: ${source}`,
    `- Trace view: ${subset ? `selected subset (${picked.length} of ${total} steps) INCOMPLETE SUBSET` : 'full'}`,
    `- Original execution: ${originalExecution}`,
    `- Capture boundary: ${boundary}`,
    `- Replay origin: ${replayOrigin}`,
    `- Provenance labels: ${PROVENANCE.join(', ')}. Imported provenance is not authenticated.`,
    `- Final indexed document fields: ${Object.keys(fields).length}`,
    ''
  ];
  const warningLines = warnings.map((w) => `> WARNING: ${w}`);
  const fixedBytes = [...headerBase, ...warningLines, '', ...tail]
    .reduce((sum, line) => sum + byteLength(line) + 1, 0);
  const budget = MAX_EXPORT_BYTES - RESERVE_BYTES - fixedBytes;

  let used = 0;
  let cutAt = -1;
  for (let i = 0; i < body.length; i++) {
    used += byteLength(body[i]) + 1;
    if (used > budget) { cutAt = i; break; }
  }
  const truncated = cutAt >= 0 || previewCut > 0;
  const kept = cutAt >= 0 ? body.slice(0, cutAt) : body;
  const outWarnings = [...warnings];
  const topLines = [...headerBase, ...warningLines];
  if (cutAt >= 0) {
    const omitted = body.length - cutAt;
    outWarnings.push(`Export truncated at ${MAX_EXPORT_BYTES} bytes; ${omitted} later line(s) omitted.`);
    topLines.push(`> WARNING: ${outWarnings[outWarnings.length - 1]}`);
    kept.push(`> TRUNCATED: export limit reached; ${omitted} later line(s) omitted from this report.`);
  }
  const text = [...topLines, '', ...kept, ...tail].join('\n');
  const byteCount = byteLength(text);
  if (byteCount > MAX_EXPORT_BYTES) throw new Error('Internal error: export exceeded its byte limit.');
  return Object.freeze({ text, byteCount, truncated, warnings: Object.freeze(outWarnings) });
}
