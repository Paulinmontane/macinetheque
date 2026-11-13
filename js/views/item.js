// ============================================================================
//  Fiche d'une œuvre : affiche, infos, résumé en français, notation.
//   - Film  : une note (étoiles + commentaire + date de visionnage).
//   - Série : on note au niveau qu'on veut, sans aucune obligation — la série
//             entière, une saison entière, quelques épisodes, ou n'importe
//             quelle combinaison. Chaque niveau a SA note, SON commentaire et
//             SA date, tous facultatifs et indépendants : noter une saison ne
//             touche à aucun épisode, et inversement.
//             Quand un niveau n'a pas de note directe, la moyenne des niveaux
//             en dessous est affichée en petit, à titre indicatif seulement.
// ============================================================================
import { h, icon, toast, formatDate, formatDuration, formatNumber, todayISO, isAbort } from '../utils.js';
import { loadItem, recall, enrichFromWikidata } from '../catalog.js';
import {
  findItem, getRating, saveRating, deleteRating, markSeasonSeen,
  addToWatchlist, removeFromWatchlist, isInWatchlist, updateItem,
  seasonAverage, seriesAverage, seasonsMetaOf,
} from '../store.js';
import { datePicker } from '../ui/datepicker.js';
import { showSaved, showFailed, levelLabel } from '../ui/confirm.js';
import { translateToFrench, cachedTranslations, looksEnglish } from '../api/translate.js';
import { starInput, starDisplay } from '../ui/stars.js';
import { poster, typeLabel, emptyState } from '../ui/cards.js';

export function renderItem(root, { source, id, focusRating = false }) {
  const controller = new AbortController();
  const { signal } = controller;
  const translator = createTranslator(signal);

  const page = h('article', { class: 'item' });
  root.replaceChildren(page);
  // Commentaires en cours de frappe : enregistrés si on quitte la fiche sans
  // être sorti du champ (pour ne rien perdre).
  const pendingComments = new Set();
  let drawing = null; // sert à retirer les écouteurs du dessin précédent
  /** Prévient toute la fiche qu'une note a changé (moyennes indicatives, liste à voir…). */
  const notify = () => page.dispatchEvent(new CustomEvent('mc:rated'));
  /** Exécute `fn` à chaque changement de note, tant que ce dessin est affiché. */
  const onRated = (fn) => page.addEventListener('mc:rated', fn, { signal: drawing.signal });

  // Série trouvée via Wikidata sans identifiant TVMaze : on la retrouve sur TVMaze
  // par son identifiant IMDb, puis on bascule sur sa vraie adresse
  // (#/oeuvre/tvmaze/…), pour que notes et liste « à voir » soient bien rangées.
  if (source === 'tvmaze-imdb') {
    page.replaceChildren(backLink(), skeleton());
    loadItem(source, id, signal).then((item) => {
      if (!signal.aborted) location.replace(`#/oeuvre/tvmaze/${encodeURIComponent(item.source_id)}`);
    }).catch((error) => {
      if (isAbort(error) || signal.aborted) return;
      page.replaceChildren(backLink(), emptyState({
        iconName: 'search',
        title: 'Fiche indisponible',
        text: 'Cette série est introuvable sur TVMaze, ou le service ne répond pas pour le moment.',
      }));
    });
    return () => { controller.abort(); translator.stop(); };
  }

  // 1) Affichage immédiat de ce qu'on connaît déjà (suggestion cliquée, ou
  //    copie de la collection), sinon un squelette de chargement.
  const known = recall(source, id) || findItem(source, id);
  // Fiche complète déjà chargée pendant cette visite (retour arrière, par
  // exemple) : on l'affiche telle quelle, sans la recharger — sinon la page
  // se redessinerait une seconde plus tard et refermerait la saison ouverte.
  if (known?.title && known.offline === false && !known.partial) {
    draw(known, { loading: false });
    return () => {
      for (const flush of pendingComments) flush();
      drawing?.abort();
      controller.abort();
      translator.stop();
    };
  }
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
    // série : durée de chaque épisode (temps de visionnage, saisons marquées vues)
    if (item.type === 'serie' && item.seasons?.length && !saved.seasons_meta) {
      patch.seasons_meta = seasonsMetaOf(item.seasons);
      patch.meta_at = new Date().toISOString();
    }
    if (Object.keys(patch).length) updateItem(saved.id, patch).catch(() => {});
  }

  // ------------------------------------------------------------------ dessin
  function draw(item, { loading }) {
    drawing?.abort();
    drawing = new AbortController();
    pendingComments.clear();
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
    onRated(sync); // noter l'œuvre la retire de la liste
    sync();
    return button;
  }

  // ------------------------------------------------------------------ saisons
  function seasonsSection(item, loading) {
    const section = h('section', { class: 'seasons' },
      h('h2', { class: 'section-title' }, 'Saisons et épisodes'),
      h('p', { class: 'muted seasons__help' }, 'Note ce que tu veux : une saison entière, quelques épisodes, ou rien du tout. Chaque note est indépendante.'));
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

    // En-tête : ma note de la saison ; à défaut, la moyenne indicative de ses
    // épisodes notés, en petit et en gris.
    const syncHead = () => {
      const saved = findItem(item.source, item.source_id);
      const seen = saved ? season.episodes.filter((ep) => getRating(saved.id, season.number, ep.number)).length : 0;
      progress.textContent = seen ? `${seen}/${season.episodes.length} vu${seen > 1 ? 's' : ''}` : '';
      progress.classList.toggle('is-complete', seen === season.episodes.length);
      const rating = saved ? getRating(saved.id, season.number)?.rating : null;
      const average = saved && !rating ? seasonAverage(saved.id, season.number) : null;
      if (rating) mine.replaceChildren(starDisplay(rating));
      else if (average) mine.replaceChildren(h('span', { class: 'indicative', title: 'Moyenne indicative de tes épisodes notés (ce n’est pas une note de la saison)' }, `moy. épisodes ${formatNumber(average.value, 1)}`));
      else mine.replaceChildren();
    };
    onRated(syncHead);

    const fill = () => {
      // « Marquer toute la saison comme vue » : enregistre seulement une date
      // pour chaque épisode pas encore vu — aucune note n'est imposée.
      const markDate = datePicker({ label: 'Date pour les épisodes marqués comme vus' });
      const markAll = h('button', { class: 'btn btn--small', type: 'button' }, icon('check', 16), 'Marquer toute la saison comme vue');
      const run = async () => {
        markAll.disabled = true;
        try {
          const { added } = await markSeasonSeen(item, season.number, season.episodes, markDate.getValue());
          showSaved({
            label: added ? `Saison ${season.number} marquée comme vue` : 'Déjà tout vu',
            title: item.title,
            detail: added ? `${added} épisode${added > 1 ? 's' : ''} · aucune note imposée` : 'Tous les épisodes étaient déjà marqués comme vus',
          });
          fill();
          notify();
        } catch (error) {
          markAll.disabled = false;
          showFailed({ onRetry: run });
        }
      };
      markAll.addEventListener('click', run);

      const toTranslate = []; // [bloc de résumé, texte anglais]
      body.replaceChildren(
        h('div', { class: 'season__rate' },
          h('h3', { class: 'season__label' }, `Ma note sur la saison ${season.number}`),
          ratingEditor({ item, season: season.number, label: `Note de la saison ${season.number}` })),
        h('div', { class: 'season__tools' },
          markAll,
          h('div', { class: 'season__markdate' }, h('span', { class: 'field__label' }, 'Vus le'), markDate)),
        h('ol', { class: 'episodes' }, season.episodes.map((ep) => episodeRow(item, season, ep, toTranslate))));
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

  function episodeRow(item, season, ep, toTranslate) {
    const details = h('div', { class: 'episode__details', hidden: true });
    const editor = ratingEditor({
      item, season: season.number, episode: ep.number, runtime: ep.runtime, compact: true,
      label: `Note de l’épisode ${ep.number}`,
    });
    const toggle = h('button', { class: 'icon-btn', type: 'button', 'aria-expanded': 'false', 'aria-label': 'Commentaire et date de visionnage', title: 'Commentaire et date' }, icon('comment', 18));
    toggle.addEventListener('click', () => {
      details.hidden = !details.hidden;
      toggle.setAttribute('aria-expanded', String(!details.hidden));
      if (!details.hidden && !details.children.length) details.append(editor.fields());
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
   * Étoiles + date de visionnage + commentaire, pour UN niveau : l'œuvre
   * (season/episode vides), une saison ou un épisode.
   *  - tout est facultatif : on peut noter sans commenter, commenter sans
   *    noter, laisser la date « inconnue », retirer la note seule, etc. ;
   *  - chaque changement est enregistré aussitôt, et confirmé en grand ;
   *  - seule la ligne de ce niveau est écrite : les autres niveaux ne sont
   *    jamais créés, modifiés ni effacés.
   */
  function ratingEditor({ item, season = null, episode = null, runtime = null, label, compact = false }) {
    const current = () => {
      const saved = findItem(item.source, item.source_id);
      return saved ? getRating(saved.id, season, episode) : null;
    };
    const what = episode != null ? 'cet épisode' : season != null ? 'cette saison' : item.type === 'serie' ? 'cette série' : 'ce film';
    const about = { title: item.title, detail: levelLabel(season, episode) };
    // Date qui sera enregistrée au premier enregistrement : aujourd'hui (heure
    // de Paris) par défaut, modifiable avec le sélecteur avant même de noter.
    let pendingDate = todayISO();

    /**
     * Envoie une modification. `feedback` décrit la confirmation à afficher.
     * En cas d'échec : écran « Échec de l'enregistrement — réessayer », et
     * rien de ce qui a été saisi n'est effacé.
     */
    async function save(patch, feedback) {
      const row = current();
      const full = {
        ...(runtime != null ? { runtime } : {}),
        ...(!row && !('watched_on' in patch) ? { watched_on: pendingDate } : {}),
        // un commentaire tapé mais pas encore enregistré (après une panne, par
        // exemple) part avec cet envoi : rien de ce qui est saisi ne se perd
        ...(!('comment' in patch) && commentDirty() && document.activeElement !== comment ? { comment: comment.value.trim() || null } : {}),
        ...patch,
      };
      try {
        const result = await saveRating(item, { season, episode }, full);
        sync();
        notify();
        showSaved({ ...about, ...feedback });
        if (result.removedFromWatchlist) toast('Retiré de ta liste à voir.');
        return true;
      } catch (error) {
        console.error(error);
        showFailed({
          message: /futur/.test(error.message) ? error.message : '',
          onRetry: () => save(patch, feedback),
        });
        return false;
      }
    }

    async function remove() {
      const row = current();
      if (!row) return;
      if ((row.rating || row.comment) && !window.confirm(`Supprimer ta note, ton commentaire et la date pour ${what} ?`)) return;
      try {
        const saved = findItem(item.source, item.source_id);
        await deleteRating(saved.id, season, episode);
        pendingDate = todayISO();
        comment.value = '';
        sync();
        notify();
        showSaved({ ...about, label: 'Supprimé', short: true });
      } catch (error) {
        console.error(error);
        showFailed({ onRetry: remove });
      }
    }

    // ---- étoiles
    const stars = starInput({
      value: current()?.rating ?? null, label, size: compact ? 'sm' : 'lg',
      onChange: (n) => save({ rating: n }, { label: 'Note enregistrée', rating: n }),
    });
    const value = h('span', { class: 'rating__value' });
    const indicative = h('p', { class: 'indicative indicative--line', hidden: true });
    const clearRating = h('button', { class: 'link link--small', type: 'button', onClick: () => save({ rating: null }, { label: 'Note retirée', short: true }) }, 'Retirer la note');

    // ---- date de visionnage (sélecteur, jamais de saisie au clavier)
    let picker = null;
    const makePicker = () => {
      picker = datePicker({
        value: current() ? current().watched_on : pendingDate,
        onChange: (date) => {
          if (!current()) { pendingDate = date; return; } // rien d'enregistré encore : la date servira au premier enregistrement
          save({ watched_on: date }, { label: date ? 'Date enregistrée' : 'Date inconnue enregistrée', detail: [about.detail, date ? formatDate(date) : ''].filter(Boolean).join(' · '), short: true });
        },
      });
      return picker;
    };

    // ---- commentaire (enregistré quand on quitte le champ)
    const comment = h('textarea', { class: 'input input--area', rows: compact ? 2 : 3, maxlength: 5000, placeholder: 'Ton avis, ce que tu as aimé ou non… (facultatif)', 'aria-label': 'Commentaire' });
    comment.value = current()?.comment || '';
    const commentDirty = () => (comment.value.trim() || null) !== (current()?.comment ?? null);
    const saveComment = () => {
      if (!commentDirty()) return;
      const text = comment.value.trim();
      save({ comment: text || null }, { label: text ? 'Commentaire enregistré' : 'Commentaire supprimé', short: true });
    };
    comment.addEventListener('blur', saveComment);
    pendingComments.add(saveComment); // enregistré aussi si on quitte la page sans sortir du champ

    const removeBtn = h('button', { class: 'link link--danger', type: 'button', onClick: remove }, icon('trash', 15), 'Tout supprimer');
    const seenBtn = h('button', { class: 'btn btn--small', type: 'button', onClick: () => save({}, { label: 'Marqué comme vu', short: true }) }, icon('check', 16), 'Marquer comme vu, sans noter');
    // Pastille « vu » des épisodes : un clic marque / démarque.
    const seenToggle = h('button', { class: 'seen', type: 'button', onClick: () => (current() ? remove() : save({}, { label: 'Marqué comme vu', short: true })) }, icon('check', 16));

    let fieldsNode = null;
    const fields = () => {
      if (!fieldsNode) {
        fieldsNode = h('div', { class: 'rating__fields' },
          h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Vu le'), makePicker()),
          h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Commentaire'), comment),
          h('div', { class: 'rating__actions' }, compact ? clearRating : null, removeBtn));
        sync();
      }
      return fieldsNode;
    };

    function sync() {
      const row = current();
      stars.setValue(row?.rating ?? null);
      value.textContent = row?.rating ? `${row.rating}/5` : row ? 'Vu, pas encore noté' : 'Pas encore noté';
      clearRating.hidden = !row?.rating;
      if (picker) picker.setValue(row ? row.watched_on : pendingDate);
      if (document.activeElement !== comment && !commentDirty()) comment.value = row?.comment || '';
      removeBtn.hidden = !row;
      seenBtn.hidden = !!row;
      seenToggle.classList.toggle('is-seen', !!row);
      seenToggle.setAttribute('aria-pressed', String(!!row));
      seenToggle.setAttribute('aria-label', row ? 'Vu — cliquer pour retirer' : 'Marquer comme vu');
      seenToggle.title = row ? `Vu${row.watched_on ? ` le ${formatDate(row.watched_on)}` : ' (date inconnue)'}` : 'Marquer comme vu';

      // Moyenne indicative : seulement s'il n'y a PAS de note directe à ce niveau.
      // Elle est calculée à l'affichage et n'est jamais enregistrée.
      if (!compact) {
        const saved = findItem(item.source, item.source_id);
        let text = '';
        if (saved && !row?.rating) {
          if (season != null) {
            const avg = seasonAverage(saved.id, season);
            if (avg) text = `Moyenne de tes ${avg.count > 1 ? `${avg.count} épisodes notés` : 'épisodes notés (1 épisode)'} : ${formatNumber(avg.value, 1)} / 5 — à titre indicatif`;
          } else if (item.type === 'serie') {
            const avg = seriesAverage(saved.id);
            if (avg) text = `Moyenne de tes ${avg.basis} noté${avg.basis === 'saisons' ? 'e' : ''}s (${avg.count}) : ${formatNumber(avg.value, 1)} / 5 — à titre indicatif`;
          }
        }
        indicative.textContent = text;
        indicative.hidden = !text;
      }
    }
    sync();
    if (!compact) onRated(sync); // la moyenne indicative suit les notes des niveaux en dessous

    if (compact) return { stars, fields, seenToggle };
    return h('div', { class: 'rating' },
      h('div', { class: 'rating__row' }, stars, value, clearRating),
      indicative,
      fields(),
      h('div', { class: 'rating__more' }, seenBtn));
  }

  function backLink() {
    return h('button', { class: 'back', type: 'button', onClick: () => (history.length > 1 ? history.back() : (location.hash = '#/')) },
      icon('back', 18), 'Retour');
  }

  // Nettoyage quand on quitte la page : on enregistre un éventuel commentaire
  // en cours, puis on annule les requêtes de chargement.
  return () => {
    for (const flush of pendingComments) flush();
    drawing?.abort();
    controller.abort();
    translator.stop();
  };
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
