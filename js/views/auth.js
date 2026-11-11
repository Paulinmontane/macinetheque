// ============================================================================
//  Écrans de compte : connexion, inscription, mot de passe oublié,
//  choix d'un nouveau mot de passe (après clic sur le lien reçu par email).
// ============================================================================
import { h } from '../utils.js';
import { sb, SITE_URL } from '../supabase.js';

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

/**
 * Affiche l'écran de compte dans `root`.
 *   mode  : 'login' | 'signup' | 'forgot' | 'reset'
 *   notice: message d'information à afficher en haut (facultatif)
 */
export function renderAuth(root, { mode = 'login', notice = null, onRecovered = null } = {}) {
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
  const password = h('input', {
    class: 'input', type: 'password', name: 'password', id: 'auth-password', required: true, minlength: 6,
    autocomplete: mode === 'login' ? 'current-password' : 'new-password', placeholder: mode === 'login' ? 'Ton mot de passe' : '6 caractères minimum',
  });
  const submitLabels = { login: 'Se connecter', signup: 'Créer mon compte', forgot: 'Recevoir le lien', reset: 'Enregistrer le mot de passe' };
  const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, submitLabels[mode]);

  const form = h('form', { class: 'form', novalidate: false },
    message,
    mode !== 'reset' && h('label', { class: 'field', for: 'auth-email' }, h('span', { class: 'field__label' }, 'Email'), email),
    mode !== 'forgot' && h('label', { class: 'field', for: 'auth-password' },
      h('span', { class: 'field__label' }, mode === 'reset' ? 'Nouveau mot de passe' : 'Mot de passe'), password),
    submit);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
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
    }
  });

  const link = (label, target) => h('button', { class: 'link', type: 'button', onClick: () => renderAuth(root, { mode: target }) }, label);
  const links = {
    login: [link('Créer un compte', 'signup'), link('Mot de passe oublié ?', 'forgot')],
    signup: [link('J’ai déjà un compte', 'login')],
    forgot: [link('Retour à la connexion', 'login')],
    reset: [],
  }[mode];

  root.replaceChildren(h('main', { class: 'auth' },
    h('div', { class: 'auth__card' },
      h('div', { class: 'brand brand--big' }, h('span', { class: 'brand__star' }, '★'), 'MaCinéthèque'),
      h('h1', { class: 'auth__title' }, title),
      h('p', { class: 'auth__sub' }, subtitle),
      form,
      links.length ? h('div', { class: 'auth__links' }, links) : null)));

  (mode === 'reset' ? password : email).focus({ preventScroll: true });
}
