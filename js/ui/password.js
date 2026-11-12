// ============================================================================
//  Champ « mot de passe » avec une icône œil pour l'afficher ou le masquer,
//  et vérification en direct d'un second champ « Confirmer le mot de passe ».
// ============================================================================
import { h, icon } from '../utils.js';

/**
 * Crée un champ mot de passe. Renvoie { field, input } :
 *   field = le bloc complet (libellé + champ + œil + message), à insérer dans la page
 *   input = le champ lui-même (pour lire sa valeur)
 */
export function passwordField({ id, label, autocomplete = 'current-password', placeholder = '', minlength = 6 }) {
  const input = h('input', {
    class: 'input input--password', type: 'password', id, name: id, required: true, minlength,
    autocomplete, placeholder, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
  });
  const eye = h('button', { class: 'pw__eye', type: 'button', 'aria-label': 'Afficher le mot de passe', 'aria-pressed': 'false', title: 'Afficher le mot de passe' }, icon('eye', 20));

  // On empêche le bouton de « prendre » le curseur : le champ garde le focus
  // (le clavier du téléphone reste ouvert) et la position du curseur.
  eye.addEventListener('pointerdown', (event) => event.preventDefault());
  eye.addEventListener('mousedown', (event) => event.preventDefault());
  eye.addEventListener('click', () => {
    const hadFocus = document.activeElement === input;
    const { selectionStart, selectionEnd } = input;
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    eye.replaceChildren(icon(visible ? 'eye-off' : 'eye', 20));
    eye.setAttribute('aria-pressed', String(visible));
    eye.setAttribute('aria-label', visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
    eye.title = eye.getAttribute('aria-label');
    if (hadFocus) {
      input.focus({ preventScroll: true });
      // changer de type peut déplacer le curseur : on le remet à sa place
      requestAnimationFrame(() => { try { input.setSelectionRange(selectionStart, selectionEnd); } catch { /* sans gravité */ } });
    }
  });

  const hint = h('p', { class: 'field__hint', 'aria-live': 'polite', hidden: true });
  const field = h('div', { class: 'field' },
    h('label', { class: 'field__label', for: id }, label),
    h('div', { class: 'pw' }, input, eye),
    hint);
  return { field, input, hint };
}

/**
 * Relie un champ « mot de passe » et sa confirmation : message discret sous
 * la confirmation pendant la frappe, et bouton de validation désactivé tant
 * que les deux ne sont pas identiques (et assez longs).
 */
export function linkConfirmation({ password, confirm, hint, submit, minLength = 6 }) {
  const check = () => {
    const a = password.value;
    const b = confirm.value;
    const same = a.length > 0 && a === b;
    const longEnough = a.length >= minLength;
    hint.hidden = b.length === 0;
    hint.className = `field__hint ${same ? 'field__hint--ok' : 'field__hint--error'}`;
    hint.replaceChildren(same ? icon('check', 14) : '', same ? 'Les mots de passe correspondent' : 'Les mots de passe ne correspondent pas');
    submit.disabled = !(same && longEnough);
    return same && longEnough;
  };
  password.addEventListener('input', check);
  confirm.addEventListener('input', check);
  check();
  return check;
}
