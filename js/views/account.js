// ============================================================================
//  Page « Compte » : email, déconnexion, changement de mot de passe,
//  export de ses données.
// ============================================================================
import { h, toast } from '../utils.js';
import { sb } from '../supabase.js';
import { state, collection } from '../store.js';
import { pageHeader } from '../ui/cards.js';
import { authMessage } from './auth.js';

export function renderAccount(root) {
  const count = collection().length;

  // ---- changement de mot de passe
  const password = h('input', { class: 'input', type: 'password', minlength: 6, required: true, autocomplete: 'new-password', placeholder: 'Nouveau mot de passe (6 caractères min.)', 'aria-label': 'Nouveau mot de passe' });
  const save = h('button', { class: 'btn', type: 'submit' }, 'Changer le mot de passe');
  const form = h('form', { class: 'form form--inline' }, password, save);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    const { error } = await sb.auth.updateUser({ password: password.value });
    save.disabled = false;
    if (error) { toast(authMessage(error), 'error'); return; }
    password.value = '';
    toast('Mot de passe modifié');
  });

  // ---- export (une copie de sécurité de ses notes, au format JSON)
  const exportButton = h('button', { class: 'btn', type: 'button' }, 'Exporter mes données');
  exportButton.addEventListener('click', () => {
    const data = {
      exporte_le: new Date().toISOString(),
      oeuvres: [...state.items.values()],
      notes: state.ratings,
      liste_a_voir: [...state.watchlist.entries()].map(([item_id, added_at]) => ({ item_id, added_at })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = h('a', { href: url, download: 'macinetheque-export.json' });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const logout = h('button', { class: 'btn btn--danger', type: 'button' }, 'Se déconnecter');
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    const { error } = await sb.auth.signOut();
    if (error) { logout.disabled = false; toast(authMessage(error), 'error'); }
    // l'écran de connexion s'affiche via onAuthStateChange (app.js)
  });

  root.replaceChildren(
    pageHeader('Compte'),
    h('section', { class: 'panel' },
      h('h2', { class: 'panel__title' }, 'Connecté en tant que'),
      h('p', { class: 'account__email' }, state.user?.email || ''),
      h('p', { class: 'muted' }, `${count} œuvre${count > 1 ? 's' : ''} dans ta collection · ${state.watchlist.size} à voir. Tes données sont privées : toi seul peux les voir.`),
      logout),
    h('section', { class: 'panel' }, h('h2', { class: 'panel__title' }, 'Mot de passe'), form),
    h('section', { class: 'panel' },
      h('h2', { class: 'panel__title' }, 'Mes données'),
      h('p', { class: 'muted' }, 'Télécharge une copie de tes notes, commentaires et de ta liste à voir.'),
      exportButton));
}
