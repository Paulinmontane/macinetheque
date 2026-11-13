// ============================================================================
//  Page « Pour toi » : des films et des séries proposés d'après mes notes.
//  Chaque suggestion dit pourquoi elle est là, et se traite sans quitter la
//  page : « Déjà vu → noter », « À voir » ou « Pas intéressé ».
// ============================================================================
import { h, icon, toast, formatDate, isAbort } from '../utils.js';
import { state, addToWatchlist, dismissSuggestion } from '../store.js';
import { loadSuggestions, rank, loadFilmDetails, saveCache } from '../reco/engine.js';
import { MIN_RATED } from '../reco/profile.js';
import { translateToFrench, looksEnglish } from '../api/translate.js';
import { remember } from '../catalog.js';
import { poster, typeLabel, itemUrl, emptyState, pageHeader } from '../ui/cards.js';
import { openQuickRate } from '../ui/quickrate.js';
import { showSaved, showFailed } from '../ui/confirm.js';

const VISIBLE = 12; // nombre de suggestions affichées en même temps
const filters = { type: 'all', genre: '' }; // gardés tant que l'onglet reste ouvert
const keyOf = (candidate) => `${candidate.source}:${candidate.source_id}`;

/** Les deux premières phrases d'un résumé (assez pour une carte). */
function blurbOf(text, max = 240) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 80 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

export function renderForYou(root) {
  const controller = new AbortController();
  const { signal } = controller;
  let candidates = []; // toutes les œuvres candidates (cache ou recherche)
  let shown = []; // clés des suggestions affichées, dans l'ordre
  let generatedAt = null;
  let seedsKey = ''; // résumé des goûts ayant servi à chercher ces candidats
  let loading = false;
  let cacheTimer = null;

  // ---- la migration V2 n'est pas encore appliquée : on explique quoi faire
  if (!state.v2) {
    root.replaceChildren(
      pageHeader('Pour toi', 'Des idées de films et de séries d’après tes notes.'),
      h('div', { class: 'banner' },
        h('p', {}, h('strong', {}, 'Une dernière étape pour activer les suggestions.')),
        h('p', {}, 'Dans Supabase, ouvre « SQL Editor », colle le contenu du fichier ', h('code', {}, 'supabase/migration_v2.sql'), ' puis clique sur « Run ». Recharge ensuite cette page. Tes notes ne sont pas touchées.')));
    return () => {};
  }

  const list = h('div', { class: 'recos' });
  const note = h('p', { class: 'reco-note', 'aria-live': 'polite' });
  const cold = h('div', { class: 'banner', hidden: true });
  const genreSelect = h('select', { class: 'select', 'aria-label': 'Genre' });
  const refresh = h('button', { class: 'btn btn--small reco-bar__refresh', type: 'button' }, icon('refresh', 16), 'Rafraîchir');
  const typeButtons = [['all', 'Tout'], ['film', 'Films'], ['serie', 'Séries']].map(([value, label]) =>
    h('button', { class: 'segmented__btn', type: 'button', 'aria-pressed': String(filters.type === value), onClick: (event) => {
      filters.type = value;
      typeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button === event.currentTarget)));
      redraw();
    } }, label));
  genreSelect.addEventListener('change', () => { filters.genre = genreSelect.value; redraw(); });
  refresh.addEventListener('click', () => load(true));

  root.replaceChildren(
    pageHeader('Pour toi', 'Des idées de films et de séries d’après tes notes.'),
    h('div', { class: 'reco-bar' },
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Type d’œuvre' }, typeButtons),
      genreSelect, refresh),
    cold, note, list);

  // ------------------------------------------------------------------ affichage
  const setNote = (text, busy = false) => note.replaceChildren(...(busy ? [h('span', { class: 'spinner' })] : []), text);

  function ranked() { return rank(candidates, filters); }

  /** Met à jour la liste des genres et le bandeau « note au moins 3 œuvres ». */
  function syncChrome({ profile, genres }) {
    if (filters.genre && !genres.includes(filters.genre)) filters.genre = '';
    genreSelect.replaceChildren(h('option', { value: '' }, 'Tous les genres'), ...genres.map((g) => h('option', { value: g, selected: g === filters.genre }, g)));
    const few = profile.rated < MIN_RATED;
    cold.hidden = !few;
    if (few) {
      const missing = MIN_RATED - profile.rated;
      cold.replaceChildren(
        h('p', {}, h('strong', {}, `Note encore ${missing} œuvre${missing > 1 ? 's' : ''} pour des suggestions vraiment personnalisées.`)),
        h('p', {}, 'En attendant, voici des films et des séries très populaires. Plus tu notes, plus les idées te ressembleront.'));
    }
  }

  /** Redessine toute la liste (au chargement, ou quand un filtre change). */
  function redraw() {
    const result = ranked();
    syncChrome(result);
    const top = result.list.slice(0, VISIBLE);
    shown = top.map((entry) => keyOf(entry.candidate));
    if (!top.length) {
      list.replaceChildren(...(loading ? skeletons() : [emptyState({
        iconName: 'sparkles',
        title: candidates.length ? 'Plus de suggestion avec ces filtres' : 'Pas de suggestion pour le moment',
        text: candidates.length ? 'Change de filtre, ou rafraîchis pour en chercher d’autres.' : 'Les sources ne répondent peut-être pas. Réessaie dans un instant.',
        action: h('button', { class: 'btn', type: 'button', onClick: () => load(true) }, 'Rafraîchir'),
      })]));
      return;
    }
    list.replaceChildren(...top.map((entry) => card(entry)));
  }

  function skeletons() {
    return Array.from({ length: 4 }, () => h('div', { class: 'reco', 'aria-hidden': 'true' },
      h('div', { class: 'reco__poster' }, h('div', { class: 'poster skeleton' })),
      h('div', { class: 'reco__body' },
        h('div', { class: 'skeleton skeleton--line skeleton--short' }), h('div', { class: 'skeleton skeleton--line' }),
        h('div', { class: 'skeleton skeleton--line' }), h('div', { class: 'skeleton skeleton--line skeleton--short' }))));
  }

  /** Une suggestion : affiche, titre, raison, résumé, trois actions. */
  function card({ candidate, reason }) {
    remember(candidate); // la fiche s'ouvrira instantanément si on clique dessus
    const posterBox = h('a', { class: 'reco__poster', href: itemUrl(candidate), tabindex: '-1', 'aria-hidden': 'true' }, poster(candidate));
    const summary = h('p', { class: 'reco__summary' });
    const why = h('p', { class: 'reco__why' },
      ...(reason.liked ? ['Parce que tu as aimé ', h('em', {}, reason.liked), ` (${reason.text})`] : [reason.text]));

    const seen = h('button', { class: 'btn btn--small btn--primary', type: 'button' }, icon('check', 16), 'Déjà vu → noter');
    const later = h('button', { class: 'btn btn--small', type: 'button' }, icon('bookmark', 16), 'À voir');
    const skip = h('button', { class: 'btn btn--small btn--ghost', type: 'button' }, 'Pas intéressé');
    const node = h('article', { class: 'reco', dataset: { key: keyOf(candidate) } },
      posterBox,
      h('div', { class: 'reco__body' },
        h('div', { class: 'reco__meta' },
          h('span', { class: `badge badge--${candidate.type}` }, typeLabel(candidate)),
          h('span', {}, [candidate.year, (candidate.countries || [])[0], (candidate.genres || []).slice(0, 2).join(', ')].filter(Boolean).join(' · '))),
        h('h2', { class: 'reco__title' }, h('a', { href: itemUrl(candidate) }, candidate.title)),
        why,
        summary),
      h('div', { class: 'reco__actions' }, seen, later, skip));

    // -- résumé et affiche : complétés quand la carte arrive à l'écran
    const paintSummary = () => { summary.textContent = candidate.blurb_fr || blurbOf(candidate.summary_fr) || blurbOf(candidate.summary_original) || ''; };
    paintSummary();
    let attempts = 0;
    whenVisible(node, async function fill() {
      try {
        if (candidate.type === 'film' && !candidate.detailed) {
          if (await loadFilmDetails(candidate, signal)) {
            posterBox.replaceChildren(poster(candidate));
            scheduleCacheSave();
          } else if ((attempts += 1) < 3 && node.isConnected) {
            // Wikipédia n'a pas répondu : nouvel essai un peu plus tard
            setTimeout(() => { if (node.isConnected && !signal.aborted) fill(); }, 7000 * attempts);
          }
        }
        // résumé en anglais : on traduit seulement le début (service gratuit limité)
        const english = !candidate.summary_fr && !candidate.blurb_fr && candidate.summary_original;
        if (english && looksEnglish(english)) {
          candidate.blurb_fr = await translateToFrench(blurbOf(english), signal);
          scheduleCacheSave();
        }
        paintSummary();
      } catch (error) { if (!isAbort(error)) paintSummary(); /* traduction indisponible : texte d'origine */ }
    });

    // -- actions
    const busy = (value) => { [seen, later, skip].forEach((button) => { button.disabled = value; }); };
    // ce qui sera enregistré : les champs du site (pas le résumé raccourci de la carte)
    const asItem = () => ({ ...candidate, credits_at: null });

    seen.addEventListener('click', () => openQuickRate(asItem(), { onSaved: () => replace(node) }));
    const addLater = async () => {
      busy(true);
      try {
        await addToWatchlist(asItem());
        showSaved({ label: 'Ajouté à ta liste à voir', title: candidate.title, short: true });
        replace(node);
      } catch (error) { busy(false); showFailed({ onRetry: addLater }); }
    };
    const dismiss = async () => {
      busy(true);
      try {
        await dismissSuggestion(candidate);
        showSaved({ label: 'Compris, pas pour toi', title: candidate.title, short: true });
        replace(node);
      } catch (error) { busy(false); showFailed({ onRetry: dismiss }); }
    };
    later.addEventListener('click', addLater);
    skip.addEventListener('click', dismiss);
    return node;
  }

  /** Fait disparaître une carte en douceur, puis la remplace par la suggestion suivante. */
  function replace(node) {
    const key = node.dataset.key;
    node.classList.add('is-leaving');
    setTimeout(() => {
      // le profil vient de changer (nouvelle note, ajout, refus) : on reclasse ce qui reste
      const result = ranked();
      syncChrome(result);
      shown = shown.filter((k) => k !== key);
      const next = result.list.find((entry) => !shown.includes(keyOf(entry.candidate)));
      if (next) {
        const fresh = card(next);
        fresh.classList.add('is-entering');
        node.replaceWith(fresh);
        shown.push(keyOf(next.candidate));
        requestAnimationFrame(() => requestAnimationFrame(() => fresh.classList.remove('is-entering')));
      } else {
        node.remove();
        if (!list.children.length) redraw();
      }
    }, 330);
  }

  // ------------------------------------------------------------------ chargement différé
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      jobs.get(entry.target)?.();
    }
  }, { rootMargin: '200px' });
  const jobs = new WeakMap();
  function whenVisible(node, job) { jobs.set(node, job); observer.observe(node); }

  /** Les affiches et résumés récupérés rejoignent le cache (une écriture groupée). */
  function scheduleCacheSave() {
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(() => { cacheTimer = null; if (candidates.length && seedsKey) saveCache(seedsKey, candidates); }, 4000);
  }

  // ------------------------------------------------------------------ chargement
  async function load(force = false) {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    refresh.classList.add('is-loading');
    if (force) candidates = [];
    redraw();
    try {
      const result = await loadSuggestions({
        force, signal,
        onStep: (text) => setNote(text, true),
        onUpdate: (partial) => { candidates = partial.candidates; redraw(); },
      });
      candidates = result.candidates;
      generatedAt = result.generatedAt;
      seedsKey = result.seedsKey;
      loading = false;
      redraw();
      const day = formatDate(generatedAt.slice(0, 10));
      setNote(result.failures && !result.fromCache
        ? `Suggestions du ${day} — une source n’a pas répondu, la liste est peut-être incomplète.`
        : `Suggestions du ${day}. Elles se renouvellent chaque jour, et dès que tes goûts changent.`);
    } catch (error) {
      loading = false;
      if (isAbort(error)) return;
      console.error(error);
      setNote('');
      list.replaceChildren(emptyState({
        iconName: 'sparkles',
        title: 'Suggestions indisponibles',
        text: 'Les sources de films et de séries ne répondent pas pour le moment. Réessaie dans un instant.',
        action: h('button', { class: 'btn', type: 'button', onClick: () => load(true) }, 'Réessayer'),
      }));
      toast('Impossible de charger les suggestions pour le moment.', 'error');
    } finally {
      refresh.disabled = false;
      refresh.classList.remove('is-loading');
    }
  }
  load(false);

  // Nettoyage quand on quitte la page.
  return () => {
    controller.abort();
    observer.disconnect();
    if (cacheTimer) { clearTimeout(cacheTimer); if (candidates.length && seedsKey) saveCache(seedsKey, candidates); }
  };
}
