// ============================================================================
//  MaCinéthèque — point d'entrée : connexion, navigation, affichage des pages.
// ============================================================================
import { h, icon, toast } from './utils.js';
import { sb, isConfigured, urlAuth } from './supabase.js';
import { state, loadAll, reset } from './store.js';
import { renderAuth, authMessage, rememberEmail } from './views/auth.js';
import { renderCollection } from './views/collection.js';
import { renderWatchlist } from './views/watchlist.js';
import { renderStats } from './views/stats.js';
import { renderItem } from './views/item.js';
import { renderResults } from './views/results.js';
import { renderAccount } from './views/account.js';
import { renderForYou } from './views/foryou.js';
import { renderRecaps } from './views/recaps.js';
import { renderSettings, applyRemoteTheme } from './views/settings.js';
import { createSearch } from './ui/search.js';
import { brand } from './ui/logo.js';

const app = document.getElementById('app');
let view = null; // zone centrale où s'affichent les pages
let leaveView = null; // fonction de nettoyage de la page affichée
let recovering = urlAuth.type === 'recovery'; // arrivé par un lien « mot de passe oublié »
let loadingUser = null; // identifiant du compte en cours de chargement
const scrollMemory = new Map(); // position de défilement de chaque page-liste

const NAV = [
  { href: '#/', label: 'Collection', icon: 'grid', match: ['', 'collection'] },
  { href: '#/a-voir', label: 'À voir', icon: 'bookmark', match: ['a-voir'] },
  { href: '#/pour-toi', label: 'Pour toi', icon: 'sparkles', match: ['pour-toi'] },
  { href: '#/recaps', label: 'Récaps', icon: 'replay', match: ['recaps'] },
  { href: '#/stats', label: 'Stats', icon: 'chart', match: ['stats'] },
  { href: '#/compte', label: 'Compte', icon: 'user', match: ['compte'] },
];

// ---------------------------------------------------------------------------
//  Écrans « hors connexion au compte »
// ---------------------------------------------------------------------------
function showLoading(text = 'Chargement…') {
  app.replaceChildren(h('div', { class: 'splash' },
    brand({ big: true }),
    h('p', { class: 'splash__text' }, h('span', { class: 'spinner' }), text)));
}

/** js/config.js n'a pas encore été rempli : on explique quoi faire. */
function showSetup() {
  app.replaceChildren(h('main', { class: 'auth' }, h('div', { class: 'auth__card' },
    brand({ big: true }),
    h('h1', { class: 'auth__title' }, 'Dernière étape : la configuration'),
    h('p', { class: 'auth__sub' }, 'Le site n’est pas encore relié à ta base de données Supabase.'),
    h('ol', { class: 'setup' },
      h('li', {}, 'Ouvre le fichier ', h('code', {}, 'js/config.js'), '.'),
      h('li', {}, 'Colle l’adresse de ton projet Supabase et ta clé ', h('code', {}, 'publishable'), ' (voir le README, étape 3).'),
      h('li', {}, 'Enregistre, puis recharge cette page.')))));
}

/** Les données n'ont pas pu être chargées (SQL pas encore collé, panne réseau…). */
function showLoadError(error) {
  const missingTables = /relation .* does not exist|schema cache|PGRST205|42P01|permission denied/i.test(error.message);
  app.replaceChildren(h('main', { class: 'auth' }, h('div', { class: 'auth__card' },
    h('h1', { class: 'auth__title' }, 'Impossible de charger tes données'),
    h('p', { class: 'auth__sub' }, missingTables
      ? 'La base de données ne semble pas prête. As-tu bien collé et exécuté le fichier supabase/schema.sql dans Supabase (README, étape 2) ?'
      : 'Vérifie ta connexion internet puis réessaie.'),
    h('p', { class: 'muted' }, `Détail technique : ${error.message}`),
    h('div', { class: 'auth__links' },
      h('button', { class: 'btn btn--primary', type: 'button', onClick: () => location.reload() }, 'Réessayer'),
      h('button', { class: 'btn', type: 'button', onClick: () => sb.auth.signOut() }, 'Se déconnecter')))));
}

// ---------------------------------------------------------------------------
//  Ossature du site une fois connecté : en-tête, recherche, navigation
// ---------------------------------------------------------------------------
function showShell() {
  const link = (item) => h('a', { class: 'nav__link', href: item.href, dataset: { match: item.match.join(' ') } }, icon(item.icon, 20), h('span', {}, item.label));
  view = h('main', { class: 'view', id: 'view', tabindex: '-1' });
  app.replaceChildren(
    h('header', { class: 'topbar' },
      h('div', { class: 'topbar__inner' },
        brand({ href: '#/' }),
        createSearch(),
        h('nav', { class: 'nav nav--top', 'aria-label': 'Navigation principale' }, NAV.map(link)),
        h('a', { class: 'icon-btn topbar__settings', href: '#/reglages', 'aria-label': 'Réglages', title: 'Réglages', dataset: { match: 'reglages' } }, icon('gear', 20)))),
    view,
    h('nav', { class: 'nav nav--bottom', 'aria-label': 'Navigation principale' }, NAV.map(link)));
}

// ---------------------------------------------------------------------------
//  Navigation : l'adresse après le « # » indique la page à afficher
//    #/                     → collection        #/a-voir → liste à voir
//    #/pour-toi             → suggestions       #/compte → compte
//    #/stats                → statistiques
//    #/recherche/<texte>    → résultats
//    #/oeuvre/<source>/<id> → fiche d'une œuvre
// ---------------------------------------------------------------------------
let currentHash = null;
function route() {
  if (!state.user || !view) return;
  if (currentHash !== null) scrollMemory.set(currentHash, window.scrollY);
  leaveView?.();
  leaveView = null;

  const hash = location.hash.startsWith('#/') ? location.hash.slice(2) : '';
  const [path, query = ''] = hash.split('?');
  const parts = path.split('/').filter(Boolean).map((part) => { try { return decodeURIComponent(part); } catch { return part; } });
  const page = parts[0] || '';
  currentHash = location.hash;

  if (page === 'a-voir') renderWatchlist(view);
  else if (page === 'pour-toi') leaveView = renderForYou(view);
  else if (page === 'recaps') leaveView = renderRecaps(view, { open: new URLSearchParams(query).get('ouvrir') });
  else if (page === 'reglages') leaveView = renderSettings(view);
  else if (page === 'stats') renderStats(view);
  else if (page === 'compte') renderAccount(view);
  else if (page === 'recherche' && parts[1]) leaveView = renderResults(view, parts.slice(1).join('/'));
  else if (page === 'oeuvre' && parts[1] && parts[2]) {
    leaveView = renderItem(view, { source: parts[1], id: parts[2], focusRating: new URLSearchParams(query).has('noter') });
  } else renderCollection(view);

  for (const node of document.querySelectorAll('.nav__link, .topbar__settings')) {
    const active = node.dataset.match.split(' ').includes(page);
    node.classList.toggle('is-active', active);
    if (active) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
  }
  // Les listes retrouvent leur position ; une fiche s'ouvre toujours en haut.
  const isList = page !== 'oeuvre';
  window.scrollTo(0, isList ? scrollMemory.get(location.hash) || 0 : 0);
}

// ---------------------------------------------------------------------------
//  Connexion / déconnexion
// ---------------------------------------------------------------------------
async function onSession(session) {
  if (recovering && session) { // lien « mot de passe oublié » : choisir un nouveau mot de passe
    view = null;
    renderAuth(app, { mode: 'reset', onRecovered: () => { recovering = false; toast('Mot de passe modifié'); onSession(session); } });
    return;
  }
  if (!session) {
    leaveView?.();
    leaveView = null;
    view = null;
    currentHash = null;
    reset();
    const notice = urlAuth.error ? { kind: 'error', text: authMessage(urlAuth.error.replace(/\+/g, ' ')) } : null;
    urlAuth.error = null;
    renderAuth(app, { mode: 'login', notice });
    return;
  }
  rememberEmail(session.user.email); // pour « Email oublié ? » et la prochaine connexion sur cet appareil
  if (state.user?.id === session.user.id && state.loaded) return; // déjà affiché (jeton renouvelé…)
  if (loadingUser === session.user.id) return; // chargement déjà en cours pour ce compte
  loadingUser = session.user.id;
  showLoading('Chargement de ta collection…');
  try {
    await loadAll(session.user);
  } catch (error) {
    showLoadError(error);
    return;
  } finally {
    loadingUser = null;
  }
  applyRemoteTheme(); // le thème enregistré en ligne suit d'un appareil à l'autre
  showShell();
  route();
}

function start() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {}); // facultatif : installation + hors-ligne
  }
  if (!isConfigured) { showSetup(); return; }
  showLoading();
  window.addEventListener('hashchange', () => {
    // Les liens reçus par email mettent un jeton après le « # » : ce n'est pas une page.
    if (location.hash && !location.hash.startsWith('#/')) return;
    route();
  });
  // Supabase prévient à chaque changement : session retrouvée au démarrage,
  // connexion, déconnexion, lien de récupération de mot de passe…
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') recovering = true;
    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
    // setTimeout : on ne doit pas rappeler Supabase directement depuis ce signal
    setTimeout(() => onSession(session), 0);
  });
}

start();
