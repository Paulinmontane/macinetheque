// ============================================================================
//  Fenêtre de notation rapide (« Déjà vu → noter ») : étoiles, commentaire et
//  date de visionnage, sans quitter la page. Pour une série, on choisit ce
//  qu'on note : la série entière, une saison ou un épisode.
// ============================================================================
import { h, icon, isAbort } from '../utils.js';
import { saveRating } from '../store.js';
import { getShow } from '../api/tvmaze.js';
import { starInput } from './stars.js';
import { datePicker } from './datepicker.js';
import { showSaved, showFailed, levelLabel } from './confirm.js';
import { typeLabel } from './cards.js';

/**
 * Ouvre la fenêtre pour `item` (une œuvre au format du site).
 * `onSaved()` est appelée une fois la note enregistrée.
 */
export function openQuickRate(item, { onSaved = () => {} } = {}) {
  const controller = new AbortController();
  let rating = null;
  let level = 'serie'; // 'serie' | 'saison' | 'episode'
  let seasons = null; // saisons de la série (chargées à l'ouverture)

  const stars = starInput({ value: null, label: `Note de ${item.title}`, size: 'lg', onChange: (n) => { rating = n; } });
  const date = datePicker(); // pré-rempli avec la date du jour
  const comment = h('textarea', { class: 'input input--area', rows: 3, maxlength: 5000, placeholder: 'Ton avis (facultatif)', 'aria-label': 'Commentaire' });
  const save = h('button', { class: 'btn btn--primary', type: 'button' }, 'Enregistrer');
  const cancel = h('button', { class: 'btn', type: 'button' }, 'Annuler');
  const close = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer' }, icon('close', 18));

  // ---- série : choix du niveau à noter
  const seasonSelect = h('select', { class: 'select', 'aria-label': 'Saison', hidden: true });
  const episodeSelect = h('select', { class: 'select', 'aria-label': 'Épisode', hidden: true });
  const levelNote = h('p', { class: 'muted', hidden: true });
  const levelButtons = [['serie', 'La série'], ['saison', 'Une saison'], ['episode', 'Un épisode']].map(([value, label]) =>
    h('button', { class: 'segmented__btn', type: 'button', 'aria-pressed': String(value === 'serie'), dataset: { level: value }, onClick: () => setLevel(value) }, label));

  function fillEpisodes() {
    const season = seasons?.find((s) => String(s.number) === seasonSelect.value);
    episodeSelect.replaceChildren(...(season?.episodes || []).map((ep) => h('option', { value: ep.number }, `Épisode ${ep.number} — ${ep.title}`)));
  }
  function setLevel(next) {
    level = next;
    levelButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.level === level)));
    const needsSeasons = level !== 'serie';
    seasonSelect.hidden = !needsSeasons || !seasons?.length;
    episodeSelect.hidden = level !== 'episode' || !seasons?.length;
    levelNote.hidden = !needsSeasons || !!seasons?.length;
    levelNote.textContent = seasons === null ? 'Chargement des saisons…' : 'Les saisons ne peuvent pas être chargées pour le moment : note la série entière, ou réessaie plus tard.';
    save.disabled = needsSeasons && !seasons?.length;
  }
  seasonSelect.addEventListener('change', fillEpisodes);

  if (item.type === 'serie') {
    getShow(item.source_id, controller.signal).then((show) => {
      seasons = show.seasons || [];
      seasonSelect.replaceChildren(...seasons.map((s) => h('option', { value: s.number }, `Saison ${s.number}`)));
      fillEpisodes();
      setLevel(level);
    }).catch((error) => { if (!isAbort(error)) { seasons = []; setLevel(level); } });
  }

  // ---- enregistrement
  async function submit() {
    let target = {};
    let runtime;
    if (item.type === 'serie' && level !== 'serie') {
      const season = seasons.find((s) => String(s.number) === seasonSelect.value);
      target = { season: season.number };
      if (level === 'episode') {
        const episode = season.episodes.find((ep) => String(ep.number) === episodeSelect.value);
        target.episode = episode.number;
        runtime = episode.runtime ?? undefined;
      }
    }
    save.disabled = true;
    try {
      await saveRating(item, target, {
        rating, comment: comment.value.trim() || null, watched_on: date.getValue(),
        ...(runtime !== undefined ? { runtime } : {}),
      });
      shut();
      showSaved({
        label: rating ? 'Note enregistrée' : 'Marqué comme vu', title: item.title,
        detail: levelLabel(target.season ?? null, target.episode ?? null), rating, short: !rating,
      });
      onSaved();
    } catch (error) {
      console.error(error);
      save.disabled = false;
      // la fenêtre reste ouverte : rien de ce qui a été saisi n'est perdu
      showFailed({ message: /futur/.test(error.message) ? error.message : '', onRetry: submit });
    }
  }

  const panel = h('div', { class: 'modal__panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Noter ${item.title}` },
    h('div', { class: 'modal__head' },
      h('div', {},
        h('h2', { class: 'modal__title' }, item.title),
        h('p', { class: 'modal__sub' }, [typeLabel(item), item.year].filter(Boolean).join(' · '))),
      close),
    item.type === 'serie' && h('div', { class: 'modal__levels' },
      h('span', { class: 'field__label' }, 'Je note'),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Ce que je note' }, levelButtons),
      h('div', { class: 'modal__selects' }, seasonSelect, episodeSelect),
      levelNote),
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Ma note (facultative)'), h('div', { class: 'modal__stars' }, stars)),
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Vu le'), date),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Commentaire'), comment),
    h('div', { class: 'modal__foot' }, cancel, save));
  const modal = h('div', { class: 'modal' }, panel);

  function shut() {
    controller.abort();
    document.removeEventListener('keydown', onKey);
    modal.classList.remove('is-visible');
    setTimeout(() => modal.remove(), 220);
  }
  // Échap ferme la fenêtre, sauf si l'écran de confirmation est par-dessus.
  const onKey = (event) => { if (event.key === 'Escape' && !document.querySelector('.confirm')) shut(); };
  document.addEventListener('keydown', onKey);
  modal.addEventListener('click', (event) => { if (event.target === modal) shut(); });
  cancel.addEventListener('click', shut);
  close.addEventListener('click', shut);
  save.addEventListener('click', submit);

  document.body.append(modal);
  requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('is-visible')));
  panel.tabIndex = -1;
  panel.focus({ preventScroll: true }); // (pas sur une étoile : elle paraîtrait déjà choisie)
  return { close: shut };
}
