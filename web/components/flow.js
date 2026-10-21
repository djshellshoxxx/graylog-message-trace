import { $, el } from './dom.js';
import { FLOW_PRESETS, applyPreset, defaultFlowFilter, filterFlow, validateFlowFilter } from '../features/filter.js';
import { OUTCOMES } from '../features/normalize.js';
import { PROVENANCE } from '../trace.js';

// Flow list with preset/outcome/provenance/duration filters. Evidence is never altered; the
// original step number is always shown so filtering cannot silently renumber events.
export function mountFlow(onChange) {
  const state = { view: null, filter: defaultFlowFilter(), preset: 'All steps', hits: new Set(), active: -1 };
  const preset = $('preset');
  preset.replaceChildren(...FLOW_PRESETS.map(p => { const o = el('option', p); o.value = p; return o; }));
  const fill = (id, values) => $(id).replaceChildren(el('option', 'Any'), ...values.map(v => { const o = el('option', v); o.value = v; return o; }));
  fill('f-outcome', OUTCOMES); fill('f-prov', PROVENANCE);
  const syncFromControls = () => {
    const f = { ...state.filter };
    f.outcomes = $('f-outcome').value === 'Any' ? null : new Set([$('f-outcome').value]);
    f.provenance = $('f-prov').value === 'Any' ? null : new Set([$('f-prov').value]);
    f.changedOnly = $('f-changed').checked;
    const d = $('f-duration').value.trim();
    f.minDurationUs = d === '' ? null : Number(d);
    state.filter = f; state.preset = 'Custom'; preset.value = 'All steps';
    render(); onChange?.();
  };
  preset.onchange = () => {
    state.filter = applyPreset(preset.value); state.preset = preset.value;
    $('f-outcome').value = 'Any'; $('f-prov').value = 'Any';
    $('f-changed').checked = state.filter.changedOnly;
    $('f-duration').value = state.filter.minDurationUs ?? '';
    render(); onChange?.();
  };
  for (const id of ['f-outcome', 'f-prov', 'f-changed']) $(id).onchange = syncFromControls;
  $('f-duration').oninput = syncFromControls;
  $('f-clear').onclick = () => {
    state.filter = defaultFlowFilter(); state.preset = 'All steps'; preset.value = 'All steps';
    $('f-outcome').value = 'Any'; $('f-prov').value = 'Any'; $('f-changed').checked = false; $('f-duration').value = '';
    render(); onChange?.();
  };

  function visible() {
    const check = validateFlowFilter(state.filter);
    if (!check.valid) return { error: check.errors.join(' '), indices: [], total: state.view.steps.length };
    return filterFlow(state.view, state.filter);
  }
  function render() {
    if (!state.view) return;
    const r = visible();
    $('f-error').textContent = r.error ?? '';
    $('f-count').textContent = r.error ? '' : `Showing ${r.shown} of ${r.total} steps (all evidence remains loaded).`;
    state.visibleIndices = r.indices;
    const rows = r.indices.map(i => {
      const s = state.view.steps[i];
      const row = el('li', `#${i + 1} ${s.label}`);
      if (state.hits.has(i)) row.className = 'hit' + (i === state.active ? ' active' : '');
      row.id = 'step-' + i;
      row.append(el('span', s.provenance, 'badge'));
      if (s.outcome) row.append(el('span', s.outcome, 'badge'));
      if (s.duration_us !== undefined) row.append(el('p', `${s.duration_us} µs (${s.provenance})`));
      if (s.changedFields.length) row.append(el('p', 'changed: ' + s.changedFields.join(', ')));
      return row;
    });
    $('flow').replaceChildren(...(rows.length ? rows :
      [el('li', 'No matching visible steps; this is not evidence that a rule did not run.')]));
  }
  return {
    setView(view) {
      state.view = view; state.hits = new Set(); state.active = -1;
      $('f-clear').onclick(); 
    },
    setHits(hits, active) { state.hits = hits; state.active = active; render(); },
    visibleIndices: () => state.visibleIndices ?? [],
    isFiltered: () => state.preset !== 'All steps'
  };
}
