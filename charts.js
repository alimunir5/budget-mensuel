// Graphiques en SVG et HTML, sans dépendance. Chaque fonction renvoie du balisage ;
// les couleurs de séries et d'encre viennent des variables CSS du thème.

import { formatEuro, formatPercent, monthShortLabel, monthLabel } from './store.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Graduations rondes (en centimes) qui englobent min, max et zéro.
export function niceTicks(min, max, count = 4) {
  const low = Math.min(0, min);
  const high = Math.max(0, max);
  if (low === high) return [0, 10000];
  const rough = (high - low) / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = [1, 2, 2.5, 5, 10].find((m) => m * power >= rough) * power;
  const ticks = [];
  for (let t = Math.floor(low / unit) * unit; t < high + unit; t += unit) ticks.push(Math.round(t));
  return ticks;
}

// ---------- Donut ----------

export function donut({ total, slices }, selectedId) {
  const size = 200;
  const radius = 82;
  const stroke = 20;
  const circumference = 2 * Math.PI * radius;
  const gap = slices.length > 1 ? 2 : 0;
  let start = 0;
  const arcs = slices.map((slice) => {
    const length = slice.share * circumference;
    const dimmed = selectedId && selectedId !== slice.category.id;
    const arc = `<circle class="donut-arc${dimmed ? ' is-dimmed' : ''}" data-action="chart-slice" data-id="${esc(slice.category.id)}"
      cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${esc(slice.category.color)}" stroke-width="${stroke}"
      stroke-dasharray="${Math.max(length - gap, 0.5)} ${circumference}" stroke-dashoffset="${-start}"
      transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(slice.category.name)} : ${formatPercent(slice.share)}, ${formatEuro(slice.amount)}</title></circle>`;
    start += length;
    return arc;
  });

  const selected = slices.find((s) => s.category.id === selectedId);
  const center = selected
    ? `<span class="donut-label">${esc(selected.category.name)}</span>
       <strong>${formatEuro(selected.amount)}</strong>
       <span class="donut-label">${formatPercent(selected.share)}</span>`
    : `<span class="donut-label">Total</span><strong>${formatEuro(total)}</strong>`;

  const legend = slices.map((slice) => `
    <li>
      <button type="button" class="legend-row${slice.category.id === selectedId ? ' is-selected' : ''}" data-action="chart-slice" data-id="${esc(slice.category.id)}">
        <i class="swatch" style="background:${esc(slice.category.color)}"></i>
        <span class="legend-name">${esc(slice.category.name)}</span>
        <span class="legend-pct">${formatPercent(slice.share)}</span>
        <span class="legend-amount">${formatEuro(slice.amount)}</span>
      </button>
    </li>`).join('');

  return `
    <div class="donut">
      <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Répartition des dépenses par catégorie, détail dans la liste ci-dessous">${arcs.join('')}</svg>
      <div class="donut-center">${center}</div>
    </div>
    <ul class="legend-list">${legend}</ul>`;
}

// ---------- Barres prévu / réel ----------

export function plannedActualBars(groups) {
  const max = Math.max(1, ...groups.flatMap((g) => [g.planned, g.actual]));
  const width = (value) => (value > 0 ? `${Math.max((value / max) * 100, 1)}%` : '0');
  const rows = groups.map((g) => `
    <div class="pa-row">
      <div class="pa-head">
        <span class="pa-name"><i class="swatch" style="background:${esc(g.category.color)}"></i>${esc(g.category.name)}</span>
        ${g.over ? `<span class="pa-over">⚠ +${formatEuro(g.actual - g.planned)}</span>` : ''}
      </div>
      <div class="pa-bar"><div class="pa-track"><i class="pa-planned" style="width:${width(g.planned)}"></i></div><span>${formatEuro(g.planned)}</span></div>
      <div class="pa-bar"><div class="pa-track"><i class="pa-actual" style="width:${width(g.actual)}"></i></div><span>${formatEuro(g.actual)}</span></div>
    </div>`).join('');
  return `
    <div class="chart-legend">
      <span><i class="swatch pa-planned"></i>Prévu</span>
      <span><i class="swatch pa-actual"></i>Réel</span>
    </div>
    ${rows}`;
}

// ---------- Courbe d'évolution ----------

export const EVOLUTION_SERIES = [
  { id: 'remaining', label: 'Argent restant', color: 'var(--s1)' },
  { id: 'expenses', label: 'Dépenses', color: 'var(--s2)' },
  { id: 'savings', label: 'Épargne', color: 'var(--s3)' },
];

export function evolutionValues(point, basis) {
  const prefix = basis === 'actual' ? 'actual' : 'planned';
  return { remaining: point[`${prefix}Remaining`], expenses: point[`${prefix}Expenses`], savings: point[`${prefix}Savings`] };
}

export function evolutionLine(points, basis, selectedIndex, width) {
  const height = 220;
  const margin = { top: 12, right: 14, bottom: 26, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = points.map((p) => evolutionValues(p, basis));
  const all = values.flatMap((v) => EVOLUTION_SERIES.map((s) => v[s.id]));
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const x = (i) => margin.left + (points.length > 1 ? (i / (points.length - 1)) * plotWidth : plotWidth / 2);
  const y = (v) => margin.top + plotHeight - ((v - yMin) / (yMax - yMin)) * plotHeight;

  const grid = ticks.map((t) => `
    <line class="${t === 0 ? 'axis-zero' : 'axis-grid'}" x1="${margin.left}" x2="${width - margin.right}" y1="${y(t)}" y2="${y(t)}"/>
    <text class="axis-text" x="${margin.left - 8}" y="${y(t) + 4}" text-anchor="end">${Math.round(t / 100).toLocaleString('fr-FR')}</text>`).join('');

  const every = Math.ceil(points.length / 6);
  const xLabels = points.map((p, i) => ((points.length - 1 - i) % every === 0
    ? `<text class="axis-text" x="${x(i)}" y="${height - 8}" text-anchor="middle">${esc(monthShortLabel(p.key))}</text>`
    : '')).join('');

  const lines = EVOLUTION_SERIES.map((s) => {
    const path = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v[s.id]).toFixed(1)}`).join(' ');
    return points.length > 1 ? `<path class="series-line" d="${path}" stroke="${s.color}"/>` : '';
  }).join('');

  const crosshair = `<line class="axis-cross" x1="${x(selectedIndex)}" x2="${x(selectedIndex)}" y1="${margin.top}" y2="${margin.top + plotHeight}"/>`;

  const dots = EVOLUTION_SERIES.map((s) => `<circle class="series-dot" cx="${x(selectedIndex)}" cy="${y(values[selectedIndex][s.id])}" r="5" fill="${s.color}"/>`).join('');

  // Colonnes tactiles : toucher n'importe où au-dessus d'un mois le sélectionne.
  const band = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth;
  const hits = points.map((p, i) => `<rect class="chart-hit" data-action="chart-month" data-index="${i}" x="${x(i) - band / 2}" y="0" width="${band}" height="${height}"><title>${esc(monthLabel(p.key))}</title></rect>`).join('');

  const selectedValues = values[selectedIndex];
  const readout = EVOLUTION_SERIES.map((s) => `
    <li>
      <i class="line-key" style="background:${s.color}"></i>
      <span>${s.label}</span>
      <strong>${formatEuro(selectedValues[s.id])}</strong>
    </li>`).join('');

  const tableRows = points.map((p, i) => `
    <tr><th scope="row">${esc(monthLabel(p.key))}</th>${EVOLUTION_SERIES.map((s) => `<td>${formatEuro(values[i][s.id])}</td>`).join('')}</tr>`).join('');

  return `
    <svg class="line-chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Évolution de l'argent restant, des dépenses et de l'épargne par mois, détail dans le tableau">
      ${grid}${xLabels}${lines}${crosshair}${dots}${hits}
    </svg>
    <p class="readout-title">${esc(monthLabel(points[selectedIndex].key))}</p>
    <ul class="readout">${readout}</ul>
    <details class="chart-table">
      <summary>Voir le tableau</summary>
      <div class="table-scroll"><table>
        <thead><tr><th scope="col">Mois</th>${EVOLUTION_SERIES.map((s) => `<th scope="col">${s.label}</th>`).join('')}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table></div>
    </details>`;
}
