// ============================================================================
//  Logo de MaCinéthèque : une caméra de cinéma à deux bobines, dessinée au
//  trait. Elle prend la couleur du texte qui l'entoure (currentColor), donc
//  la couleur d'accent du site partout où on l'utilise.
// ============================================================================
import { h, svg } from '../utils.js';

/** Le dessin seul. `height` en pixels ; la largeur suit (proportions 112 × 96). */
export function logo(height = 28) {
  return svg('svg', {
    class: 'logo', viewBox: '0 0 112 96', width: Math.round((height * 112) / 96), height,
    fill: 'none', stroke: 'currentColor', 'stroke-width': 5, 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  },
  svg('circle', { class: 'logo__reel', cx: 27, cy: 22, r: 14 }),
  svg('circle', { class: 'logo__reel', cx: 61, cy: 22, r: 14 }),
  svg('circle', { cx: 27, cy: 22, r: 3, fill: 'currentColor', stroke: 'none' }),
  svg('circle', { cx: 61, cy: 22, r: 3, fill: 'currentColor', stroke: 'none' }),
  svg('rect', { x: 7, y: 44, width: 72, height: 44, rx: 6 }),
  svg('polygon', { points: '79,56 105,44 105,88 79,76' }));
}

/** Logo + nom du site (en-tête, écran de connexion, écran de chargement). */
export function brand({ big = false, href = null } = {}) {
  const content = [logo(big ? 64 : 28), h('span', { class: 'brand__name' }, 'MaCinéthèque')];
  return href
    ? h('a', { class: 'brand', href, 'aria-label': 'MaCinéthèque — accueil' }, content)
    : h('div', { class: `brand${big ? ' brand--big' : ''}` }, content);
}
