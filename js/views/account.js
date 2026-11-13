// ============================================================================
//  Page « Compte » : email, déconnexion, changement de mot de passe,
//  export de ses données.
// ============================================================================
import { h, icon, toast } from '../utils.js';
import { sb } from '../supabase.js';
import { state, collection } from '../store.js';
import { pageHeader } from '../ui/cards.js';
import { authMessage } from './auth.js';
import { passwordField, linkConfirmation } from '../ui/password.js';

export function renderAccount(root) {
  const count = collection().length;

  // ---- changement de mot de passe
  const pass = passwordField({ id: 'account-password', label: 'Nouveau mot de passe', autocomplete: 'new-password', placeholder: '6 caractères minimum' });
  const confirm = passwordField({ id: 'account-password-confirm', label: 'Confirmer le mot de passe', autocomplete: 'new-password', placeholder: 'Le même mot de passe' });
  const password = pass.input;
  const save = h('button', { class: 'btn', type: 'submit' }, 'Changer le mot de passe');
  const passwordsMatch = linkConfirmation({ password, confirm: confirm.input, hint: confirm.hint, submit: save });
  const form = h('form', { class: 'form form--narrow' }, pass.field, confirm.field, h('div', {}, save));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!passwordsMatch()) return;
    save.disabled = true;
    const { error } = await sb.auth.updateUser({ password: password.value });
    if (error) { passwordsMatch(); toast(authMessage(error), 'error'); return; }
    password.value = '';
    confirm.input.value = '';
    passwordsMatch();
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
    h('a', { class: 'btn account__settings', href: '#/reglages' }, icon('gear', 18), 'Réglages : couleurs et apparence'),
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
