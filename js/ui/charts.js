// ============================================================================
//  Graphiques légers, dessinés en SVG (aucune librairie).
//   - barChart : barres verticales (répartition des notes, activité par mois)
//   - rankList : classement à barres horizontales (genres, pays)
//  Une seule couleur d'accent ; survol / toucher = bulle avec la valeur exacte.
//  Chaque graphique est doublé d'un tableau invisible pour les lecteurs d'écran.
// ============================================================================
import { h, svg, formatNumber } from '../utils.js';

/** Choisit des graduations « rondes » (0, 5, 10…) pour l'axe vertical. */
function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough));
  const ticks = [];
  for (let value = 0; value < max + step; value += step) ticks.push(value);
  return ticks;
}

/** Tableau équivalent au graphique, lu par les lecteurs d'écran uniquement. */
function dataTable(caption, data, unit) {
  // (le tableau est placé dans un bloc invisible : un <table> seul ne se laisse pas masquer proprement)
  return h('div', { class: 'sr-only' }, h('table', {},
    h('caption', {}, caption),
    h('tbody', {}, data.map((d) => h('tr', {}, h('th', { scope: 'row' }, d.name || d.label), h('td', {}, `${formatNumber(d.value)} ${unit}`))))));
}

/**
 * Barres verticales.
 *   data       : [{ label, name?, value }]  (label = texte sous la barre)
 *   unit       : (n) => « 3 œuvres »        (texte de la bulle)
 *   showValues : affiche la valeur au-dessus de chaque barre (peu de barres)
 */
export function barChart({ data, caption, unit = (n) => String(n), showValues = false, height = 190 }) {
  const wrap = h('div', { class: 'chart' });
  const tooltip = h('div', { class: 'chart__tip', hidden: true });
  const max = Math.max(...data.map((d) => d.value), 0);

  function draw() {
    const width = Math.max(wrap.clientWidth, 240);
    const margin = { top: showValues ? 22 : 10, right: 4, bottom: 24, left: 26 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const ticks = niceTicks(max);
    const top = ticks[ticks.length - 1];
    const y = (value) => margin.top + plotH - (value / top) * plotH;
    const band = plotW / data.length;
    const barW = Math.min(Math.max(band - 6, 4), 46); // barres fines, 2 px d'air minimum
    // n'affiche qu'une étiquette sur 2 ou 3 si la place manque
    const every = Math.ceil(34 / band);

    const root = svg('svg', { class: 'chart__svg', width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': caption });

    // grille horizontale discrète + graduations
    for (const tick of ticks) {
      root.append(
        svg('line', { class: tick === 0 ? 'chart__axis' : 'chart__grid', x1: margin.left, x2: width - margin.right, y1: y(tick), y2: y(tick) }),
        svg('text', { class: 'chart__tick', x: margin.left - 6, y: y(tick) + 3.5, 'text-anchor': 'end' }, formatNumber(tick)));
    }

    data.forEach((d, i) => {
      const x = margin.left + band * i + (band - barW) / 2;
      const barH = (d.value / top) * plotH;
      const r = Math.min(4, barW / 2, barH); // sommet arrondi, base posée sur l'axe
      const base = margin.top + plotH;
      const bar = svg('path', {
        class: 'chart__bar',
        d: barH > 0
          ? `M${x},${base} V${base - barH + r} Q${x},${base - barH} ${x + r},${base - barH} H${x + barW - r} Q${x + barW},${base - barH} ${x + barW},${base - barH + r} V${base} Z`
          : '',
      });
      const group = svg('g', { class: 'chart__col' }, bar);
      if (showValues && d.value > 0) {
        group.append(svg('text', { class: 'chart__value', x: x + barW / 2, y: base - barH - 7, 'text-anchor': 'middle' }, formatNumber(d.value)));
      }
      if (i % every === 0) {
        group.append(svg('text', { class: 'chart__label', x: x + barW / 2, y: height - 7, 'text-anchor': 'middle' }, d.label));
      }
      // zone sensible : toute la hauteur de la colonne, plus large que la barre
      const hit = svg('rect', { class: 'chart__hit', x: margin.left + band * i, y: margin.top, width: band, height: plotH + margin.bottom, tabindex: 0, role: 'img', 'aria-label': `${d.name || d.label} : ${unit(d.value)}` });
      const show = () => {
        tooltip.replaceChildren(h('strong', {}, unit(d.value)), h('span', {}, d.name || d.label));
        tooltip.hidden = false;
        const tipW = tooltip.offsetWidth;
        tooltip.style.left = `${Math.min(Math.max(x + barW / 2 - tipW / 2, 0), width - tipW)}px`;
        tooltip.style.top = `${Math.max(base - barH - tooltip.offsetHeight - 8, 0)}px`;
        root.classList.add('is-hovering');
        group.classList.add('is-active');
      };
      const hide = () => { tooltip.hidden = true; root.classList.remove('is-hovering'); group.classList.remove('is-active'); };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('focus', show);
      hit.addEventListener('blur', hide);
      group.append(hit);
      root.append(group);
    });

    wrap.replaceChildren(root, tooltip, dataTable(caption, data, ''));
  }

  // redessine quand la largeur disponible change (rotation du téléphone…)
  let lastWidth = 0;
  new ResizeObserver(() => {
    if (wrap.clientWidth && wrap.clientWidth !== lastWidth) { lastWidth = wrap.clientWidth; draw(); }
  }).observe(wrap);
  return wrap;
}

/**
 * Classement à barres horizontales.
 *   data : [{ label, value, note? }]  (note = texte secondaire, ex. « ★ 4,2 »)
 */
export function rankList({ data, caption, unit = (n) => String(n) }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return h('div', { class: 'rank' },
    h('ol', { class: 'rank__list', 'aria-label': caption }, data.map((d) =>
      h('li', { class: 'rank__row', title: `${d.label} : ${unit(d.value)}${d.note ? ` · ${d.note}` : ''}` },
        h('span', { class: 'rank__label' }, d.label),
        h('span', { class: 'rank__track' }, h('span', { class: 'rank__bar', style: { width: `${Math.max((d.value / max) * 100, 2)}%` } })),
        h('span', { class: 'rank__value' }, formatNumber(d.value)),
        h('span', { class: 'rank__note' }, d.note || '')))));
}
