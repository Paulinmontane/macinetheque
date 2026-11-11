// ============================================================================
//  Affiches, grilles, squelettes de chargement et états vides.
// ============================================================================
import { h, icon } from '../utils.js';

/** Adresse de la fiche d'une œuvre. */
export function itemUrl(item) {
  return `#/oeuvre/${item.source}/${encodeURIComponent(item.source_id)}`;
}

export function typeLabel(item) { return item.type === 'serie' ? 'Série' : 'Film'; }

/**
 * Image d'affiche. Si l'image manque ou ne charge pas, on affiche un
 * rectangle sobre avec le titre, pour ne jamais avoir d'image cassée.
 */
export function poster(item, { size = 'thumb', lazy = true } = {}) {
  const url = size === 'full' ? (item.poster_url || item.thumb_url) : (item.thumb_url || item.poster_url);
  const box = h('div', { class: 'poster' });
  const placeholder = () => {
    box.classList.add('poster--empty');
    box.replaceChildren(h('span', { class: 'poster__title' }, item.title || ''));
  };
  if (!url) { placeholder(); return box; }
  const img = h('img', { src: url, alt: `Affiche de ${item.title}`, loading: lazy ? 'lazy' : 'eager', decoding: 'async' });
  img.addEventListener('load', () => box.classList.add('is-loaded'));
  img.addEventListener('error', placeholder);
  box.append(img);
  return box;
}

/** Carte d'une grille : affiche + (pastille de note) + titre + ligne d'infos. */
export function card(item, { badge = null, meta = '', action = null } = {}) {
  return h('article', { class: 'card' },
    h('a', { class: 'card__link', href: itemUrl(item), 'aria-label': `${item.title}${item.year ? ` (${item.year})` : ''}` },
      h('div', { class: 'card__poster' },
        poster(item),
        badge && h('span', { class: 'card__badge' }, badge),
        h('span', { class: 'card__type' }, typeLabel(item))),
      h('h3', { class: 'card__title' }, item.title),
      h('p', { class: 'card__meta' }, meta || item.year || ' ')),
    action);
}

export function grid(cards) { return h('div', { class: 'grid' }, cards); }

/** Grille de cartes « fantômes » affichée pendant le chargement. */
export function skeletonGrid(count = 12) {
  return h('div', { class: 'grid', 'aria-hidden': 'true' },
    Array.from({ length: count }, () => h('div', { class: 'card card--skeleton' },
      h('div', { class: 'card__poster skeleton' }),
      h('div', { class: 'skeleton skeleton--line' }),
      h('div', { class: 'skeleton skeleton--line skeleton--short' }))));
}

/** État vide soigné : icône, titre, explication, bouton éventuel. */
export function emptyState({ iconName = 'grid', title, text, action = null }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty__icon' }, icon(iconName, 28)),
    h('h2', { class: 'empty__title' }, title),
    text && h('p', { class: 'empty__text' }, text),
    action);
}

/** En-tête de page : titre + sous-titre. */
export function pageHeader(title, subtitle = '') {
  return h('header', { class: 'page-head' },
    h('h1', { class: 'page-title' }, title),
    subtitle && h('p', { class: 'page-sub' }, subtitle));
}
