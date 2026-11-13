// ============================================================================
//  Page « Réglages » : apparence (thèmes de couleurs, couleur personnalisée,
//  mode sombre / clair / automatique). Tout change en direct, sans recharger.
//  Le thème est gardé dans ce navigateur et, si la migration V3 est en place,
//  dans Supabase pour le retrouver sur tous les appareils.
// ============================================================================
import { h, icon, toast } from '../utils.js';
import { state, saveSettings } from '../store.js';
import { pageHeader } from '../ui/cards.js';
import { logo } from '../ui/logo.js';

const STAR = 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z';
let saveTimer = null;

/** Enregistre le thème dans Supabase, un instant après le dernier changement. */
function syncRemote(theme) {
  clearTimeout(saveTimer);
  if (!state.v3) return;
  saveTimer = setTimeout(() => {
    saveSettings(theme).catch((error) => {
      console.warn('[Réglages] thème non enregistré en ligne :', error.message);
      toast('Thème gardé sur cet appareil ; pas encore enregistré en ligne (connexion ?).', 'error');
    });
  }, 600);
}

/** Change de thème (aperçu immédiat) et l'enregistre. */
export function chooseTheme(patch) {
  const theme = window.MCTheme.set({ ...window.MCTheme.get(), ...patch });
  syncRemote(theme);
  return theme;
}

/** Mini-carte d'aperçu (logo, étoiles, bouton) dessinée avec la palette d'un thème. */
function preview(theme) {
  const p = window.MCTheme.palette(window.MCTheme.normalize(theme), window.MCTheme.resolvedMode());
  const style = Object.fromEntries(Object.entries(p).map(([k, v]) => [`--${k}`, v]));
  const star = (on) => h('span', { class: `swatch__star${on ? ' is-on' : ''}` },
    (() => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', STAR); s.append(path); return s; })());
  const card = h('span', { class: 'swatch__card', 'aria-hidden': 'true' },
    h('span', { class: 'swatch__logo' }, logo(16)),
    h('span', { class: 'swatch__stars' }, star(true), star(true), star(true), star(false)),
    h('span', { class: 'swatch__btn' }, 'Noter'));
  Object.entries(style).forEach(([k, v]) => card.style.setProperty(k, v));
  return card;
}

export function renderSettings(root) {
  const T = window.MCTheme;
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Thème de couleurs' });
  const custom = h('input', { type: 'color', class: 'color-input', 'aria-label': 'Choisir une couleur personnalisée' });
  const hex = h('input', { class: 'input input--hex', type: 'text', inputmode: 'text', maxlength: 7, placeholder: '#9ABAE6', 'aria-label': 'Code hexadécimal (facultatif)', autocapitalize: 'off', spellcheck: 'false' });
  const customCard = h('label', { class: 'swatch swatch--custom' });
  const modes = [['dark', 'Sombre'], ['light', 'Clair'], ['auto', 'Automatique']].map(([value, label]) =>
    h('button', { class: 'segmented__btn', type: 'button', dataset: { mode: value }, onClick: () => { chooseTheme({ mode: value }); paint(); } }, label));

  function paint() {
    const theme = T.get();
    swatches.replaceChildren(...T.PRESETS.map((preset) => h('button', {
      class: 'swatch', type: 'button', role: 'radio', 'aria-checked': String(theme.preset === preset.id),
      'aria-label': preset.name, dataset: { preset: preset.id },
      onClick: () => { chooseTheme({ preset: preset.id }); paint(); },
    }, preview({ preset: preset.id }), h('span', { class: 'swatch__name' }, preset.name), theme.preset === preset.id && h('span', { class: 'swatch__check' }, icon('check', 14)))));
    custom.value = theme.accent.toLowerCase();
    if (document.activeElement !== hex) hex.value = theme.accent.toUpperCase();
    customCard.replaceChildren(preview({ preset: 'custom', accent: theme.accent }),
      h('span', { class: 'swatch__name' }, 'Personnalisée'),
      ...(theme.preset === 'custom' ? [h('span', { class: 'swatch__check' }, icon('check', 14))] : []),
      custom);
    customCard.setAttribute('aria-checked', String(theme.preset === 'custom'));
    modes.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === theme.mode)));
  }

  // couleur personnalisée : la roue / palette du téléphone, ou un code hexadécimal
  custom.addEventListener('input', () => { chooseTheme({ preset: 'custom', accent: custom.value }); paint(); });
  hex.addEventListener('input', () => {
    const value = hex.value.trim().replace(/^([0-9a-f])/i, '#$1');
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) { chooseTheme({ preset: 'custom', accent: value }); paint(); }
  });

  const reset = h('button', { class: 'btn', type: 'button', onClick: () => { chooseTheme(T.DEFAULT); paint(); toast('Thème Bleu givré rétabli'); } }, icon('refresh', 16), 'Réinitialiser');

  root.replaceChildren(
    pageHeader('Réglages'),
    h('section', { class: 'panel' },
      h('h2', { class: 'panel__title' }, 'Apparence'),
      h('p', { class: 'panel__sub' }, 'Touche un thème : le site change tout de suite. Ton choix est gardé sur tous tes appareils.'),
      h('h3', { class: 'field__label settings__label' }, 'Thème'),
      swatches,
      h('h3', { class: 'field__label settings__label' }, 'Couleur personnalisée'),
      h('div', { class: 'settings__custom' }, customCard, h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Code (facultatif)'), hex)),
      h('h3', { class: 'field__label settings__label' }, 'Mode'),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Mode d’affichage' }, modes),
      h('p', { class: 'muted settings__hint' }, 'Automatique : suit le réglage clair / sombre de ton téléphone ou de ton ordinateur.'),
      h('div', { class: 'settings__actions' }, reset)),
    ...(state.v3 ? [] : [h('div', { class: 'banner' },
      h('p', {}, h('strong', {}, 'Thème gardé sur cet appareil seulement.')),
      h('p', {}, 'Pour le retrouver sur tous tes appareils, colle le fichier supabase/migration_v3.sql dans Supabase (voir le README).'))]));
  paint();
  return () => {};
}

/**
 * À la connexion : le thème enregistré en ligne l'emporte (pour retrouver le
 * même sur tous les appareils). Sans thème en ligne, on garde celui de cet appareil.
 */
export function applyRemoteTheme() {
  const remote = state.settings?.theme;
  if (remote && remote.preset) {
    const current = window.MCTheme.get();
    const next = window.MCTheme.normalize(remote);
    if (JSON.stringify(current) !== JSON.stringify(next)) window.MCTheme.set(next);
  }
}
