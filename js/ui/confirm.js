// ============================================================================
//  Confirmation d'enregistrement « en grand ».
//
//  Un voile sombre recouvre la page ; au centre, une coche qui se dessine,
//  « Note enregistrée », le titre de l'œuvre et la note en grandes étoiles.
//  L'écran disparaît tout seul (ou d'un simple appui n'importe où).
//  En cas d'échec : même écran avec une croix et un bouton « Réessayer ».
//
//  Les animations sont décrites dans css/style.css (section « confirmation »)
//  et réduites à un simple fondu si le système demande moins d'animations.
// ============================================================================
import { h, svg } from '../utils.js';
import { logo } from './logo.js';

const STAR_PATH = 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z';
const FADE_MS = 250; // durée du fondu d'apparition / de disparition
const HOLD_MS = 1200; // temps d'affichage d'une note enregistrée
const HOLD_SHORT_MS = 800; // … et d'une action secondaire (liste à voir, refus…)

let current = null; // écran affiché en ce moment : { node, timer, onKey }

function close(immediate = false) {
  if (!current) return;
  const { node, timer, onKey } = current;
  current = null;
  clearTimeout(timer);
  document.removeEventListener('keydown', onKey);
  node.classList.remove('is-visible');
  if (immediate) node.remove();
  else setTimeout(() => node.remove(), FADE_MS);
}

function open(node, { hold = null } = {}) {
  close(true); // un seul écran à la fois : le nouveau remplace l'ancien
  document.body.append(node);
  const onKey = (event) => { if (event.key === 'Escape' || event.key === 'Enter') close(); };
  document.addEventListener('keydown', onKey);
  current = { node, onKey, timer: hold ? setTimeout(() => close(), FADE_MS + hold) : null };
  // l'apparition se fait à l'image suivante, pour que la transition CSS joue
  requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('is-visible')));
}

function mark(kind) {
  return svg('svg', { class: `confirm__mark confirm__mark--${kind}`, viewBox: '0 0 52 52', 'aria-hidden': 'true' },
    svg('circle', { class: 'confirm__ring', cx: 26, cy: 26, r: 23 }),
    kind === 'ok'
      ? svg('path', { class: 'confirm__draw', d: 'M15 27l7.5 7.5L37.5 19' })
      : svg('path', { class: 'confirm__draw', d: 'M18 18l16 16M34 18L18 34' }));
}

/**
 * Écran de succès.
 *   label  : phrase principale (« Note enregistrée » par défaut)
 *   title  : titre de l'œuvre
 *   detail : précision (« Saison 2 », « S02E05 »…)
 *   rating : note de 1 à 5 → affichée en grandes étoiles, une par une
 *   short  : version courte (~0,8 s) pour les actions secondaires
 */
export function showSaved({ label = 'Note enregistrée', title = '', detail = '', rating = null, short = false } = {}) {
  const stars = rating
    ? h('div', { class: 'confirm__stars', role: 'img', 'aria-label': `${rating} sur 5` },
      [1, 2, 3, 4, 5].map((n) => svg('svg', {
        class: `confirm__star${n <= rating ? ' is-on' : ''}`, viewBox: '0 0 24 24', style: `--i:${n - 1}`, 'aria-hidden': 'true',
      }, svg('path', { d: STAR_PATH }))))
    : null;
  const node = h('div', { class: `confirm${short ? ' confirm--short' : ''}`, role: 'status', 'aria-live': 'assertive' },
    h('div', { class: 'confirm__box' },
      !short && h('div', { class: 'confirm__logo' }, logo(22)),
      mark('ok'),
      h('p', { class: 'confirm__label' }, label),
      title && h('p', { class: 'confirm__title' }, title),
      detail && h('p', { class: 'confirm__detail' }, detail),
      stars));
  node.addEventListener('click', () => close()); // un appui n'importe où ferme l'écran
  open(node, { hold: short ? HOLD_SHORT_MS : HOLD_MS });
}

/**
 * Écran d'échec : reste affiché jusqu'à ce qu'on choisisse.
 *   onRetry : fonction qui relance l'envoi (ce qui a été saisi n'est pas perdu)
 */
export function showFailed({ message = '', onRetry = null } = {}) {
  const retry = h('button', { class: 'btn btn--primary', type: 'button' }, 'Réessayer');
  const cancel = h('button', { class: 'btn', type: 'button' }, 'Fermer');
  const node = h('div', { class: 'confirm confirm--error', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Échec de l’enregistrement' },
    h('div', { class: 'confirm__box' },
      mark('error'),
      h('p', { class: 'confirm__label' }, 'Échec de l’enregistrement'),
      h('p', { class: 'confirm__detail' }, message || 'Vérifie ta connexion internet. Ce que tu as saisi n’est pas perdu.'),
      h('div', { class: 'confirm__actions' }, onRetry ? retry : null, cancel)));
  retry.addEventListener('click', (event) => { event.stopPropagation(); close(true); onRetry?.(); });
  cancel.addEventListener('click', (event) => { event.stopPropagation(); close(); });
  node.addEventListener('click', (event) => { if (event.target === node) close(); });
  open(node);
  (onRetry ? retry : cancel).focus({ preventScroll: true });
}

/** « Saison 2 », « S02E05 » : précision affichée sous le titre. */
export function levelLabel(season, episode) {
  if (season == null) return '';
  if (episode == null) return `Saison ${season}`;
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}
