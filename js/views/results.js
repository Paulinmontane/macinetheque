// ============================================================================
//  Page de résultats (touche Entrée dans la barre de recherche) :
//  tous les films et séries trouvés, sous forme de grille.
// ============================================================================
import { h, isAbort } from '../utils.js';
import { searchAll, thumbnail } from '../catalog.js';
import { card, grid, skeletonGrid, emptyState, pageHeader, poster } from '../ui/cards.js';
import { findItem, getRating } from '../store.js';

export function renderResults(root, query) {
  const controller = new AbortController();
  const { signal } = controller;
  const body = h('div', {}, skeletonGrid(8));
  const note = h('p', { class: 'muted', hidden: true });
  root.replaceChildren(pageHeader(`Résultats pour « ${query} »`), note, body);

  const show = ({ results, pending, failed }) => {
    if (signal.aborted) return;
    if (failed.length) {
      note.hidden = false;
      note.textContent = `La recherche de ${failed.join(' et de ')} ne répond pas pour le moment : les résultats sont incomplets.`;
    }
    if (!results.length) {
      if (pending) return; // on garde les squelettes tant qu'une source cherche encore
      body.replaceChildren(emptyState({
        iconName: 'search',
        title: 'Aucun résultat',
        text: `Rien trouvé pour « ${query} ». Vérifie l’orthographe ou essaie le titre original.`,
      }));
      return;
    }
    body.replaceChildren(grid(results.map((item) => {
      const saved = findItem(item.source, item.source_id);
      const mine = saved && getRating(saved.id)?.rating;
      const node = card(item, { badge: mine ? `★ ${mine}` : null, meta: [item.year, item.countries?.[0]].filter(Boolean).join(' · ') });
      if (!item.thumb_url && !item.poster_url) {
        // film Wikidata : l'affiche arrive de Wikipédia un instant plus tard
        thumbnail(item, signal).then((url) => {
          if (url) node.querySelector('.poster')?.replaceWith(poster({ ...item, thumb_url: url }));
        }).catch(() => {});
      }
      return node;
    })), ...(pending ? [h('p', { class: 'muted results__pending' }, h('span', { class: 'spinner' }), 'Recherche en cours…')] : []));
  };

  searchAll(query, signal, show).then(show).catch((error) => {
    if (isAbort(error)) return;
    body.replaceChildren(emptyState({
      iconName: 'search',
      title: 'Recherche indisponible',
      text: 'Les sources de films et de séries ne répondent pas pour le moment. Réessaie dans un instant.',
    }));
  });

  return () => controller.abort();
}
