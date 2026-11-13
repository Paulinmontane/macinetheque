// ============================================================================
//  Ma collection : grille d'affiches de tout ce qui est noté ou marqué vu,
//  avec tri, filtres et recherche.
// ============================================================================
import { h, icon, normalize, formatNumber } from '../utils.js';
import { collection, state } from '../store.js';
import { card, grid, emptyState, pageHeader } from '../ui/cards.js';
import { pendingRecap, bannerText } from '../recap/service.js';

// Les réglages sont gardés tant que l'onglet reste ouvert.
const DEFAULTS = { type: 'all', genre: '', minRating: 0, year: '', text: '', sort: 'date', descending: true };
const filters = { ...DEFAULTS };

const SORTS = {
  date: { label: 'date de visionnage', value: (e) => e.lastWatched },
  rating: { label: 'ma note', value: (e) => e.rating },
  year: { label: 'année de sortie', value: (e) => e.item.year },
  title: { label: 'titre', value: (e) => normalize(e.item.title) },
};

/** Texte de la pastille de note posée sur l'affiche. */
export function ratingBadge(entry) {
  if (entry.rating == null) return 'Vu';
  // sans note directe : moyenne indicative des saisons ou des épisodes (« ≈ »)
  return entry.isAverage ? `≈ ${formatNumber(entry.rating, 1)}` : `★ ${entry.rating}`;
}

export function renderCollection(root) {
  const entries = collection();
  const results = h('div', { class: 'results' });
  const count = h('p', { class: 'toolbar__count', 'aria-live': 'polite' });

  if (!entries.length) {
    root.replaceChildren(
      pageHeader('Ma collection'),
      emptyState({
        iconName: 'grid',
        title: 'Aucun film noté pour l’instant',
        text: 'Cherche un film ou une série avec la barre de recherche, ouvre sa fiche et donne-lui ta première note : elle apparaîtra ici.',
        action: h('button', { class: 'btn btn--primary', type: 'button', onClick: () => document.querySelector('.search__input')?.focus() }, 'Rechercher une œuvre'),
      }));
    return;
  }

  // ---- listes de choix calculées à partir de la collection
  const genres = [...new Set(entries.flatMap((e) => e.item.genres || []))].sort((a, b) => a.localeCompare(b, 'fr'));
  const years = [...new Set(entries.map((e) => e.item.year).filter(Boolean))].sort((a, b) => b - a);
  if (filters.genre && !genres.includes(filters.genre)) filters.genre = '';
  if (filters.year && !years.includes(Number(filters.year))) filters.year = '';

  const option = (value, label, selected) => h('option', { value, selected: String(selected) === String(value) }, label);
  const select = (key, label, options) => {
    const node = h('select', { class: 'select', 'aria-label': label }, options);
    node.addEventListener('change', () => { filters[key] = node.value; update(); });
    return node;
  };

  const typeButtons = [['all', 'Tout'], ['film', 'Films'], ['serie', 'Séries']].map(([value, label]) =>
    h('button', { class: 'segmented__btn', type: 'button', 'aria-pressed': String(filters.type === value), onClick: (event) => {
      filters.type = value;
      typeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === event.currentTarget)));
      update();
    } }, label));

  const text = h('input', { class: 'input input--search', type: 'search', placeholder: 'Rechercher dans ma collection', value: filters.text, 'aria-label': 'Rechercher dans ma collection' });
  text.addEventListener('input', () => { filters.text = text.value; update(); });

  const direction = h('button', { class: 'icon-btn icon-btn--border', type: 'button' });
  const syncDirection = () => {
    direction.textContent = filters.descending ? '↓' : '↑';
    direction.title = filters.descending ? 'Ordre décroissant' : 'Ordre croissant';
    direction.setAttribute('aria-label', `${direction.title} — cliquer pour inverser`);
  };
  direction.addEventListener('click', () => { filters.descending = !filters.descending; syncDirection(); update(); });
  syncDirection();

  const sortSelect = select('sort', 'Trier par', Object.entries(SORTS).map(([value, s]) => option(value, `Tri : ${s.label}`, filters.sort)));
  sortSelect.addEventListener('change', () => {
    filters.descending = filters.sort !== 'title'; // un titre se trie naturellement de A à Z
    syncDirection();
    update();
  });

  const toolbar = h('div', { class: 'toolbar' },
    h('div', { class: 'toolbar__row' },
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Type d’œuvre' }, typeButtons),
      text),
    h('div', { class: 'toolbar__row toolbar__row--filters' },
      select('genre', 'Genre', [option('', 'Tous les genres', filters.genre), ...genres.map((g) => option(g, g, filters.genre))]),
      select('minRating', 'Note minimale', [option(0, 'Toutes les notes', filters.minRating),
        ...[5, 4, 3, 2].map((n) => option(n, n === 5 ? '★ 5 uniquement' : `★ ${n} et plus`, filters.minRating))]),
      select('year', 'Année de sortie', [option('', 'Toutes les années', filters.year), ...years.map((y) => option(y, y, filters.year))]),
      h('div', { class: 'toolbar__sort' }, sortSelect, direction)));

  function update() {
    const needle = normalize(filters.text);
    const minRating = Number(filters.minRating);
    const visible = entries.filter((e) =>
      (filters.type === 'all' || e.item.type === filters.type)
      && (!filters.genre || (e.item.genres || []).includes(filters.genre))
      && (!minRating || (e.rating != null && e.rating >= minRating))
      && (!filters.year || e.item.year === Number(filters.year))
      && (!needle || normalize(e.item.title).includes(needle)));

    const value = SORTS[filters.sort].value;
    visible.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va == null && vb == null) return normalize(a.item.title).localeCompare(normalize(b.item.title));
      if (va == null) return 1; // sans valeur : toujours à la fin
      if (vb == null) return -1;
      const order = va < vb ? -1 : va > vb ? 1 : normalize(a.item.title).localeCompare(normalize(b.item.title));
      return filters.descending ? -order : order;
    });

    count.textContent = visible.length === entries.length
      ? `${entries.length} œuvre${entries.length > 1 ? 's' : ''}`
      : `${visible.length} sur ${entries.length} œuvre${entries.length > 1 ? 's' : ''}`;

    if (!visible.length) {
      results.replaceChildren(emptyState({
        iconName: 'search',
        title: 'Rien ne correspond à ces filtres',
        text: 'Essaie d’élargir ta recherche ou de retirer un filtre.',
        action: h('button', { class: 'btn', type: 'button', onClick: () => { Object.assign(filters, DEFAULTS); renderCollection(root); } }, 'Réinitialiser les filtres'),
      }));
      return;
    }
    results.replaceChildren(grid(visible.map((e) => card(e.item, {
      badge: ratingBadge(e),
      meta: [e.item.year, e.item.type === 'serie' && e.episodesSeen ? `${e.episodesSeen} ép. vu${e.episodesSeen > 1 ? 's' : ''}` : null].filter(Boolean).join(' · '),
    }))));
  }

  root.replaceChildren(pageHeader('Ma collection'), recapBanner(), toolbar, count, results);
  update();
}

/** Nombre d'œuvres dans la collection (affiché sur la page Compte). */
export function collectionSize() { return state.loaded ? collection().length : 0; }

/** Bannière discrète « Ton récap d’octobre est prêt » (récap pas encore ouvert). */
function recapBanner() {
  const recap = pendingRecap();
  if (!recap) return null;
  return h('a', { class: 'recap-banner', href: `#/recaps?ouvrir=${recap.kind}:${recap.key}` },
    icon('replay', 20), h('span', {}, bannerText(recap)), h('span', { class: 'recap-banner__go' }, 'Voir', icon('chevron', 16)));
}
