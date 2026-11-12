// ============================================================================
//  Écrans de compte : connexion, inscription, mot de passe oublié,
//  choix d'un nouveau mot de passe (après clic sur le lien reçu par email).
// ============================================================================
import { h, icon } from '../utils.js';
import { sb, SITE_URL } from '../supabase.js';
import { brand } from '../ui/logo.js';
import { passwordField, linkConfirmation } from '../ui/password.js';

/** Traduit les messages d'erreur de Supabase (en anglais) en français clair. */
export function authMessage(error) {
  const text = String(error?.message || error || '');
  const code = error?.code || '';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(text)) return 'Email ou mot de passe incorrect.';
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(text)) return 'Ton adresse email n’est pas encore confirmée. Clique sur le lien reçu par email.';
  if (code === 'user_already_exists' || /already registered|already been registered/i.test(text)) return 'Un compte existe déjà avec cette adresse email.';
  if (code === 'weak_password' || /password should be|weak password/i.test(text)) return 'Mot de passe trop faible : au moins 6 caractères.';
  if (code === 'same_password' || /different from the old/i.test(text)) return 'Le nouveau mot de passe doit être différent de l’ancien.';
  if (/rate limit|only request this after|too many requests/i.test(text) || error?.status === 429) return 'Trop de tentatives. Patiente une minute avant de réessayer (les emails gratuits sont limités).';
  if (/not authorized|email address .* invalid|invalid.*email/i.test(text)) return 'Cette adresse email n’est pas acceptée. Vérifie-la (voir le README, partie « emails »).';
  if (/expired|invalid.*link|otp/i.test(text)) return 'Ce lien n’est plus valable. Redemande un email.';
  if (/failed to fetch|network|load failed/i.test(text)) return 'Connexion impossible. Vérifie ta connexion internet.';
  if (/signups? not allowed|disabled/i.test(text)) return 'Les inscriptions sont désactivées sur ce site.';
  return text || 'Une erreur est survenue. Réessaie.';
}

// ---------------------------------------------------------------------------
//  Adresses email déjà utilisées pour se connecter SUR CET APPAREIL.
//  Elles restent dans ce navigateur (jamais envoyées nulle part) et servent à
//  pré-remplir la connexion et à aider en cas d'« email oublié ».
// ---------------------------------------------------------------------------
const EMAILS_KEY = 'macinetheque:emails';

export function knownEmails() {
  try { return JSON.parse(localStorage.getItem(EMAILS_KEY) || '[]').filter((e) => typeof e === 'string'); } catch { return []; }
}
/** Retient une adresse (la plus récente en premier, 3 au maximum). */
export function rememberEmail(address) {
  if (!address) return;
  try { localStorage.setItem(EMAILS_KEY, JSON.stringify([address, ...knownEmails().filter((e) => e !== address)].slice(0, 3))); } catch { /* navigation privée : tant pis */ }
}
function forgetEmail(address) {
  try { localStorage.setItem(EMAILS_KEY, JSON.stringify(knownEmails().filter((e) => e !== address))); } catch { /* sans gravité */ }
}

/**
 * Écran « Email oublié ? ». Le site ne peut pas dire si une adresse possède
 * un compte (sinon n'importe qui pourrait tester des adresses) : il aide
 * plutôt à la retrouver.
 */
function renderForgotEmail(root, { onPick }) {
  const list = h('div', { class: 'known-emails' });
  const paint = () => {
    const emails = knownEmails();
    list.replaceChildren(...(emails.length
      ? [h('p', { class: 'field__label' }, emails.length > 1 ? 'Adresses déjà utilisées sur cet appareil' : 'Adresse déjà utilisée sur cet appareil'),
        ...emails.map((address) => h('div', { class: 'known-email' },
          h('button', { class: 'btn btn--block known-email__use', type: 'button', onClick: () => onPick(address) }, address),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Oublier ${address} sur cet appareil`, title: 'Oublier cette adresse sur cet appareil', onClick: () => { forgetEmail(address); paint(); } }, icon('close', 16))))]
      : [h('p', { class: 'form__message' }, 'Aucune connexion n’a encore eu lieu sur cet appareil, depuis ce navigateur.')]));
  };
  paint();
  root.replaceChildren(h('main', { class: 'auth' },
    h('div', { class: 'auth__card' },
      brand({ big: true }),
      h('h1', { class: 'auth__title' }, 'Email oublié'),
      h('p', { class: 'auth__sub' }, 'Ton compte, c’est ton adresse email. Voici comment la retrouver.'),
      list,
      h('ol', { class: 'tips' },
        h('li', {}, h('strong', {}, 'Cherche l’email de confirmation. '), 'Dans chacune de tes boîtes mail (y compris les indésirables), cherche « Supabase » : c’est l’expéditeur du message reçu à l’inscription. La boîte qui l’a reçu est la bonne.'),
        h('li', {}, h('strong', {}, 'Regarde les mots de passe enregistrés. '), 'Sur iPhone : Réglages → Mots de passe (ou l’app Mots de passe), puis cherche « github.io ». Sur ordinateur : le gestionnaire de mots de passe de ton navigateur.'),
        h('li', {}, h('strong', {}, 'Demande au propriétaire du site. '), 'Il voit la liste des comptes dans Supabase (Authentication → Users).')),
      h('p', { class: 'muted' }, 'Ensuite, si tu as aussi oublié ton mot de passe, utilise « Mot de passe oublié ? » avec la bonne adresse.'),
      h('div', { class: 'auth__links' },
        h('button', { class: 'link', type: 'button', onClick: () => renderAuth(root, { mode: 'login' }) }, 'Retour à la connexion'),
        h('button', { class: 'link', type: 'button', onClick: () => renderAuth(root, { mode: 'forgot' }) }, 'Mot de passe oublié ?')))));
}

/**
 * Affiche l'écran de compte dans `root`.
 *   mode  : 'login' | 'signup' | 'forgot' | 'reset' | 'email' (email oublié)
 *   notice: message d'information à afficher en haut (facultatif)
 */
export function renderAuth(root, { mode = 'login', notice = null, onRecovered = null, email: prefill = null } = {}) {
  if (mode === 'email') {
    renderForgotEmail(root, { onPick: (address) => renderAuth(root, { mode: 'login', email: address }) });
    return;
  }
  const titles = {
    login: ['Connexion', 'Retrouve ta collection de films et de séries.'],
    signup: ['Créer un compte', 'Quelques secondes suffisent pour commencer à noter.'],
    forgot: ['Mot de passe oublié', 'Indique ton email : tu recevras un lien pour en choisir un nouveau.'],
    reset: ['Nouveau mot de passe', 'Choisis ton nouveau mot de passe.'],
  };
  const [title, subtitle] = titles[mode];

  const message = h('p', { class: 'form__message', role: 'alert', hidden: !notice }, notice?.text || '');
  if (notice) message.classList.add(`form__message--${notice.kind || 'info'}`);
  const show = (text, kind = 'error') => {
    message.hidden = false;
    message.textContent = text;
    message.className = `form__message form__message--${kind}`;
  };

  const email = h('input', { class: 'input', type: 'email', name: 'email', id: 'auth-email', required: true, autocomplete: 'email', placeholder: 'prenom@exemple.fr', inputmode: 'email', autocapitalize: 'off' });
  // pré-rempli : adresse choisie dans « Email oublié », ou dernière adresse utilisée ici
  email.value = prefill || (mode === 'login' || mode === 'forgot' ? knownEmails()[0] || '' : '');
  // Mot de passe : icône œil pour l'afficher ; à l'inscription et après un
  // « mot de passe oublié », un second champ de confirmation.
  const needsConfirm = mode === 'signup' || mode === 'reset';
  const pass = passwordField({
    id: 'auth-password', label: mode === 'reset' ? 'Nouveau mot de passe' : 'Mot de passe',
    autocomplete: mode === 'login' ? 'current-password' : 'new-password',
    placeholder: mode === 'login' ? 'Ton mot de passe' : '6 caractères minimum',
  });
  const password = pass.input;
  const confirm = needsConfirm
    ? passwordField({ id: 'auth-password-confirm', label: 'Confirmer le mot de passe', autocomplete: 'new-password', placeholder: 'Le même mot de passe' })
    : null;
  const submitLabels = { login: 'Se connecter', signup: 'Créer mon compte', forgot: 'Recevoir le lien', reset: 'Enregistrer le mot de passe' };
  const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, submitLabels[mode]);
  // Le bouton reste désactivé tant que les deux mots de passe ne sont pas identiques.
  const passwordsMatch = needsConfirm
    ? linkConfirmation({ password, confirm: confirm.input, hint: confirm.hint, submit })
    : () => true;

  const form = h('form', { class: 'form', novalidate: false },
    message,
    mode !== 'reset' && h('label', { class: 'field', for: 'auth-email' }, h('span', { class: 'field__label' }, 'Email'), email),
    mode !== 'forgot' && pass.field,
    confirm && confirm.field,
    submit);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!passwordsMatch()) return;
    submit.disabled = true;
    submit.classList.add('is-loading');
    message.hidden = true;
    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
        if (error) throw error;
        // la suite (chargement des données) est déclenchée par onAuthStateChange dans app.js
      } else if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({
          email: email.value.trim(), password: password.value, options: { emailRedirectTo: SITE_URL },
        });
        if (error) throw error;
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          show('Un compte existe déjà avec cette adresse email. Connecte-toi, ou utilise « Mot de passe oublié ».');
        } else if (!data.session) {
          form.replaceChildren(h('p', { class: 'form__message form__message--success' },
            `Presque fini ! Un email de confirmation vient d’être envoyé à ${email.value.trim()}. Clique sur le lien qu’il contient pour activer ton compte (pense à regarder dans les indésirables).`));
        }
      } else if (mode === 'forgot') {
        const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: SITE_URL });
        if (error) throw error;
        form.replaceChildren(h('p', { class: 'form__message form__message--success' },
          'Si un compte existe avec cette adresse, un email vient de partir. Clique sur le lien qu’il contient pour choisir un nouveau mot de passe.'));
      } else if (mode === 'reset') {
        const { error } = await sb.auth.updateUser({ password: password.value });
        if (error) throw error;
        onRecovered?.();
      }
    } catch (error) {
      show(authMessage(error));
    } finally {
      submit.disabled = false;
      submit.classList.remove('is-loading');
      passwordsMatch(); // remet le bouton dans l'état qui correspond aux champs
    }
  });

  // l'adresse déjà tapée suit quand on passe d'un écran à l'autre
  const link = (label, target) => h('button', { class: 'link', type: 'button', onClick: () => renderAuth(root, { mode: target, email: email.value.trim() || null }) }, label);
  const links = {
    login: [link('Créer un compte', 'signup'), link('Mot de passe oublié ?', 'forgot'), link('Email oublié ?', 'email')],
    signup: [link('J’ai déjà un compte', 'login')],
    forgot: [link('Retour à la connexion', 'login'), link('Email oublié ?', 'email')],
    reset: [],
  }[mode];

  root.replaceChildren(h('main', { class: 'auth' },
    h('div', { class: 'auth__card' },
      brand({ big: true }),
      h('h1', { class: 'auth__title' }, title),
      h('p', { class: 'auth__sub' }, subtitle),
      form,
      links.length ? h('div', { class: 'auth__links' }, links) : null)));

  (mode === 'reset' || (mode === 'login' && email.value) ? password : email).focus({ preventScroll: true });
}
