// ============================================================================
//  Barre de recherche unique (films + séries) avec autocomplétion.
//
//   - suggestions dès 2 caractères, après ~300 ms sans frappe (debounce) ;
//   - texte grisé qui complète le titre le plus probable : Tab ou → l'accepte ;
//   - clavier : ↑ ↓ pour parcourir, Entrée pour ouvrir, Échap pour fermer.
// ============================================================================
import { h, icon, debounce, normalize, isAbort } from '../utils.js';
import { searchAll, thumbnail } from '../catalog.js';
import { itemUrl, typeLabel } from './cards.js';
import { findItem, getRating } from '../store.js';

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;
const MAX_SUGGESTIONS = 8;

export function createSearch() {
  let results = []; // suggestions affichées
  let active = -1; // index de la suggestion surlignée (-1 = aucune)
  let ghostRest = ''; // fin de titre proposée en gris
  let ghostTitle = ''; // titre complet correspondant
  let controller = null; // pour annuler la recherche précédente
  let open = false;

  const input = h('input', {
    class: 'search__input', type: 'text', inputmode: 'search', enterkeyhint: 'search',
    placeholder: 'Rechercher un film ou une série…', 'aria-label': 'Rechercher un film ou une série',
    role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'search-list', 'aria-autocomplete': 'both',
    autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
  });
  const ghostTyped = h('span', { class: 'search__ghost-typed' });
  const ghostTail = h('span', { class: 'search__ghost-rest' });
  const ghost = h('div', { class: 'search__ghost', 'aria-hidden': 'true' }, ghostTyped, ghostTail);
  // Indice discret : « Tab » au clavier ; sur écran tactile, une flèche à toucher.
  const touch = window.matchMedia?.('(hover: none)').matches;
  const hint = h('kbd', { class: 'search__hint', hidden: true, title: 'Compléter le titre' }, touch ? '→' : 'Tab');
  const clear = h('button', { class: 'search__clear', type: 'button', 'aria-label': 'Effacer la recherche', hidden: true }, icon('close', 16));
  const list = h('ul', { class: 'search__list', id: 'search-list', role: 'listbox', hidden: true });
  const root = h('div', { class: 'search', role: 'search' },
    h('div', { class: 'search__field' }, icon('search', 18), ghost, input, hint, clear),
    list);

  // ------------------------------------------------------------------ texte grisé
  function updateGhost() {
    const typed = input.value;
    ghostRest = '';
    const atEnd = input.selectionStart === typed.length;
    const fits = input.scrollWidth <= input.clientWidth + 1;
    if (typed.trim().length >= MIN_CHARS && atEnd && fits && document.activeElement === input) {
      // le meilleur résultat dont le titre COMMENCE par ce qui est tapé
      const best = results.find((item) => item.title.length > typed.length
        && normalize(item.title.slice(0, typed.length)) === normalize(typed)
        && item.title.slice(0, typed.length).length === typed.length);
      if (best) { ghostRest = best.title.slice(typed.length); ghostTitle = best.title; }
    }
    ghostTyped.textContent = typed;
    ghostTail.textContent = ghostRest;
    hint.hidden = !ghostRest;
    clear.hidden = !typed || !!ghostRest;
  }

  function acceptGhost() {
    if (!ghostRest) return false;
    input.value = ghostTitle; // le titre exact, avec ses majuscules et ses accents
    updateGhost();
    runSearch(); // on affine les suggestions avec le titre complet
    return true;
  }

  // ------------------------------------------------------------------ liste
  function setOpen(value) {
    open = value;
    list.hidden = !value;
    input.setAttribute('aria-expanded', String(value));
    root.classList.toggle('is-open', value);
    if (!value) { active = -1; input.removeAttribute('aria-activedescendant'); }
  }

  function setActive(index) {
    active = index;
    [...list.querySelectorAll('.suggestion')].forEach((node, i) => {
      node.classList.toggle('is-active', i === index);
      node.setAttribute('aria-selected', String(i === index));
      if (i === index) {
        input.setAttribute('aria-activedescendant', node.id);
        node.scrollIntoView({ block: 'nearest' });
      }
    });
    if (index < 0) input.removeAttribute('aria-activedescendant');
  }

  function suggestion(item, index, signal) {
    const thumb = h('div', { class: 'suggestion__thumb' });
    thumbnail(item, signal).then((url) => {
      if (!url) return;
      const img = h('img', { src: url, alt: '', loading: 'lazy' });
      img.addEventListener('error', () => img.remove());
      thumb.append(img);
    }).catch(() => {});

    const saved = findItem(item.source, item.source_id);
    const mine = saved && getRating(saved.id)?.rating;
    const details = [item.year, item.type === 'film' ? item.description : item.countries?.[0]].filter(Boolean).join(' · ');
    return h('li', {
      class: 'suggestion', id: `suggestion-${index}`, role: 'option', 'aria-selected': 'false',
      onMousedown: (event) => event.preventDefault(), // garde le curseur dans le champ
      onClick: () => go(item),
      onMousemove: () => { if (active !== index) setActive(index); },
    },
    thumb,
    h('div', { class: 'suggestion__text' },
      h('span', { class: 'suggestion__title' }, item.title),
      h('span', { class: 'suggestion__meta' }, details || ' ')),
    mine && h('span', { class: 'suggestion__mine' }, `★ ${mine}`),
    h('span', { class: `badge badge--${item.type}` }, typeLabel(item)));
  }

  function render({ pending = 0, failed = [] } = {}, signal) {
    const query = input.value.trim();
    const rows = results.map((item, index) => suggestion(item, index, signal));
    if (pending && !rows.length) {
      for (let i = 0; i < 4; i += 1) {
        rows.push(h('li', { class: 'suggestion suggestion--skeleton', 'aria-hidden': 'true' },
          h('div', { class: 'suggestion__thumb skeleton' }),
          h('div', { class: 'suggestion__text' },
            h('span', { class: 'skeleton skeleton--line' }), h('span', { class: 'skeleton skeleton--line skeleton--short' }))));
      }
    } else if (pending) {
      rows.push(h('li', { class: 'search__note', role: 'presentation' }, h('span', { class: 'spinner' }), 'Recherche en cours…'));
    } else if (!rows.length) {
      rows.push(h('li', { class: 'search__note', role: 'presentation' }, `Aucun résultat pour « ${query} ».`));
    }
    if (failed.length) {
      rows.push(h('li', { class: 'search__note search__note--warn', role: 'presentation' },
        `La recherche de ${failed.join(' et de ')} ne répond pas pour le moment. Réessaie dans un instant.`));
    }
    list.replaceChildren(...rows);
    setOpen(true);
    setActive(Math.min(active, results.length - 1));
    updateGhost();
  }

  // ------------------------------------------------------------------ recherche
  async function runSearch() {
    const query = input.value.trim();
    controller?.abort();
    if (query.length < MIN_CHARS) { results = []; setOpen(false); updateGhost(); return; }
    controller = new AbortController();
    const { signal } = controller;
    const show = (state) => {
      if (signal.aborted) return;
      results = state.results.slice(0, MAX_SUGGESTIONS);
      render(state, signal);
    };
    if (!results.length) render({ pending: 1 }, signal); // squelettes tout de suite
    try {
      show(await searchAll(query, signal, show));
    } catch (error) {
      if (isAbort(error)) return;
      results = [];
      render({ failed: ['films', 'séries'] }, signal);
    }
  }
  const debouncedSearch = debounce(runSearch, DEBOUNCE_MS);

  function go(item) {
    close(true);
    location.hash = itemUrl(item);
  }

  function close(clearInput = false) {
    debouncedSearch.cancel();
    controller?.abort();
    setOpen(false);
    if (clearInput) { input.value = ''; results = []; }
    updateGhost();
    input.blur();
  }

  // ------------------------------------------------------------------ événements
  input.addEventListener('input', () => {
    active = -1;
    // on retire tout de suite les suggestions qui ne correspondent plus du tout
    updateGhost();
    if (input.value.trim().length < MIN_CHARS) { debouncedSearch.cancel(); runSearch(); } else debouncedSearch();
  });

  input.addEventListener('keydown', (event) => {
    const count = results.length;
    switch (event.key) {
      case 'ArrowDown':
        if (!open && count) { setOpen(true); }
        if (count) { event.preventDefault(); setActive(active + 1 >= count ? 0 : active + 1); }
        break;
      case 'ArrowUp':
        if (count && open) { event.preventDefault(); setActive(active <= 0 ? count - 1 : active - 1); }
        break;
      case 'Enter':
        event.preventDefault();
        if (open && active >= 0 && results[active]) go(results[active]);
        else if (input.value.trim().length >= MIN_CHARS) {
          const query = input.value.trim();
          close(false);
          location.hash = `#/recherche/${encodeURIComponent(query)}`;
        }
        break;
      case 'Escape':
        if (open) { event.preventDefault(); setOpen(false); } else if (input.value) { input.value = ''; results = []; updateGhost(); }
        break;
      case 'Tab':
        if (ghostRest && !event.shiftKey) { event.preventDefault(); acceptGhost(); }
        break;
      case 'ArrowRight':
        if (ghostRest && input.selectionStart === input.value.length) { event.preventDefault(); acceptGhost(); }
        break;
      default:
    }
  });

  input.addEventListener('focus', () => {
    updateGhost();
    if (input.value.trim().length >= MIN_CHARS && (results.length || list.children.length)) setOpen(true);
  });
  input.addEventListener('blur', () => { ghostRest = ''; ghostTail.textContent = ''; hint.hidden = true; setTimeout(() => { if (document.activeElement !== input) setOpen(false); }, 120); });
  input.addEventListener('click', updateGhost);
  input.addEventListener('keyup', (event) => { if (['ArrowLeft', 'Home', 'End'].includes(event.key)) updateGhost(); });
  // Sur mobile, toucher le texte grisé l'accepte (pas de touche Tab sur un téléphone).
  hint.addEventListener('mousedown', (event) => { event.preventDefault(); acceptGhost(); });
  clear.addEventListener('mousedown', (event) => event.preventDefault());
  clear.addEventListener('click', () => { input.value = ''; results = []; controller?.abort(); setOpen(false); updateGhost(); input.focus(); });
  window.addEventListener('resize', updateGhost);

  /** Pré-remplit le champ (utilisé par la page de résultats). */
  root.setQuery = (text) => { input.value = text; updateGhost(); };
  root.focusInput = () => input.focus();
  return root;
}
