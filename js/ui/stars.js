// ============================================================================
//  Étoiles de notation (1 à 5, étoiles entières).
// ============================================================================
import { h, svg } from '../utils.js';

const STAR_PATH = 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z';

function star() {
  return svg('svg', { viewBox: '0 0 24 24', class: 'star__shape', 'aria-hidden': 'true' },
    svg('path', { d: STAR_PATH }));
}

/**
 * Étoiles cliquables.
 *   value    : note actuelle (1-5) ou null
 *   onChange : appelée avec la nouvelle note quand on clique
 *   label    : texte lu par les lecteurs d'écran (« Note du film »…)
 * Clavier : flèches gauche/droite pour changer la note.
 */
export function starInput({ value = null, onChange, label = 'Note', size = 'md' }) {
  let current = value;
  const group = h('div', { class: `stars stars--input stars--${size}`, role: 'radiogroup', 'aria-label': label });

  const buttons = [1, 2, 3, 4, 5].map((n) => h('button', {
    type: 'button', class: 'star', role: 'radio', 'aria-label': `${n} étoile${n > 1 ? 's' : ''} sur 5`,
    onClick: () => choose(n),
    onMouseenter: () => paint(n, true),
    onFocus: () => paint(n, true),
    onBlur: () => paint(current, false),
  }, star()));

  function paint(level, preview) {
    buttons.forEach((button, index) => {
      button.classList.toggle('is-on', index < (level || 0));
      button.setAttribute('aria-checked', String(index + 1 === current));
      button.tabIndex = index + 1 === (current || 1) ? 0 : -1;
    });
    group.classList.toggle('is-preview', !!preview);
  }

  function choose(n) {
    current = n;
    paint(n, false);
    // petite animation de confirmation sur l'étoile choisie
    const chosen = buttons[n - 1];
    chosen.classList.remove('is-pop');
    void chosen.offsetWidth;
    chosen.classList.add('is-pop');
    onChange?.(n);
  }

  group.addEventListener('mouseleave', () => paint(current, false));
  group.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = Math.min(5, Math.max(1, (current || 0) + step));
    choose(next);
    buttons[next - 1].focus();
  });

  group.append(...buttons);
  paint(current, false);
  /** Permet de mettre la note à jour depuis l'extérieur. */
  group.setValue = (v) => { current = v; paint(v, false); };
  return group;
}

/** Étoiles en simple affichage (non cliquables). */
export function starDisplay(value, size = 'sm') {
  const rounded = Math.round(value || 0);
  return h('span', { class: `stars stars--${size}`, role: 'img', 'aria-label': `${rounded} sur 5` },
    [1, 2, 3, 4, 5].map((n) => h('span', { class: `star${n <= rounded ? ' is-on' : ''}` }, star())));
}
