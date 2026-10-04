import { validateTrace, fieldHistory, traceSummary, diagnostics } from './trace.js';
const $ = id => document.getElementById(id);
let current;
let request = 0;
const element = (tag, text) => { const e = document.createElement(tag); e.textContent = text; return e; };
function show(value, source) {
  const trace = validateTrace(value);
  current = trace;
  $('error').textContent = '';
  $('status').textContent = source + ' · Imported provenance is supplied by the file and is not authenticated.';
  $('identity').textContent = `${trace.message.index} / ${trace.message.id}`;
  $('summary').textContent = traceSummary(trace);
  $('flow').replaceChildren(...trace.steps.map(step => {
    const row = element('li', step.label);
    const badge = element('span', step.provenance); badge.className = 'badge'; row.append(badge);
    if (step.duration_us !== undefined) row.append(element('p', `${step.duration_us} µs (${step.provenance})`));
    return row;
  }));
  const names = new Set(Object.keys(trace.message.fields));
  for (const step of trace.steps) for (const snapshot of [step.before, step.after])
    for (const name of Object.keys(snapshot ?? {})) names.add(name);
  $('history').replaceChildren();
  $('fields').replaceChildren(...[...names].sort().map(name => {
    const button = element('button', name);
    button.onclick = () => {
      const history = fieldHistory(trace, name);
      $('history').replaceChildren(element('h3', name), element('pre', JSON.stringify({
        present_in_final: Object.hasOwn(trace.message.fields, name), final: trace.message.fields[name],
        history: history.length ? history : 'No producer evidence available.'
      }, null, 2)));
    };
    return button;
  }));
  const notes = diagnostics(trace);
  $('diagnostics').replaceChildren(...(notes.length ? notes : ['No supported diagnostic detected; this does not establish processing correctness.']).map(n => element('li', n)));
  $('trace').hidden = false;
  $('export').disabled = false;
}
function fail(error) {
  current = undefined; $('trace').hidden = true; $('export').disabled = true;
  $('status').textContent = 'No trace loaded.'; $('error').textContent = error.message;
}
$('file').onchange = async event => {
  const ticket = ++request;
  try {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024) throw new Error('Maximum file size is 5 MiB.');
    const content = await file.text(); if (ticket !== request) return;
    show(JSON.parse(content), file.name);
  } catch (error) { if (ticket === request) fail(error); }
};
$('demo').onclick = async () => {
  const ticket = ++request;
  try {
    const response = await fetch('./example.json'); if (!response.ok) throw new Error('Example could not be loaded.');
    const value = await response.json(); if (ticket === request) show(value, 'ILLUSTRATIVE EXAMPLE · synthetic data');
  } catch (error) { if (ticket === request) fail(error); }
};
$('export').onclick = () => {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'message-trace.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
