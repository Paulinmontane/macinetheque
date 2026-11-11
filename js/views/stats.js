// ============================================================================
//  Statistiques : chiffres clés et graphiques, calculés à partir des notes.
// ============================================================================
import { h, formatNumber } from '../utils.js';
import { state, collection } from '../store.js';
import { emptyState, pageHeader } from '../ui/cards.js';
import { barChart, rankList } from '../ui/charts.js';

/** 3 725 minutes → « 2 j 14 h » (ou « 62 h » / « 45 min » selon l'ordre de grandeur). */
function formatTotalTime(minutes) {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${String(Math.round(minutes % 60)).padStart(2, '0')}`;
  return `${Math.floor(hours / 24)} j ${hours % 24} h`;
}

/** Calcule toutes les statistiques (fonction pure, facile à vérifier). */
export function computeStats(entries, ratings, items) {
  const films = entries.filter((e) => e.item.type === 'film' && e.main);
  const series = entries.filter((e) => e.item.type === 'serie');
  const episodeRows = ratings.filter((row) => row.episode != null);

  // Notes données aux œuvres (films + séries) et aux épisodes
  const workRatings = entries.map((e) => e.main?.rating).filter((n) => n != null);
  const episodeRatings = episodeRows.map((row) => row.rating).filter((n) => n != null);
  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  const distribution = (list) => [1, 2, 3, 4, 5].map((n) => list.filter((value) => value === n).length);

  // Temps de visionnage : durée des films vus + durée de chaque épisode vu
  const filmMinutes = films.reduce((sum, e) => sum + (e.item.runtime || 0), 0);
  const episodeMinutes = episodeRows.reduce((sum, row) => sum + (row.runtime || items.get(row.item_id)?.runtime || 0), 0);

  // Genres et pays : nombre d'œuvres + note moyenne
  const tally = (field) => {
    const map = new Map();
    for (const entry of entries) {
      for (const name of entry.item[field] || []) {
        if (!map.has(name)) map.set(name, { label: name, value: 0, notes: [] });
        const bucket = map.get(name);
        bucket.value += 1;
        if (entry.rating != null) bucket.notes.push(entry.rating);
      }
    }
    return [...map.values()]
      .map((b) => ({ label: b.label, value: b.value, average: mean(b.notes) }))
      .sort((a, b) => b.value - a.value || (b.average || 0) - (a.average || 0) || a.label.localeCompare(b.label, 'fr'));
  };

  // Activité : films et épisodes vus par mois, sur les 12 derniers mois
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, date: d, value: 0 });
  }
  const byMonth = new Map(months.map((m) => [m.key, m]));
  const filmIds = new Set(films.map((e) => e.item.id));
  for (const row of ratings) {
    const isFilm = row.season == null && filmIds.has(row.item_id);
    if (!row.watched_on || !(isFilm || row.episode != null)) continue;
    const bucket = byMonth.get(row.watched_on.slice(0, 7));
    if (bucket) bucket.value += 1;
  }

  return {
    films: films.length,
    series: series.length,
    episodes: episodeRows.length,
    averageWork: mean(workRatings),
    ratedWorks: workRatings.length,
    averageEpisode: mean(episodeRatings),
    ratedEpisodes: episodeRatings.length,
    distributionWorks: distribution(workRatings),
    distributionEpisodes: distribution(episodeRatings),
    minutes: filmMinutes + episodeMinutes,
    filmMinutes,
    episodeMinutes,
    genres: tally('genres'),
    countries: tally('countries'),
    months,
  };
}

export function renderStats(root) {
  const entries = collection();
  if (!entries.length) {
    root.replaceChildren(
      pageHeader('Statistiques'),
      emptyState({
        iconName: 'chart',
        title: 'Pas encore de statistiques',
        text: 'Note quelques films ou épisodes : tes chiffres et tes graphiques apparaîtront ici.',
      }));
    return;
  }
  const s = computeStats(entries, state.ratings, state.items);
  const plural = (n, word) => `${formatNumber(n)} ${word}${n > 1 ? 's' : ''}`;

  const tile = (value, label, sub = '') => h('div', { class: 'tile' },
    h('span', { class: 'tile__value' }, value), h('span', { class: 'tile__label' }, label), sub && h('span', { class: 'tile__sub' }, sub));

  const tiles = h('div', { class: 'tiles' },
    tile(formatNumber(s.films), s.films > 1 ? 'Films vus' : 'Film vu'),
    tile(formatNumber(s.series), s.series > 1 ? 'Séries' : 'Série'),
    tile(formatNumber(s.episodes), s.episodes > 1 ? 'Épisodes vus' : 'Épisode vu'),
    tile(s.averageWork != null ? `${formatNumber(s.averageWork, 1)}` : '—', 'Note moyenne',
      s.averageWork != null ? `sur 5 · ${plural(s.ratedWorks, 'œuvre')}` : 'aucune œuvre notée'),
    tile(s.minutes ? formatTotalTime(s.minutes) : '—', 'Temps de visionnage', s.minutes ? 'estimation' : 'durées inconnues'));

  // ---- Répartition des notes (films et séries, ou épisodes)
  const distributionBody = h('div', {});
  const drawDistribution = (which) => {
    const counts = which === 'episodes' ? s.distributionEpisodes : s.distributionWorks;
    const word = which === 'episodes' ? 'épisode' : 'œuvre';
    const average = which === 'episodes' ? s.averageEpisode : s.averageWork;
    if (!counts.some(Boolean)) {
      distributionBody.replaceChildren(h('p', { class: 'muted panel__empty' }, which === 'episodes' ? 'Aucun épisode noté pour l’instant.' : 'Aucun film ni série noté pour l’instant.'));
      return;
    }
    distributionBody.replaceChildren(
      h('p', { class: 'panel__sub' }, `Moyenne : ${formatNumber(average, 1)} / 5`),
      barChart({
        data: counts.map((value, i) => ({ label: `${i + 1} ★`, name: `${i + 1} étoile${i ? 's' : ''}`, value })),
        caption: `Répartition des notes (${word}s)`,
        unit: (n) => plural(n, word),
        showValues: true,
      }));
  };
  const switchButtons = [['works', 'Films et séries'], ['episodes', 'Épisodes']].map(([value, label], index) =>
    h('button', { class: 'segmented__btn', type: 'button', 'aria-pressed': String(index === 0), onClick: (event) => {
      switchButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === event.currentTarget)));
      drawDistribution(value);
    } }, label));
  drawDistribution('works');

  // ---- Activité par mois
  const monthName = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
  const monthFull = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
  const activity = barChart({
    data: s.months.map((m) => ({ label: monthName.format(m.date).replace('.', ''), name: monthFull.format(m.date), value: m.value })),
    caption: 'Films et épisodes vus par mois, sur les 12 derniers mois',
    unit: (n) => `${formatNumber(n)} visionnage${n > 1 ? 's' : ''}`,
  });

  const rank = (list, caption) => (list.length
    ? rankList({
      data: list.slice(0, 8).map((d) => ({ label: d.label, value: d.value, note: d.average != null ? `★ ${formatNumber(d.average, 1)}` : '' })),
      caption,
      unit: (n) => plural(n, 'œuvre'),
    })
    : h('p', { class: 'muted panel__empty' }, 'Pas encore assez de données.'));

  const panel = (title, sub, ...content) => h('section', { class: 'panel' },
    h('h2', { class: 'panel__title' }, title), sub && h('p', { class: 'panel__sub' }, sub), ...content);

  root.replaceChildren(
    pageHeader('Statistiques'),
    tiles,
    h('div', { class: 'stats-grid' },
      h('section', { class: 'panel' },
        h('div', { class: 'panel__head' },
          h('h2', { class: 'panel__title' }, 'Répartition des notes'),
          h('div', { class: 'segmented segmented--small', role: 'group', 'aria-label': 'Notes à afficher' }, switchButtons)),
        distributionBody),
      panel('Activité par mois', 'Films et épisodes vus sur les 12 derniers mois', activity),
      panel('Genres préférés', 'Nombre d’œuvres dans ta collection · note moyenne', rank(s.genres, 'Genres les plus présents dans la collection')),
      panel('Pays les plus regardés', 'Pays de production · note moyenne', rank(s.countries, 'Pays les plus présents dans la collection'))),
    ...(s.minutes ? [h('p', { class: 'muted stats-foot' },
      `Temps de visionnage estimé : ${formatTotalTime(s.filmMinutes)} de films et ${formatTotalTime(s.episodeMinutes)} d’épisodes (d’après les durées connues).`)] : []));
}
