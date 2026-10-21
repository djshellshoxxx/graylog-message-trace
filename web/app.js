import { validateTrace, fieldHistory, traceSummary, diagnostics } from './trace.js';
import { normalizeTraceView } from './features/normalize.js';
import { searchTrace, intersectFlowHits } from './features/search.js';
import { makeInvestigationMarkdown, investigationFilename } from './features/markdown.js';
import { buildCoverage } from './features/coverage.js';
import { $, el, download } from './components/dom.js';
import { mountFlow } from './components/flow.js';
import { renderCoverage, renderJourney } from './components/panels.js';

let current, view, trust = { source: 'LOCAL_FILE' }, request = 0, hits = [], active = -1;
const flow = mountFlow(() => refreshSearch(false));

// Combine search hits with the current flow filter (AND); FIELD hits mark field buttons.
function refreshSearch(jump) {
  if (!view) return;
  const text = $('q').value;
  if (!text.trim()) { hits = []; active = -1; $('q-count').textContent = ''; flow.setHits(new Set(), -1); markFields(new Set()); return; }
  const r = searchTrace(view, { text, scope: 'ALL' });
  hits = intersectFlowHits(r.hits, flow.visibleIndices());
  const fieldHits = new Set(r.hits.filter(h => h.target === 'FIELD').map(h => h.fieldName));
  if (!hits.length) active = -1; else if (active < 0 || active >= hits.length || jump) active = Math.max(0, Math.min(active, hits.length - 1));
  $('q-count').textContent = `${hits.length} step hit(s) in visible flow of ${r.total} total` +
    (r.truncated || r.indexTruncated ? ' (results truncated; absence is not proven)' : '');
  flow.setHits(new Set(hits.map(h => h.stepIndex)), hits[active]?.stepIndex ?? -1);
  markFields(fieldHits);
  if (jump && hits[active]) document.getElementById('step-' + hits[active].stepIndex)?.scrollIntoView({ block: 'center' });
}
function markFields(set) { for (const b of $('fields').children) b.classList.toggle('hit', set.has(b.textContent)); }

function show(value, source, source_trust) {
  const trace = validateTrace(value);
  current = trace; view = normalizeTraceView(trace);
  trust = { source: source_trust };
  $('error').textContent = '';
  $('status').textContent = source + (source_trust === 'GRAYLOG_AUTHORIZED_API'
    ? ' · Stored facts fetched through your authorized Graylog API session.'
    : ' · Imported provenance is supplied by the file and is not authenticated.');
  $('identity').textContent = `${trace.message.index} / ${trace.message.id}`;
  $('summary').textContent = traceSummary(trace);
  $('q').value = ''; hits = []; active = -1; $('q-count').textContent = '';
  flow.setView(view);
  $('history').replaceChildren();
  $('fields').replaceChildren(...view.fieldNames.map(name => {
    const button = el('button', name);
    button.onclick = () => renderJourney(view, name, trust);
    return button;
  }));
  renderCoverage(view, trust);
  const notes = diagnostics(trace);
  $('diagnostics').replaceChildren(...(notes.length ? notes : ['No supported diagnostic detected; this does not establish processing correctness.']).map(n => el('li', n)));
  $('trace').hidden = false; $('export').disabled = false; $('export-md').disabled = false;
}
function fail(error) {
  current = view = undefined; $('trace').hidden = true; $('export').disabled = true; $('export-md').disabled = true;
  $('status').textContent = 'No trace loaded.'; $('error').textContent = error.message;
}
$('file').onchange = async event => {
  const ticket = ++request;
  try {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024) throw new Error('Maximum file size is 5 MiB.');
    const content = await file.text(); if (ticket !== request) return;
    show(JSON.parse(content), file.name, 'LOCAL_FILE');
  } catch (error) { if (ticket === request) fail(error); }
};
$('demo').onclick = async () => {
  const ticket = ++request;
  try {
    const response = await fetch('./example.json'); if (!response.ok) throw new Error('Example could not be loaded.');
    const value = await response.json(); if (ticket === request) show(value, 'ILLUSTRATIVE EXAMPLE · synthetic data', 'DEMO');
  } catch (error) { if (ticket === request) fail(error); }
};
$('q').oninput = () => { active = -1; refreshSearch(true); };
$('next').onclick = () => { if (hits.length) { active = (active + 1) % hits.length; refreshSearch(true); } };
$('prev').onclick = () => { if (hits.length) { active = (active - 1 + hits.length) % hits.length; refreshSearch(true); } };
$('export').onclick = () => { if (current) download('message-trace.json', JSON.stringify(current, null, 2), 'application/json'); };
$('export-md').onclick = () => {
  if (!view) return;
  try {
    const generatedAtIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const md = makeInvestigationMarkdown(view, {
      scope: 'FULL', sections: new Set(['FLOW', 'FIELDS', 'DIAGNOSTICS']),
      includeFieldValues: $('md-values').checked, generatedAtIso
    });
    download(investigationFilename(generatedAtIso, current.message.index, current.message.id), md.text, 'text/markdown');
  } catch (error) { $('error').textContent = error.message; }
};
// Live lookup is offered only when the local server was started with GRAYLOG_URL.
fetch('/health').then(r => r.ok ? r.json() : null).then(h => {
  if (!h?.lookup) return;
  $('lookup').hidden = false;
  $('lookup-form').onsubmit = async event => {
    event.preventDefault();
    const ticket = ++request;
    try {
      const r = await fetch('/lookup', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ index: $('l-index').value.trim(), id: $('l-id').value.trim() }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? 'Lookup failed.');
      if (ticket === request) show(body, 'Graylog lookup', 'GRAYLOG_AUTHORIZED_API');
    } catch (error) { if (ticket === request) fail(error); }
  };
}).catch(() => {});
