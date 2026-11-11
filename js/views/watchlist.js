// ============================================================================
//  Liste « à voir » : même grille que la collection. Un clic sur « J'ai vu »
//  fait passer l'œuvre dans la collection et ouvre sa fiche pour la noter.
// ============================================================================
import { h, icon, toast } from '../utils.js';
import { state, saveRating, removeFromWatchlist } from '../store.js';
import { card, grid, emptyState, pageHeader, itemUrl } from '../ui/cards.js';

export function renderWatchlist(root) {
  const entries = [...state.watchlist.entries()]
    .map(([itemId, addedAt]) => ({ item: state.items.get(itemId), addedAt }))
    .filter((entry) => entry.item)
    .sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt))); // ajouts récents d'abord

  if (!entries.length) {
    root.replaceChildren(
      pageHeader('À voir'),
      emptyState({
        iconName: 'bookmark',
        title: 'Ta liste à voir est vide',
        text: 'Sur la fiche d’un film ou d’une série, clique sur « Ajouter à ma liste à voir » pour t’en souvenir plus tard.',
        action: h('button', { class: 'btn btn--primary', type: 'button', onClick: () => document.querySelector('.search__input')?.focus() }, 'Rechercher une œuvre'),
      }));
    return;
  }

  const cards = entries.map(({ item }) => {
    const seen = h('button', { class: 'btn btn--small btn--primary', type: 'button' }, icon('check', 16), 'J’ai vu');
    seen.addEventListener('click', async () => {
      seen.disabled = true;
      try {
        // Marque l'œuvre comme vue aujourd'hui (ce qui la retire de la liste),
        // puis ouvre sa fiche directement sur les étoiles.
        await saveRating(item, {}, {});
        toast('Marqué comme vu — à toi de noter !');
        location.hash = `${itemUrl(item)}?noter=1`;
      } catch (error) {
        toast(`Impossible d’enregistrer : ${error.message}`, 'error');
        seen.disabled = false;
      }
    });
    const remove = h('button', { class: 'link link--small', type: 'button' }, 'Retirer');
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await removeFromWatchlist(item.id);
        toast('Retiré de ta liste à voir');
        renderWatchlist(root);
      } catch (error) {
        toast(`Impossible de retirer : ${error.message}`, 'error');
        remove.disabled = false;
      }
    });
    return card(item, { action: h('div', { class: 'card__actions' }, seen, remove) });
  });

  root.replaceChildren(
    pageHeader('À voir', `${entries.length} œuvre${entries.length > 1 ? 's' : ''} en attente`),
    grid(cards));
}
