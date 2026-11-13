// ============================================================================
//  Lecture d'un récap en plein écran, façon « stories » : un écran à la fois,
//  barres de progression en haut, on avance en touchant à droite (ou en
//  glissant vers la gauche), on revient en touchant à gauche. Clavier :
//  ← → pour naviguer, Échap pour fermer.
//  Les écrans sans données sont sautés. Animations sobres (fondus, chiffres
//  qui défilent jusqu'à leur valeur), simple fondu si « moins d'animations ».
// ============================================================================
import { h, icon, formatNumber, formatTime, formatDate, toast } from '../utils.js';
import { logo } from '../ui/logo.js';
import { starDisplay } from '../ui/stars.js';
import { avatar } from '../views/stats.js';
import { recapTitle, recapName } from './service.js';
import { shareRecap } from './share.js';
import { periodLabel } from '../stats/core.js';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const plural = (n, one, many) => `${n > 1 ? many : one}`;

/** Chiffre qui défile de 0 jusqu'à sa valeur (format : fonction d'affichage). */
function counter(value, format = (v) => formatNumber(Math.round(v))) {
  const node = h('span', { class: 'count', dataset: { value: String(value) } }, format(value));
  node.format = format;
  return node;
}
function animateCounters(screen) {
  for (const node of screen.querySelectorAll('.count')) {
    const target = Number(node.dataset.value);
    if (reduced() || !target) { node.textContent = node.format(target); continue; }
    const start = performance.now();
    const duration = 1000;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      node.textContent = node.format(target * (1 - (1 - t) ** 3)); // ralentit en arrivant
      if (t < 1 && node.isConnected) requestAnimationFrame(tick);
      else node.textContent = node.format(target);
    };
    node.textContent = node.format(0);
    requestAnimationFrame(tick);
  }
}

/** Une grande affiche (ou un cadre vide sobre si l'œuvre n'en a pas). */
function bigPoster(work) {
  const box = h('div', { class: 'story__poster' });
  if (work?.poster) {
    const img = h('img', { src: work.poster, alt: `Affiche de ${work.title}` });
    img.addEventListener('error', () => { img.remove(); box.classList.add('is-empty'); box.textContent = work.title; });
    box.append(img);
  } else { box.classList.add('is-empty'); box.textContent = work?.title || ''; }
  return box;
}

const stars = (rating) => (rating ? h('div', { class: 'story__stars' }, starDisplay(Math.round(rating), 'lg')) : null);
const kicker = (text) => h('p', { class: 'story__kicker' }, text);

/** Tous les écrans du récap, dans l'ordre, sans ceux qui n'ont pas de données. */
export function buildScreens(r) {
  const screens = [];
  const add = (name, ...content) => screens.push(h('section', { class: `story__screen story__screen--${name}`, dataset: { screen: name } }, ...content));
  const period = r.kind === 'year' ? 'cette année' : 'ce mois-ci';

  // 1. intro
  add('intro', h('div', { class: 'story__logo' }, logo(72)),
    h('h2', { class: 'story__title' }, recapTitle(r)),
    r.provisional ? h('p', { class: 'story__badge' }, 'Récap en cours · définitif le 1er janvier') : null,
    h('p', { class: 'story__sub' }, 'Touche à droite pour avancer, à gauche pour revenir.'));

  // 2. temps total
  const days = r.minutes / 1440;
  const compare = days >= 1 ? `soit ${formatNumber(Math.floor(days))} ${plural(Math.floor(days), 'jour entier', 'jours entiers')} devant l’écran`
    : r.minutes >= 110 ? `soit l’équivalent de ${formatNumber(Math.floor(r.minutes / 110))} ${plural(Math.floor(r.minutes / 110), 'film', 'films')} d’1 h 50`
      : 'un bon début !';
  const previousName = r.kind === 'year' ? String(Number(r.key) - 1) : periodLabel({ kind: 'month', key: shiftMonth(r.key) }).replace(/ \d{4}$/, '');
  add('time', kicker(`Tu as regardé ${period}`),
    h('p', { class: 'story__big' }, counter(r.minutes, (v) => formatTime(v))),
    h('p', { class: 'story__sub' }, compare),
    r.evolution != null ? h('p', { class: `story__trend ${r.evolution >= 0 ? 'is-up' : 'is-down'}` }, `${r.evolution >= 0 ? '+' : '−'}${Math.abs(r.evolution)} % par rapport à ${previousName}`)
      : h('p', { class: 'story__trend' }, `Rien de vu ${r.kind === 'year' ? `en ${previousName}` : `en ${previousName}`} : c’est un nouveau départ.`),
    r.estimated ? h('p', { class: 'story__note' }, 'Certaines durées sont estimées.') : null);

  // 3. compteurs
  add('counts', kicker(`${r.kind === 'year' ? 'Ton année' : 'Ton mois'} en chiffres`),
    h('div', { class: 'story__counts' },
      [[r.films, 'film vu', 'films vus'], [r.series, 'série regardée', 'séries regardées'], [r.seasons, 'saison terminée', 'saisons terminées'], [r.episodes, 'épisode vu', 'épisodes vus']]
        .map(([value, one, many]) => h('div', { class: 'story__count' }, h('span', { class: 'story__count-value' }, counter(value)), h('span', { class: 'story__count-label' }, plural(value, one, many))))));

  // 4. film préféré
  if (r.favoriteFilm) {
    add('film', kicker('Ton film préféré'), bigPoster(r.favoriteFilm),
      h('h3', { class: 'story__name' }, r.favoriteFilm.title), stars(r.favoriteFilm.rating),
      r.favoriteFilm.comment ? h('blockquote', { class: 'story__quote' }, `« ${r.favoriteFilm.comment} »`) : null);
  }
  // 5. série préférée + meilleur épisode
  if (r.favoriteSeries || r.bestEpisode) {
    add('series', kicker(r.favoriteSeries ? 'Ta série préférée' : 'Ton épisode le mieux noté'),
      r.favoriteSeries ? [bigPoster(r.favoriteSeries), h('h3', { class: 'story__name' }, r.favoriteSeries.title), stars(r.favoriteSeries.rating)] : null,
      r.bestEpisode ? h('div', { class: 'story__episode' },
        h('span', { class: 'story__episode-label' }, r.favoriteSeries ? 'Épisode le mieux noté' : ''),
        h('strong', {}, `${r.bestEpisode.title} · S${String(r.bestEpisode.season).padStart(2, '0')}E${String(r.bestEpisode.episode).padStart(2, '0')}`),
        starDisplay(r.bestEpisode.rating)) : null);
  }
  // 6. la série où j'ai passé le plus de temps
  if (r.mostTimeSeries) {
    add('marathon', kicker('Ta série marathon'), bigPoster(r.mostTimeSeries),
      h('h3', { class: 'story__name' }, r.mostTimeSeries.title),
      h('p', { class: 'story__big story__big--sm' }, counter(r.mostTimeSeries.minutes, (v) => formatTime(v))),
      h('p', { class: 'story__sub' }, `${formatNumber(r.mostTimeSeries.episodes)} ${plural(r.mostTimeSeries.episodes, 'épisode', 'épisodes')} ${period}`));
  }
  // 7. acteur du mois / de l'année
  if (r.actor) {
    add('actor', kicker(r.kind === 'year' ? 'Ton acteur de l’année' : 'Ton acteur du mois'), avatar(r.actor, 'xxl'),
      h('h3', { class: 'story__name' }, r.actor.name),
      h('p', { class: 'story__sub' }, `${formatTime(r.actor.minutes)} · ${formatNumber(r.actor.works)} ${plural(r.actor.works, 'œuvre', 'œuvres')}`));
  }
  // 8. genres et pays
  if (r.genres.length || r.countries.length) {
    const list = (title, items) => (items.length ? h('div', { class: 'story__rank' }, h('h3', {}, title),
      h('ol', {}, items.slice(0, 3).map((g, i) => h('li', {}, h('span', { class: 'story__rank-n' }, String(i + 1)), h('span', {}, g.label), h('span', { class: 'story__rank-v' }, `${g.value} ${plural(g.value, 'œuvre', 'œuvres')}`))))) : null);
    add('tastes', kicker('Tes goûts'), list('Genres', r.genres), list('Pays', r.countries));
  }
  // 9. notes
  if (r.average != null) {
    const max = Math.max(...r.distribution, 1);
    add('notes', kicker('Ta note moyenne'),
      h('p', { class: 'story__big' }, counter(r.average, (v) => `${formatNumber(v, 1)} ★`)),
      h('div', { class: 'story__dist', role: 'img', 'aria-label': `Répartition : ${r.distribution.map((n, i) => `${n} × ${i + 1} étoile${i ? 's' : ''}`).join(', ')}` },
        r.distribution.map((n, i) => h('div', { class: 'story__dist-col' },
          h('span', { class: 'story__dist-n' }, String(n)),
          h('span', { class: 'story__dist-bar', style: { height: `${Math.max(4, (n / max) * 100)}%`, '--i': i } }),
          h('span', { class: 'story__dist-label' }, `${i + 1}★`)))));
  }
  // 10. jour record (+ mois record pour l'année)
  if (r.recordDay?.minutes) {
    add('record', kicker('Ton jour record'),
      h('p', { class: 'story__big story__big--sm' }, formatDate(r.recordDay.date)),
      h('p', { class: 'story__sub' }, `${formatTime(r.recordDay.minutes)} devant l’écran`),
      r.recordMonth ? [h('p', { class: 'story__kicker story__kicker--gap' }, 'Ton mois record'),
        h('p', { class: 'story__big story__big--sm' }, recapName({ kind: 'month', key: r.recordMonth.key })),
        h('p', { class: 'story__sub' }, formatTime(r.recordMonth.minutes))] : null);
  }
  // 11. top 5 de l'année
  if (r.kind === 'year' && (r.top5Films.length || r.top5Series.length)) {
    const top = (title, list) => (list.length ? h('div', { class: 'story__top' }, h('h3', {}, title),
      h('ol', {}, list.map((w, i) => h('li', {}, h('span', { class: 'story__rank-n' }, String(i + 1)),
        w.poster ? h('img', { src: w.poster, alt: '', class: 'story__thumb' }) : h('span', { class: 'story__thumb' }),
        h('span', { class: 'story__top-title' }, w.title), h('span', { class: 'story__rank-v' }, `★ ${formatNumber(w.rating, Number.isInteger(w.rating) ? 0 : 1)}`))))) : null);
    add('top', kicker('Ton top de l’année'), top('Films', r.top5Films), top('Séries', r.top5Series));
  }
  // 12. carte finale + partage
  const share = h('button', { class: 'btn btn--primary story__share', type: 'button' }, icon('share', 18), 'Partager');
  share.addEventListener('click', async (event) => {
    event.stopPropagation();
    share.disabled = true;
    try {
      const how = await shareRecap(r);
      if (how === 'downloaded') toast('Image enregistrée dans tes téléchargements');
    } catch (error) { console.error(error); toast('Impossible de créer l’image pour le moment.', 'error'); }
    share.disabled = false;
  });
  add('summary', kicker(recapName(r)),
    h('div', { class: 'story__card' },
      h('div', { class: 'story__card-head' }, logo(28), h('strong', {}, 'MaCinéthèque')),
      h('p', { class: 'story__card-time' }, formatTime(r.minutes)),
      h('div', { class: 'story__card-grid' },
        [[r.films, 'film', 'films'], [r.series, 'série', 'séries'], [r.seasons, 'saison', 'saisons'], [r.episodes, 'épisode', 'épisodes']].map(([v, one, many]) => h('div', {}, h('strong', {}, formatNumber(v)), h('span', {}, plural(v, one, many))))),
      r.favoriteFilm ? h('p', { class: 'story__card-line' }, `Film préféré : ${r.favoriteFilm.title}`) : null,
      r.favoriteSeries ? h('p', { class: 'story__card-line' }, `Série préférée : ${r.favoriteSeries.title}`) : null,
      r.average != null ? h('p', { class: 'story__card-line' }, `Note moyenne : ${formatNumber(r.average, 1)} ★`) : null),
    share);
  return screens;
}

function shiftMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

/** Ouvre le récap en plein écran. `onClose` est appelée à la fermeture. */
export function openStory(recap, { onClose = () => {} } = {}) {
  const screens = buildScreens(recap);
  let index = 0;
  const bars = h('div', { class: 'story__bars' }, screens.map(() => h('span', { class: 'story__bar' }, h('span', { class: 'story__bar-fill' }))));
  const close = h('button', { class: 'story__close', type: 'button', 'aria-label': 'Fermer le récap' }, icon('close', 22));
  const stage = h('div', { class: 'story__stage' });
  const story = h('div', { class: 'story', role: 'dialog', 'aria-modal': 'true', 'aria-label': recapTitle(recap), tabindex: '-1' }, bars, close, stage);

  function show(next, direction = 1) {
    index = Math.max(0, Math.min(screens.length - 1, next));
    const screen = screens[index];
    screen.classList.remove('is-in');
    screen.style.setProperty('--from', direction >= 0 ? '24px' : '-24px');
    stage.replaceChildren(screen);
    requestAnimationFrame(() => requestAnimationFrame(() => screen.classList.add('is-in')));
    [...bars.children].forEach((bar, i) => { bar.classList.toggle('is-done', i < index); bar.classList.toggle('is-current', i === index); });
    story.dataset.screen = screen.dataset.screen;
    story.dataset.index = String(index);
    animateCounters(screen);
  }

  function shut() {
    document.removeEventListener('keydown', onKey);
    story.classList.remove('is-visible');
    setTimeout(() => story.remove(), 260);
    onClose();
  }
  const onKey = (event) => {
    if (event.key === 'Escape') shut();
    else if (event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); show(index + 1, 1); } else if (event.key === 'ArrowLeft') show(index - 1, -1);
  };

  // toucher : à gauche on revient, ailleurs on avance ; glisser fonctionne aussi
  let start = null;
  stage.addEventListener('pointerdown', (event) => { start = { x: event.clientX, y: event.clientY, t: Date.now() }; });
  stage.addEventListener('pointerup', (event) => {
    if (!start || event.target.closest('button, a')) { start = null; return; }
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { show(index + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1); return; }
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      const rect = stage.getBoundingClientRect();
      if (event.clientX - rect.left < rect.width * 0.3) show(index - 1, -1); else show(index + 1, 1);
    }
  });
  close.addEventListener('click', shut);
  document.addEventListener('keydown', onKey);
  document.body.append(story);
  show(0);
  requestAnimationFrame(() => requestAnimationFrame(() => story.classList.add('is-visible')));
  story.focus({ preventScroll: true });
  return { close: shut, show, count: screens.length };
}
