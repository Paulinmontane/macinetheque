// ============================================================================
//  Page « Récaps » : tous mes récaps mensuels et annuels, du plus récent au
//  plus ancien. Un récap s'ouvre en plein écran (js/recap/story.js).
// ============================================================================
import { h, icon, formatNumber, formatTime, isAbort } from '../utils.js';
import { state, readRecap } from '../store.js';
import { emptyState, pageHeader } from '../ui/cards.js';
import { ensureStatsData } from '../stats/complete.js';
import { listRecaps, getRecap, recapName, markRecapSeen } from '../recap/service.js';
import { openStory } from '../recap/story.js';

export function renderRecaps(root, { open = null } = {}) {
  const controller = new AbortController();
  if (!state.v3) {
    root.replaceChildren(pageHeader('Récaps'), h('div', { class: 'banner' },
      h('p', {}, h('strong', {}, 'Une dernière étape pour activer les récaps.')),
      h('p', {}, 'Dans Supabase, ouvre « SQL Editor », colle le contenu du fichier ', h('code', {}, 'supabase/migration_v3.sql'), ' puis clique sur « Run ». Recharge ensuite cette page.')));
    return () => {};
  }
  const recaps = listRecaps();
  if (!recaps.length) {
    root.replaceChildren(pageHeader('Récaps'), emptyState({
      iconName: 'replay', title: 'Pas encore de récap',
      text: 'Le récap d’un mois arrive le 1er du mois suivant ; celui de l’année, à partir du 1er décembre. Note ce que tu regardes, avec la date : tes premiers récaps arriveront vite.',
    }));
    return () => {};
  }

  const note = h('p', { class: 'reco-note', 'aria-live': 'polite' });
  const grid = h('div', { class: 'recaps' });
  root.replaceChildren(pageHeader('Récaps', 'Tes mois et tes années de films et de séries.'), note, grid);
  let cast = new Map();
  const loaded = new Map(); // « kind:clé » → données

  function card(recap) {
    const key = `${recap.kind}:${recap.key}`;
    const data = loaded.get(key);
    const star = data?.favoriteFilm || data?.favoriteSeries || data?.mostTimeSeries;
    const thumb = h('span', { class: 'recap-card__poster' });
    if (star?.poster) thumb.append(h('img', { src: star.poster, alt: '', loading: 'lazy' }));
    return h('button', { class: `recap-card recap-card--${recap.kind}`, type: 'button', dataset: { recap: key }, onClick: () => play(recap) },
      thumb,
      h('span', { class: 'recap-card__text' },
        h('span', { class: 'recap-card__kind' }, recap.kind === 'year' ? 'Récap de l’année' : 'Récap du mois'),
        h('span', { class: 'recap-card__name' }, recapName(recap)),
        h('span', { class: 'recap-card__meta' }, data ? `${formatTime(data.minutes)} · ${formatNumber(data.films)} film${data.films > 1 ? 's' : ''} · ${formatNumber(data.episodes)} épisode${data.episodes > 1 ? 's' : ''}` : ' ')),
      recap.provisional ? h('span', { class: 'recap-card__badge' }, 'en cours') : !recap.seen ? h('span', { class: 'recap-card__badge recap-card__badge--new' }, 'Nouveau') : null,
      icon('chevron', 18));
  }
  const paint = () => grid.replaceChildren(...listRecaps().map(card));

  async function play(recap) {
    const key = `${recap.kind}:${recap.key}`;
    let data = loaded.get(key);
    if (!data) {
      note.replaceChildren(h('span', { class: 'spinner' }), 'Préparation du récap…');
      data = await getRecap(recap, cast, { fetchCached: readRecap }).catch((error) => { console.error(error); return null; });
      note.replaceChildren();
      if (!data) return;
      loaded.set(key, data);
    }
    openStory({ ...data, provisional: recap.provisional }, { onClose: paint });
    if (!recap.seen) markRecapSeen(recap.kind, recap.key).catch(() => {});
  }

  paint();
  // durées et acteurs à jour, puis données de chaque récap (relues du cache si rien n'a changé)
  (async () => {
    try {
      cast = await ensureStatsData(controller.signal, (text) => note.replaceChildren(h('span', { class: 'spinner' }), text));
      note.replaceChildren();
      for (const recap of recaps) {
        if (controller.signal.aborted) return;
        const data = await getRecap(recap, cast, { fetchCached: readRecap });
        if (data) loaded.set(`${recap.kind}:${recap.key}`, data);
        paint();
      }
      if (open && !controller.signal.aborted) {
        const target = recaps.find((r) => `${r.kind}:${r.key}` === open);
        if (target) play(target);
      }
    } catch (error) {
      if (!isAbort(error)) { console.error(error); note.textContent = 'Les récaps ne peuvent pas être préparés pour le moment.'; }
    }
  })();
  return () => controller.abort();
}
