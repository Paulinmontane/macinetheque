// ============================================================================
//  Fiche d'une œuvre : affiche, infos, résumé en français, notation.
//   - Film  : une note (étoiles + commentaire + date de visionnage).
//   - Série : note globale, puis saisons dépliables ; chaque saison et chaque
//             épisode a sa note, son commentaire et sa date.
// ============================================================================
import { h, icon, toast, formatDate, formatDuration, todayISO, isAbort } from '../utils.js';
import { loadItem, recall, enrichFromWikidata } from '../catalog.js';
import {
  findItem, getRating, saveRating, deleteRating, markSeasonSeen,
  addToWatchlist, removeFromWatchlist, isInWatchlist, updateItem,
} from '../store.js';
import { translateToFrench, cachedTranslations, looksEnglish } from '../api/translate.js';
import { starInput, starDisplay } from '../ui/stars.js';
import { poster, typeLabel, emptyState } from '../ui/cards.js';

export function renderItem(root, { source, id, focusRating = false }) {
  const controller = new AbortController();
  const { signal } = controller;
  const translator = createTranslator(signal);

  const page = h('article', { class: 'item' });
  root.replaceChildren(page);

  // 1) Affichage immédiat de ce qu'on connaît déjà (suggestion cliquée, ou
  //    copie de la collection), sinon un squelette de chargement.
  const known = recall(source, id) || findItem(source, id);
  if (known?.title) draw(known, { loading: true });
  else page.replaceChildren(backLink(), skeleton());

  // 2) Chargement de la fiche complète auprès de la source.
  loadItem(source, id, signal).then(async (item) => {
    if (signal.aborted) return;
    draw(item, { loading: false });
    refreshSavedCopy(item);
    // 3) Film iTunes : le pays de production vient de Wikidata.
    const patch = await enrichFromWikidata(item, signal);
    if (patch && !signal.aborted) {
      Object.assign(item, patch);
      const saved = findItem(source, id);
      if (saved) updateItem(saved.id, patch).catch(() => {});
      draw(item, { loading: false });
    }
  }).catch((error) => {
    if (isAbort(error) || signal.aborted) return;
    console.error(error);
    page.replaceChildren(backLink(), emptyState({
      iconName: 'search',
      title: 'Fiche indisponible',
      text: 'La source de données ne répond pas pour le moment. Vérifie ta connexion ou réessaie dans un instant.',
      action: h('button', { class: 'btn', type: 'button', onClick: () => renderItem(root, { source, id }) }, 'Réessayer'),
    }));
  });

  /**
   * Si l'œuvre est déjà dans la collection, on complète sa copie enregistrée
   * avec ce que la source vient de fournir et qui manquait (affiche, résumé,
   * durée, pays…), par exemple après une panne passagère le jour de l'ajout.
   */
  function refreshSavedCopy(item) {
    const saved = findItem(source, id);
    if (!saved || item.offline) return;
    const patch = {};
    for (const field of ['poster_url', 'summary_fr', 'summary_original', 'runtime', 'year']) {
      if (!saved[field] && item[field]) patch[field] = item[field];
    }
    for (const field of ['countries', 'genres']) {
      if (!saved[field]?.length && item[field]?.length) patch[field] = item[field];
    }
    if (Object.keys(patch).length) updateItem(saved.id, patch).catch(() => {});
  }

  // ------------------------------------------------------------------ dessin
  function draw(item, { loading }) {
    const facts = [
      item.year,
      item.countries?.length ? item.countries.join(', ') : null,
      item.runtime ? `${formatDuration(item.runtime)}${item.type === 'serie' ? ' par épisode' : ''}` : null,
    ].filter(Boolean);

    const ratingPanel = h('section', { class: 'panel', id: 'ma-note' },
      h('h2', { class: 'panel__title' }, item.type === 'serie' ? 'Ma note sur la série' : 'Ma note'),
      ratingEditor({ item, label: `Note de ${item.title}` }));

    page.replaceChildren(
      backLink(),
      h('div', { class: 'item__top' },
        h('div', { class: 'item__poster' }, poster(item, { size: 'full', lazy: false })),
        h('div', { class: 'item__info' },
          h('span', { class: `badge badge--${item.type}` }, typeLabel(item)),
          h('h1', { class: 'item__title' }, item.title),
          facts.length ? h('p', { class: 'item__facts' }, facts.join(' · ')) : null,
          item.genres?.length ? h('ul', { class: 'chips' }, item.genres.map((g) => h('li', { class: 'chip' }, g))) : null,
          h('div', { class: 'item__actions' }, watchlistButton(item)),
          h('section', { class: 'item__summary' },
            h('h2', { class: 'sr-only' }, 'Résumé'),
            mainSummary(item, loading)))),
      ratingPanel,
      ...(item.type === 'serie' ? [seasonsSection(item, loading)] : []),
    );

    if (focusRating) {
      focusRating = false;
      requestAnimationFrame(() => {
        ratingPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        ratingPanel.classList.add('is-highlight');
        ratingPanel.querySelector('.star')?.focus({ preventScroll: true });
      });
    }
  }

  // ------------------------------------------------------------------ résumé principal
  function mainSummary(item, loading) {
    if (item.summary_fr) return summaryBlock({ french: item.summary_fr, original: item.summary_original });
    if (item.summary_original) {
      if (!looksEnglish(item.summary_original)) return summaryBlock({ french: item.summary_original });
      const block = summaryBlock({ original: item.summary_original, pending: true });
      translateToFrench(item.summary_original, signal).then((french) => {
        if (signal.aborted) return;
        item.summary_fr = french;
        block.setFrench(french);
        const saved = findItem(item.source, item.source_id);
        if (saved && !saved.summary_fr) updateItem(saved.id, { summary_fr: french }).catch(() => {});
      }).catch((error) => { if (!isAbort(error)) { block.setFailed(); translator.warn(error); } });
      return block;
    }
    if (loading) return h('div', {}, h('div', { class: 'skeleton skeleton--line' }), h('div', { class: 'skeleton skeleton--line' }), h('div', { class: 'skeleton skeleton--line skeleton--short' }));
    return h('p', { class: 'muted' }, item.partial
      ? 'Le résumé n’a pas pu être chargé pour le moment (Wikipédia ne répond pas). Il apparaîtra à une prochaine visite.'
      : 'Aucun résumé disponible pour cette œuvre.');
  }

  // ------------------------------------------------------------------ liste à voir
  function watchlistButton(item) {
    const button = h('button', { class: 'btn', type: 'button' });
    const sync = () => {
      const saved = findItem(item.source, item.source_id);
      const inList = isInWatchlist(saved?.id);
      button.replaceChildren(icon(inList ? 'check' : 'plus', 18), inList ? 'Dans ma liste à voir · Retirer' : 'Ajouter à ma liste à voir');
      button.classList.toggle('btn--active', inList);
      button.setAttribute('aria-pressed', String(inList));
    };
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const saved = findItem(item.source, item.source_id);
        if (isInWatchlist(saved?.id)) { await removeFromWatchlist(saved.id); toast('Retiré de ta liste à voir'); } else { await addToWatchlist(item); toast('Ajouté à ta liste à voir'); }
      } catch (error) { toast(`Impossible d’enregistrer : ${error.message}`, 'error'); }
      button.disabled = false;
      sync();
    });
    page.addEventListener('mc:rated', sync); // noter l'œuvre la retire de la liste
    sync();
    return button;
  }

  // ------------------------------------------------------------------ saisons
  function seasonsSection(item, loading) {
    const section = h('section', { class: 'seasons' }, h('h2', { class: 'section-title' }, 'Saisons et épisodes'));
    if (!item.seasons) {
      section.append(loading
        ? h('div', {}, [1, 2, 3].map(() => h('div', { class: 'season season--skeleton skeleton' })))
        : h('p', { class: 'muted' }, 'Les saisons ne peuvent pas être chargées pour le moment (la source TVMaze ne répond pas). Tes notes sont bien conservées ; réessaie un peu plus tard.'));
      return section;
    }
    if (!item.seasons.length) { section.append(h('p', { class: 'muted' }, 'Aucun épisode connu pour cette série.')); return section; }
    section.append(...item.seasons.map((season) => seasonBlock(item, season)));
    return section;
  }

  function seasonBlock(item, season) {
    const body = h('div', { class: 'season__body', hidden: true });
    const progress = h('span', { class: 'season__progress' });
    const mine = h('span', { class: 'season__mine' });
    const head = h('button', { class: 'season__head', type: 'button', 'aria-expanded': 'false' },
      icon('chevron', 18),
      h('span', { class: 'season__name' }, `Saison ${season.number}`),
      h('span', { class: 'season__meta' }, [`${season.episodes.length} épisode${season.episodes.length > 1 ? 's' : ''}`, season.year].filter(Boolean).join(' · ')),
      mine, progress);

    const syncHead = () => {
      const saved = findItem(item.source, item.source_id);
      const seen = saved ? season.episodes.filter((ep) => getRating(saved.id, season.number, ep.number)).length : 0;
      progress.textContent = seen ? `${seen}/${season.episodes.length} vu${seen > 1 ? 's' : ''}` : '';
      progress.classList.toggle('is-complete', seen === season.episodes.length);
      const rating = saved ? getRating(saved.id, season.number)?.rating : null;
      mine.replaceChildren(rating ? starDisplay(rating) : '');
    };

    const fill = () => {
      const markAll = h('button', { class: 'btn btn--small', type: 'button' }, icon('check', 16), 'Marquer toute la saison comme vue');
      markAll.addEventListener('click', async () => {
        markAll.disabled = true;
        try {
          const { added } = await markSeasonSeen(item, season.number, season.episodes);
          toast(added ? `${added} épisode${added > 1 ? 's' : ''} marqué${added > 1 ? 's' : ''} comme vu${added > 1 ? 's' : ''}` : 'Tous les épisodes étaient déjà marqués comme vus');
          fill();
          syncHead();
        } catch (error) { toast(`Impossible d’enregistrer : ${error.message}`, 'error'); markAll.disabled = false; }
      });

      const toTranslate = []; // [bloc de résumé, texte anglais]
      body.replaceChildren(
        h('div', { class: 'season__rate' },
          h('h3', { class: 'season__label' }, `Ma note sur la saison ${season.number}`),
          ratingEditor({ item, season: season.number, label: `Note de la saison ${season.number}`, onChange: syncHead })),
        h('div', { class: 'season__tools' }, markAll),
        h('ol', { class: 'episodes' }, season.episodes.map((ep) => episodeRow(item, season, ep, syncHead, toTranslate))));
      // On lit d'abord, en une seule requête, les traductions déjà en cache ;
      // le reste sera traduit au fur et à mesure du défilement.
      translator.watchAll(toTranslate);
    };

    head.addEventListener('click', () => {
      const opening = body.hidden;
      if (opening && !body.children.length) fill(); // les épisodes ne sont créés qu'à l'ouverture
      body.hidden = !opening;
      head.setAttribute('aria-expanded', String(opening));
    });
    syncHead();
    return h('section', { class: 'season' }, head, body);
  }

  function episodeRow(item, season, ep, onChange, toTranslate) {
    const details = h('div', { class: 'episode__details', hidden: true });
    const editor = ratingEditor({
      item, season: season.number, episode: ep.number, runtime: ep.runtime, compact: true,
      label: `Note de l’épisode ${ep.number}`, onChange,
    });
    const toggle = h('button', { class: 'icon-btn', type: 'button', 'aria-expanded': 'false', 'aria-label': 'Commentaire et date de visionnage', title: 'Commentaire et date' }, icon('comment', 18));
    toggle.addEventListener('click', () => {
      details.hidden = !details.hidden;
      toggle.setAttribute('aria-expanded', String(!details.hidden));
      if (!details.hidden && !details.children.length) details.append(editor.fields);
    });
    const meta = [ep.airdate ? formatDate(ep.airdate) : null, ep.runtime ? formatDuration(ep.runtime) : null].filter(Boolean).join(' · ');
    let summary = null;
    if (ep.summary) {
      if (looksEnglish(ep.summary)) {
        summary = summaryBlock({ original: ep.summary, pending: true, small: true });
        toTranslate.push([summary, ep.summary]);
      } else summary = summaryBlock({ french: ep.summary, small: true });
    }
    return h('li', { class: 'episode' },
      editor.seenToggle,
      h('div', { class: 'episode__main' },
        h('div', { class: 'episode__head' },
          h('span', { class: 'episode__num' }, `É${ep.number}`),
          h('span', { class: 'episode__title' }, ep.title)),
        meta && h('p', { class: 'episode__meta' }, meta),
        summary,
        details),
      h('div', { class: 'episode__side' }, editor.stars, toggle));
  }

  // ------------------------------------------------------------------ éditeur de note
  /**
   * Étoiles + date de visionnage + commentaire + suppression, pour l'œuvre
   * (season/episode vides), une saison ou un épisode. Tout est enregistré
   * automatiquement dès qu'on modifie quelque chose.
   */
  function ratingEditor({ item, season = null, episode = null, runtime = null, label, compact = false, onChange }) {
    const current = () => {
      const saved = findItem(item.source, item.source_id);
      return saved ? getRating(saved.id, season, episode) : null;
    };
    const status = h('span', { class: 'rating__status', 'aria-live': 'polite' });
    let statusTimer;
    const setStatus = (text, sticky = false) => {
      status.textContent = text;
      clearTimeout(statusTimer);
      if (text && !sticky) statusTimer = setTimeout(() => { status.textContent = ''; }, 2200);
    };

    async function save(patch) {
      setStatus('Enregistrement…', true);
      try {
        const extra = runtime != null ? { runtime } : {};
        const result = await saveRating(item, { season, episode }, { ...extra, ...patch });
        setStatus('Enregistré ✓');
        if (result.removedFromWatchlist) toast('Noté ! Retiré de ta liste à voir.');
        sync();
        onChange?.();
        page.dispatchEvent(new CustomEvent('mc:rated'));
      } catch (error) {
        setStatus('');
        toast(`Impossible d’enregistrer : ${error.message}`, 'error');
        sync();
      }
    }

    async function remove() {
      const row = current();
      if (!row) return;
      const what = episode != null ? 'cet épisode' : season != null ? 'cette saison' : item.type === 'serie' ? 'cette série' : 'ce film';
      if ((row.rating || row.comment) && !window.confirm(`Supprimer ta note et ton commentaire sur ${what} ?`)) return;
      try {
        const saved = findItem(item.source, item.source_id);
        await deleteRating(saved.id, season, episode);
        setStatus('Supprimé');
        sync();
        onChange?.();
      } catch (error) { toast(`Suppression impossible : ${error.message}`, 'error'); }
    }

    const stars = starInput({ value: current()?.rating ?? null, label, size: compact ? 'sm' : 'lg', onChange: (n) => save({ rating: n }) });
    const value = h('span', { class: 'rating__value' });
    const date = h('input', { class: 'input input--date', type: 'date', max: todayISO(), 'aria-label': 'Date de visionnage' });
    date.addEventListener('change', () => save({ watched_on: date.value || null }));
    const comment = h('textarea', { class: 'input input--area', rows: compact ? 2 : 3, maxlength: 5000, placeholder: 'Ton avis, ce que tu as aimé ou non…', 'aria-label': 'Commentaire' });
    let typingTimer;
    const saveComment = () => {
      clearTimeout(typingTimer);
      if ((comment.value.trim() || null) !== (current()?.comment ?? null)) save({ comment: comment.value });
    };
    comment.addEventListener('blur', saveComment);
    comment.addEventListener('input', () => { clearTimeout(typingTimer); typingTimer = setTimeout(saveComment, 1500); });

    const removeBtn = h('button', { class: 'link link--danger', type: 'button', onClick: remove }, icon('trash', 15), compact ? 'Supprimer' : 'Supprimer ma note');
    const seenBtn = h('button', { class: 'btn btn--small', type: 'button', onClick: () => save({}) }, icon('check', 16), 'Marquer comme vu');
    // Pastille « vu » des épisodes : un clic marque / démarque.
    const seenToggle = h('button', { class: 'seen', type: 'button', onClick: () => (current() ? remove() : save({})) }, icon('check', 16));

    const fields = h('div', { class: 'rating__fields' },
      h('label', { class: 'field field--inline' }, h('span', { class: 'field__label' }, 'Vu le'), date),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Commentaire'), comment),
      h('div', { class: 'rating__actions' }, removeBtn, compact ? status : null));

    function sync() {
      const row = current();
      stars.setValue(row?.rating ?? null);
      value.textContent = row?.rating ? `${row.rating}/5` : row ? 'Vu, pas encore noté' : 'Pas encore noté';
      if (document.activeElement !== date) date.value = row?.watched_on || '';
      if (document.activeElement !== comment) comment.value = row?.comment || '';
      removeBtn.hidden = !row;
      seenBtn.hidden = !!row;
      seenToggle.classList.toggle('is-seen', !!row);
      seenToggle.setAttribute('aria-pressed', String(!!row));
      seenToggle.setAttribute('aria-label', row ? 'Vu — cliquer pour retirer' : 'Marquer comme vu');
      seenToggle.title = row ? `Vu${row.watched_on ? ` le ${formatDate(row.watched_on)}` : ''}` : 'Marquer comme vu';
    }
    sync();

    if (compact) return { stars, fields, seenToggle };
    return h('div', { class: 'rating' },
      h('div', { class: 'rating__row' }, stars, value, status),
      fields,
      h('div', { class: 'rating__more' }, seenBtn));
  }

  function backLink() {
    return h('button', { class: 'back', type: 'button', onClick: () => (history.length > 1 ? history.back() : (location.hash = '#/')) },
      icon('back', 18), 'Retour');
  }

  // Nettoyage quand on quitte la page : on annule les requêtes en cours.
  return () => { controller.abort(); translator.stop(); };
}

// ============================================================================
//  Bloc de résumé : texte français + petit lien « voir l'original ».
// ============================================================================
function summaryBlock({ french = null, original = null, pending = false, small = false }) {
  const text = h('p', { class: 'summary__text' });
  const note = h('span', { class: 'summary__note' });
  const toggle = h('button', { class: 'link link--small', type: 'button', hidden: true });
  const block = h('div', { class: `summary${small ? ' summary--small' : ''}` }, text, h('div', { class: 'summary__foot' }, note, toggle));
  let showingOriginal = false;

  const paint = () => {
    const hasBoth = french && original && french !== original;
    text.textContent = (showingOriginal || !french) ? original : french;
    text.lang = (showingOriginal || !french) && original ? 'en' : 'fr';
    toggle.hidden = !hasBoth;
    toggle.textContent = showingOriginal ? 'voir la traduction' : 'voir l’original';
    block.classList.toggle('is-pending', pending && !french);
    note.textContent = pending && !french ? 'Traduction en cours…' : '';
  };
  toggle.addEventListener('click', () => { showingOriginal = !showingOriginal; paint(); });

  block.setFrench = (value) => { french = value; pending = false; paint(); };
  block.setFailed = () => { pending = false; paint(); note.textContent = 'Traduction indisponible pour le moment (texte original).'; };
  paint();
  return block;
}

// ============================================================================
//  File d'attente de traduction des résumés d'épisodes.
//  Un résumé n'est traduit que lorsqu'il devient visible à l'écran, et un
//  seul à la fois, pour ménager le service gratuit.
// ============================================================================
function createTranslator(signal) {
  const queue = [];
  const jobs = new WeakMap(); // bloc de résumé → texte original
  let running = false;
  let warned = false;

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      queue.push(entry.target);
      run();
    }
  }, { rootMargin: '150px' });

  function warn(error) {
    if (warned) return;
    warned = true;
    toast(error?.reason === 'quota'
      ? 'Quota gratuit de traduction atteint pour aujourd’hui : les résumés restent en anglais.'
      : 'Le service de traduction ne répond pas : les résumés restent en anglais pour l’instant.', 'error');
  }

  async function run() {
    if (running) return;
    running = true;
    while (queue.length && !signal.aborted) {
      const block = queue.shift();
      try {
        block.setFrench(await translateToFrench(jobs.get(block), signal));
      } catch (error) {
        if (isAbort(error)) break;
        block.setFailed();
        warn(error);
      }
    }
    running = false;
  }

  return {
    warn,
    /**
     * Reçoit des paires [bloc de résumé, texte anglais]. Les traductions déjà
     * en cache sont affichées tout de suite (une seule requête, aucun appel au
     * traducteur) ; les autres seront traduites quand elles deviendront visibles.
     */
    async watchAll(pairs) {
      let cached = new Map();
      try { cached = await cachedTranslations(pairs.map(([, text]) => text)); } catch { /* cache facultatif */ }
      if (signal.aborted) return;
      for (const [block, text] of pairs) {
        if (cached.has(text)) block.setFrench(cached.get(text));
        else { jobs.set(block, text); observer.observe(block); }
      }
    },
    stop() { observer.disconnect(); queue.length = 0; },
  };
}

function skeleton() {
  return h('div', { class: 'item__top', 'aria-hidden': 'true' },
    h('div', { class: 'item__poster' }, h('div', { class: 'poster skeleton' })),
    h('div', { class: 'item__info' },
      h('div', { class: 'skeleton skeleton--title' }),
      h('div', { class: 'skeleton skeleton--line skeleton--short' }),
      h('div', { class: 'skeleton skeleton--line' }),
      h('div', { class: 'skeleton skeleton--line' }),
      h('div', { class: 'skeleton skeleton--line skeleton--short' })));
}
