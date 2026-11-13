// ============================================================================
//  Petites fonctions utilitaires partagées par tout le site.
// ============================================================================

/**
 * Crée un élément HTML. Exemple : h('a', { class: 'btn', href: '#/' }, 'Accueil')
 * Les textes passent par textContent : aucun risque d'injection de HTML.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Crée un élément SVG (les graphiques et les icônes). */
export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Icônes au trait (dessinées à la main, aucun fichier externe). */
const ICONS = {
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  bookmark: 'M6 3h12v18l-6-4.5L6 21z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6 8-6s8 2 8 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  chevron: 'M9 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  comment: 'M4 5h16v11H9l-5 4z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  back: 'M15 6l-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4z',
  replay: 'M4 5h16v14H4zM10 9.5v5l4.5-2.5z',
  'chevron-left': 'M15 6l-6 6 6 6',
  share: 'M12 3v12M7.5 7.5L12 3l4.5 4.5M5 13v6h14v-6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'eye-off': 'M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.5 6.6C3.6 8.5 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.5 4.5-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2',
  sparkles: 'M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8zM18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  refresh: 'M20 11a8 8 0 0 0-14.3-4.6L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.6L20 16M20 20v-4h-4',
  calendar: 'M5 5h14v15H5zM5 10h14M9 3v4M15 3v4',
  download: 'M12 3v12M7.5 10.5L12 15l4.5-4.5M5 15v5h14v-5',
  'thumb-down': 'M8 14V4h9.5a2 2 0 0 1 2 1.6l1.2 6a2 2 0 0 1-2 2.4H14l.7 3.6a2 2 0 0 1-3.6 1.5zM8 14H4V4h4',
};
export function icon(name, size = 20) {
  return svg('svg', {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', class: 'icon',
  }, svg('path', { d: ICONS[name] || '' }));
}

/** Attend `ms` millisecondes de calme avant d'appeler fn (pour la recherche). */
export function debounce(fn, ms) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/** « Amélie » → « amelie » : minuscules, sans accents, pour comparer des titres. */
export function normalize(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Retire les balises HTML d'un résumé (TVMaze renvoie du HTML). */
export function stripHtml(html) {
  if (!html) return '';
  return decodeEntities(
    String(html)
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  ).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Décode les entités HTML courantes (&amp; &#39; …) sans passer par le DOM. */
export function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => named[name.toLowerCase()] ?? m);
}

/** Empreinte SHA-256 d'un texte (clé du cache de traduction). */
export async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * fetch + JSON avec délai maximum. Lève une erreur claire si la source ne
 * répond pas ; c'est à l'appelant d'afficher un message propre.
 */
export async function fetchJson(url, { signal, timeout = 12000, headers } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Délai dépassé', 'TimeoutError')), timeout);
  const onAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/** Vrai si l'erreur vient d'une annulation volontaire (nouvelle frappe, etc.). */
export function isAbort(error) {
  return error?.name === 'AbortError';
}

/** Date du jour au format AAAA-MM-JJ, à l'heure de Paris (quel que soit le réglage de l'appareil). */
export function todayISO() {
  // le format « en-CA » s'écrit justement AAAA-MM-JJ
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Décale une date AAAA-MM-JJ d'un nombre de jours (négatif = dans le passé). */
export function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** La veille, à l'heure de Paris. */
export function yesterdayISO() { return shiftDate(todayISO(), -1); }

/** « 2024-03-09 » → « 9 mars 2024 » (short : mois abrégé, « 9 oct. 2024 »). */
export function formatDate(iso, { short = false } = {}) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: short ? 'short' : 'long', year: 'numeric' })
    .format(new Date(y, m - 1, d));
}

/** 148 → « 2 h 28 » ; 45 → « 45 min ». */
export function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return '';
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} h`;
}

/**
 * Temps de visionnage : « 45 min », « 12 h 35 min », ou « 3 j 4 h » au-delà
 * de deux jours (plus parlant que « 76 h »).
 */
export function formatTime(minutes) {
  const total = Math.round(minutes || 0);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours < 48) return rest ? `${hours} h ${String(rest).padStart(2, '0')} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} j ${hours % 24} h` : `${days} j`;
}

/** Initiales d'un nom (« Bryan Cranston » → « BC ») pour les avatars sans photo. */
export function initials(name) {
  return String(name || '?').split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toLocaleUpperCase('fr')).join('');
}

/** Nombre au format français (4,2). */
export function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** Code pays « US » → « États-Unis ». */
export function countryName(code, fallback = '') {
  try {
    return new Intl.DisplayNames(['fr'], { type: 'region' }).of(code.toUpperCase()) || fallback;
  } catch {
    return fallback;
  }
}

/** Met une majuscule au début. */
export function capitalize(text) {
  const s = String(text || '').trim();
  return s ? s[0].toLocaleUpperCase('fr') + s.slice(1) : s;
}

// ---------------------------------------------------------------------------
//  Notifications discrètes en bas de l'écran
// ---------------------------------------------------------------------------
let toastTimer;
export function toast(message, kind = 'info') {
  let box = document.getElementById('toast');
  if (!box) {
    box = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  box.textContent = message;
  box.className = `toast toast--${kind} is-visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('is-visible'), kind === 'error' ? 5000 : 2600);
}
