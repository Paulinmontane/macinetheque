// ============================================================================
//  Statistiques : temps de visionnage, compteurs, notes, genres, pays et
//  acteurs — pour la période choisie (jour, mois, année ou depuis toujours).
//  Tous les calculs viennent du module commun js/stats/core.js.
// ============================================================================
import { h, icon, formatNumber, formatTime, formatDuration, todayISO, initials, isAbort } from '../utils.js';
import { state, collection } from '../store.js';
import { emptyState, pageHeader, poster, itemUrl } from '../ui/cards.js';
import { barChart, rankList } from '../ui/charts.js';
import { starDisplay } from '../ui/stars.js';
import {
  buildViewings, periodStats, actorStats, shiftPeriod, periodLabel, workKey, DEFAULT_FILM_MINUTES, DEFAULT_EPISODE_MINUTES,
} from '../stats/core.js';
import { ensureStatsData } from '../stats/complete.js';

// Réglages gardés tant que l'onglet reste ouvert
const view = { period: { kind: 'all', key: '' }, actors: 'all', notes: 'works' };
const MONTHS_SHORT = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
const plural = (n, word, words = `${word}s`) => `${formatNumber(n)} ${n > 1 ? words : word}`;

/** Période « actuelle » d'un type : aujourd'hui, ce mois-ci, cette année. */
function currentPeriod(kind, today = todayISO()) {
  if (kind === 'day') return { kind, key: today };
  if (kind === 'month') return { kind, key: today.slice(0, 7) };
  if (kind === 'year') return { kind, key: today.slice(0, 4) };
  return { kind: 'all', key: '' };
}

export function renderStats(root) {
  const controller = new AbortController();
  if (!collection().length) {
    root.replaceChildren(pageHeader('Statistiques'), emptyState({
      iconName: 'chart', title: 'Pas encore de statistiques',
      text: 'Note quelques films ou épisodes : tes chiffres et tes graphiques apparaîtront ici.',
    }));
    return () => {};
  }

  let cast = new Map(); // distribution des œuvres (chargée en arrière-plan)
  const progress = h('p', { class: 'reco-note stats-progress', 'aria-live': 'polite' });
  const body = h('div', { class: 'stats-body' });
  root.replaceChildren(pageHeader('Statistiques'), progress, body);

  function draw() {
    if (!body.isConnected) return;
    const today = todayISO();
    const data = buildViewings(state.items, state.ratings);
    const s = periodStats(data, state.ratings, state.items, view.period, today);
    body.replaceChildren(
      periodBar(data, today),
      timeSection(s),
      countersSection(s),
      notesSection(s),
      h('div', { class: 'stats-grid' },
        rankPanel('Genres préférés', 'Œuvres vues sur la période · note moyenne', s.genres),
        rankPanel('Pays les plus regardés', 'Pays de production · note moyenne', s.countries)),
      actorsSection(data),
    );
  }

  // ------------------------------------------------------------------ période
  function periodBar(data, today) {
    const p = view.period;
    const kinds = [['day', 'Jour'], ['month', 'Mois'], ['year', 'Année'], ['all', 'Depuis toujours']].map(([kind, label]) =>
      h('button', { class: 'segmented__btn', type: 'button', 'aria-pressed': String(p.kind === kind), onClick: () => { view.period = currentPeriod(kind, today); draw(); } }, label));
    const bar = h('div', { class: 'period' }, h('div', { class: 'segmented period__kinds', role: 'group', 'aria-label': 'Période' }, kinds));
    if (p.kind === 'all') return bar;

    const dates = data.viewings.map((v) => v.date).filter(Boolean).sort();
    const first = dates[0] || today;
    const atEnd = shiftPeriod(p, 1).key > currentPeriod(p.kind, today).key;
    const atStart = shiftPeriod(p, -1).key < currentPeriod(p.kind, first).key;
    const go = (step) => { view.period = shiftPeriod(view.period, step); draw(); };
    const prev = h('button', { class: 'icon-btn icon-btn--border', type: 'button', 'aria-label': 'Période précédente', disabled: atStart, onClick: () => go(-1) }, icon('chevron-left', 18));
    const next = h('button', { class: 'icon-btn icon-btn--border', type: 'button', 'aria-label': 'Période suivante', disabled: atEnd, onClick: () => go(1) }, icon('chevron', 18));

    // saut direct à une date : calendrier natif (jour) ou listes (mois, année) — rien à taper
    let jump;
    if (p.kind === 'day') {
      const native = h('input', { class: 'chipbtn__native', type: 'date', value: p.key, min: first, max: today, 'aria-label': 'Choisir un jour' });
      native.addEventListener('change', () => { if (native.value && native.value <= today) { view.period = { kind: 'day', key: native.value }; draw(); } });
      jump = h('span', { class: 'chipbtn__wrap period__jump' }, h('button', { class: 'chipbtn chipbtn--date', type: 'button', tabindex: '-1' }, icon('calendar', 15), periodLabel(p)), native);
      native.addEventListener('click', () => { try { native.showPicker(); } catch { /* calendrier déjà ouvert */ } });
    } else {
      const options = [];
      if (p.kind === 'month') {
        for (let key = currentPeriod('month', today).key; key >= first.slice(0, 7); key = shiftPeriod({ kind: 'month', key }, -1).key) options.push([key, periodLabel({ kind: 'month', key })]);
      } else {
        for (let y = Number(today.slice(0, 4)); y >= Number(first.slice(0, 4)); y -= 1) options.push([String(y), String(y)]);
      }
      if (!options.some(([key]) => key === p.key)) options.push([p.key, periodLabel(p)]);
      jump = h('select', { class: 'select period__select', 'aria-label': p.kind === 'month' ? 'Choisir un mois' : 'Choisir une année' },
        options.map(([key, label]) => h('option', { value: key, selected: key === p.key }, label)));
      jump.addEventListener('change', () => { view.period = { kind: p.kind, key: jump.value }; draw(); });
    }
    bar.append(h('div', { class: 'period__nav' }, prev, jump, next));
    return bar;
  }

  // ------------------------------------------------------------------ temps de visionnage
  function timeSection(s) {
    const p = view.period;
    const share = s.minutes ? Math.round((s.filmMinutes / s.minutes) * 100) : 0;
    const head = h('div', { class: 'time__head' },
      h('div', {},
        h('p', { class: 'time__label' }, `Temps de visionnage · ${periodLabel(p)}`),
        h('p', { class: 'time__total' }, s.minutes ? formatTime(s.minutes) : '0 min'),
        s.estimatedMinutes > 0 && h('p', { class: 'time__estimate', title: `Durée inconnue : ${DEFAULT_FILM_MINUTES} min par film, ${DEFAULT_EPISODE_MINUTES} min par épisode` }, `dont ${formatTime(s.estimatedMinutes)} en durée estimée`)),
      s.perDay != null ? h('p', { class: 'time__avg' }, h('strong', {}, formatTime(s.perDay)), ' par jour en moyenne')
        : s.perMonth != null ? h('p', { class: 'time__avg' }, h('strong', {}, formatTime(s.perMonth)), ' par mois en moyenne') : null);
    const split = s.minutes ? h('div', { class: 'split' },
      h('div', { class: 'split__bar', role: 'img', 'aria-label': `Films ${share} %, séries ${100 - share} %` },
        h('span', { class: 'split__films', style: { width: `${share}%` } }),
        h('span', { class: 'split__series', style: { width: `${100 - share}%` } })),
      h('div', { class: 'split__legend' },
        h('span', {}, h('i', { class: 'dot dot--films' }), `Films ${formatTime(s.filmMinutes)} · ${share} %`),
        h('span', {}, h('i', { class: 'dot dot--series' }), `Séries ${formatTime(s.seriesMinutes)} · ${100 - share} %`))) : null;

    let chart;
    if (p.kind === 'day') {
      chart = s.viewings.length
        ? h('ul', { class: 'daylist' }, s.viewings.map((v) => h('li', {},
          h('a', { class: 'daylist__item', href: itemUrl(v.item) },
            h('span', { class: 'daylist__poster' }, poster(v.item)),
            h('span', { class: 'daylist__text' },
              h('span', { class: 'daylist__title' }, v.item.title),
              h('span', { class: 'daylist__meta' }, [v.kind === 'episode' ? `S${String(v.season).padStart(2, '0')}E${String(v.episode).padStart(2, '0')}${v.viaSeason ? ' (saison vue)' : ''}` : 'Film', `${formatDuration(v.minutes)}${v.estimated ? ' (estimée)' : ''}`].join(' · '))),
            v.rating ? starDisplay(v.rating) : null))))
        : h('p', { class: 'muted panel__empty' }, 'Rien de vu ce jour-là.');
    } else if (s.buckets.length) {
      const label = (key) => (p.kind === 'month' ? String(Number(key.slice(8, 10))) : p.kind === 'year' ? MONTHS_SHORT[Number(key.slice(5, 7)) - 1] : key);
      const name = (key) => (p.kind === 'month' ? periodLabel({ kind: 'day', key }) : p.kind === 'year' ? periodLabel({ kind: 'month', key }) : key);
      chart = barChart({
        data: s.buckets.map((b) => ({ label: label(b.key), name: name(b.key), value: b.minutes / 60 })),
        caption: `Temps de visionnage par ${p.kind === 'month' ? 'jour' : p.kind === 'year' ? 'mois' : 'année'} (en heures)`,
        unit: (hours) => formatTime(hours * 60),
      });
    } else {
      chart = h('p', { class: 'muted panel__empty' }, 'Aucune date de visionnage connue.');
    }
    return h('section', { class: 'panel time' }, head, split, chart);
  }

  // ------------------------------------------------------------------ compteurs
  function countersSection(s) {
    const tile = (value, label, sub = '') => h('div', { class: 'tile' },
      h('span', { class: 'tile__value' }, value), h('span', { class: 'tile__label' }, label), sub && h('span', { class: 'tile__sub' }, sub));
    return h('div', { class: 'tiles' },
      tile(formatNumber(s.films), s.films > 1 ? 'Films vus' : 'Film vu'),
      tile(formatNumber(s.series), s.series > 1 ? 'Séries regardées' : 'Série regardée'),
      tile(formatNumber(s.seasons), s.seasons > 1 ? 'Saisons terminées' : 'Saison terminée'),
      tile(formatNumber(s.episodes), s.episodes > 1 ? 'Épisodes vus' : 'Épisode vu'),
      tile(s.average != null ? formatNumber(s.average, 1) : '—', 'Note moyenne', s.average != null ? `sur 5 · ${plural(s.rated, 'note')}` : 'aucune note sur la période'));
  }

  // ------------------------------------------------------------------ notes
  function notesSection(s) {
    const counts = view.notes === 'episodes' ? s.distributionEpisodes : s.distributionWorks;
    const word = view.notes === 'episodes' ? 'épisode' : 'note';
    const buttons = [['works', 'Films, séries, saisons'], ['episodes', 'Épisodes']].map(([value, label]) =>
      h('button', { class: 'segmented__btn', type: 'button', 'aria-pressed': String(view.notes === value), onClick: () => { view.notes = value; draw(); } }, label));
    return h('section', { class: 'panel' },
      h('div', { class: 'panel__head' },
        h('h2', { class: 'panel__title' }, 'Répartition des notes'),
        h('div', { class: 'segmented segmented--small', role: 'group', 'aria-label': 'Notes à afficher' }, buttons)),
      counts.some(Boolean)
        ? barChart({ data: counts.map((value, i) => ({ label: `${i + 1} ★`, name: `${i + 1} étoile${i ? 's' : ''}`, value })), caption: 'Répartition des notes', unit: (n) => plural(n, word), showValues: true })
        : h('p', { class: 'muted panel__empty' }, 'Aucune note sur la période.'));
  }

  function rankPanel(title, sub, list) {
    return h('section', { class: 'panel' }, h('h2', { class: 'panel__title' }, title), h('p', { class: 'panel__sub' }, sub),
      list.length
        ? rankList({ data: list.slice(0, 8).map((d) => ({ label: d.label, value: d.value, note: d.average != null ? `★ ${formatNumber(d.average, 1)}` : '' })), caption: title, unit: (n) => plural(n, 'œuvre') })
        : h('p', { class: 'muted panel__empty' }, 'Rien sur la période.'));
  }

  // ------------------------------------------------------------------ acteurs
  function actorsSection(data) {
    const filters = [['film', 'Films'], ['serie', 'Séries'], ['all', 'Les deux']].map(([value, label]) =>
      h('button', { class: 'segmented__btn', type: 'button', 'aria-pressed': String(view.actors === value), onClick: () => { view.actors = value; draw(); } }, label));
    const section = h('section', { class: 'panel actors' },
      h('div', { class: 'panel__head' },
        h('h2', { class: 'panel__title' }, 'Acteurs'),
        h('div', { class: 'segmented segmented--small', role: 'group', 'aria-label': 'Acteurs de' }, filters)));
    if (!state.v3) {
      section.append(h('p', { class: 'muted panel__empty' }, 'Colle le fichier supabase/migration_v3.sql dans Supabase pour activer les statistiques sur les acteurs.'));
      return section;
    }
    const a = actorStats(data, state.ratings, state.items, cast, view.period, view.actors);
    if (!cast.size) {
      section.append(h('p', { class: 'muted panel__empty' }, h('span', { class: 'spinner' }), ' Recherche des acteurs de tes films et séries…'));
      return section;
    }
    const block = (title, list, figure, empty) => h('div', { class: 'actors__block' },
      h('h3', { class: 'actors__title' }, title),
      list.length ? [
        h('button', { class: 'actor-hero', type: 'button', onClick: () => openActor(list[0], data) },
          avatar(list[0], 'lg'), h('span', { class: 'actor-hero__name' }, list[0].name), h('span', { class: 'actor-hero__figure' }, figure(list[0]))),
        h('ol', { class: 'actor-list', start: 2 }, list.slice(1, 10).map((p, i) => h('li', {},
          h('button', { class: 'actor-row', type: 'button', onClick: () => openActor(p, data) },
            h('span', { class: 'actor-row__rank' }, String(i + 2)), avatar(p, 'sm'),
            h('span', { class: 'actor-row__name' }, p.name), h('span', { class: 'actor-row__figure' }, figure(p)))))),
      ] : h('p', { class: 'muted panel__empty' }, empty));
    section.append(h('div', { class: 'actors__grid' },
      block('Acteur le plus regardé', a.mostWatched, (p) => `${formatTime(p.minutes)} · ${plural(p.works, 'œuvre')}`, 'Pas encore d’acteur sur cette période.'),
      block('Acteur préféré', a.favorite, (p) => `${formatNumber(p.average, 1)}★ de moyenne sur ${plural(p.rated, 'œuvre')}`, 'Il faut au moins 2 œuvres notées avec le même acteur.')));
    return section;
  }

  /** Fiche d'un acteur : photo, œuvres où je l'ai vu, temps total, note moyenne. */
  function openActor(person, data) {
    const all = actorStats(data, state.ratings, state.items, cast, { kind: 'all', key: '' }, 'all', { minWorks: 1 }).mostWatched.find((p) => p.id === person.id) || person;
    const close = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer' }, icon('close', 18));
    const works = all.items.map((id) => state.items.get(id)).filter(Boolean);
    const panel = h('div', { class: 'modal__panel actor-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': person.name },
      h('div', { class: 'modal__head' }, h('span'), close),
      h('div', { class: 'actor-sheet__head' }, avatar(person, 'xl'),
        h('h2', { class: 'modal__title' }, person.name),
        h('p', { class: 'modal__sub' }, [formatTime(all.minutes), plural(works.length, 'œuvre vue', 'œuvres vues'), all.average != null ? `${formatNumber(all.average, 1)}★ de moyenne` : null].filter(Boolean).join(' · '))),
      h('div', { class: 'actor-sheet__works' }, works.map((item) => {
        const note = collection().find((e) => e.item.id === item.id)?.rating;
        return h('a', { class: 'actor-sheet__work', href: itemUrl(item), onClick: () => shut() },
          poster(item), h('span', { class: 'actor-sheet__title' }, item.title),
          note != null ? h('span', { class: 'actor-sheet__note' }, `★ ${formatNumber(note, Number.isInteger(note) ? 0 : 1)}`) : null);
      })));
    const modal = h('div', { class: 'modal' }, panel);
    const shut = () => { modal.classList.remove('is-visible'); document.removeEventListener('keydown', onKey); setTimeout(() => modal.remove(), 220); };
    const onKey = (event) => { if (event.key === 'Escape') shut(); };
    close.addEventListener('click', shut);
    modal.addEventListener('click', (event) => { if (event.target === modal) shut(); });
    document.addEventListener('keydown', onKey);
    document.body.append(modal);
    requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('is-visible')));
    panel.tabIndex = -1; panel.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ chargement
  draw();
  ensureStatsData(controller.signal, (text) => { progress.replaceChildren(h('span', { class: 'spinner' }), text); })
    .then((found) => { cast = found; progress.replaceChildren(); draw(); })
    .catch((error) => { if (!isAbort(error)) { progress.replaceChildren(); console.warn(error); } });
  return () => controller.abort();
}

/** Photo ronde d'un acteur, ou ses initiales s'il n'y en a pas. */
export function avatar(person, size = 'sm') {
  const box = h('span', { class: `avatar avatar--${size}`, 'aria-hidden': 'true' }, h('span', { class: 'avatar__initials' }, initials(person.name)));
  if (person.photo) {
    const img = h('img', { src: person.photo, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('load', () => box.classList.add('has-photo'));
    img.addEventListener('error', () => img.remove());
    box.append(img);
  }
  return box;
}

/** (garde la compatibilité avec la V2 : utilisé ailleurs pour la clé d'une œuvre) */
export { workKey };
