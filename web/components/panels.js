import { $, el } from './dom.js';
import { buildCoverage } from '../features/coverage.js';
import { buildFieldJourney } from '../features/journey.js';

export function renderCoverage(view, trust) {
  const report = buildCoverage(view, trust);
  const items = Object.entries(report.boundaries).flatMap(([b, claims]) =>
    claims.map(c => el('li', `${b.replaceAll('_', ' ')}: ${c.state.replaceAll('_', ' ')} (${c.provenance}) — ${c.reason}`)));
  $('coverage').replaceChildren(...items);
}

export function renderJourney(view, field, trust) {
  const j = buildFieldJourney(view, field, trust);
  const box = $('history');
  const fmt = s => s.present ? `${s.type} ${JSON.stringify(s.value)}` : 'absent';
  const list = el('ol');
  for (const t of j.transitions)
    list.append(el('li', `#${t.stepIndex + 1} ${t.kind} (${t.provenance}): ${fmt(t.before)} → ${fmt(t.after)}`));
  box.replaceChildren(el('h3', field),
    el('p', 'Final: ' + JSON.stringify(j.finalState)),
    j.transitions.length ? list : el('p', 'No producer evidence available.'),
    ...j.gaps.map(g => el('p', 'Gap: ' + g.reason, 'gap')));
}
