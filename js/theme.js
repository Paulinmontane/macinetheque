// ============================================================================
//  Thèmes de couleurs (« Bleu givré » par défaut) — script classique, chargé
//  dans le <head> AVANT l'affichage de la page : la bonne couleur est posée
//  dès le premier dessin, sans flash de l'ancienne.
//
//  Toutes les couleurs du site sont des variables CSS (--bg, --surface,
//  --accent…). Ce fichier les calcule à partir d'une couleur d'accent :
//   - nuances de l'accent (survol, pressé, texte lisible posé dessus) ;
//   - fonds, surfaces, bordures et textes légèrement teintés dans la même
//     couleur ;
//   - mode sombre ou clair, avec un contraste lisible (WCAG AA) garanti.
//
//  Le thème choisi est gardé dans ce navigateur (localStorage) et, une fois
//  connecté, dans Supabase pour le retrouver sur tous les appareils.
//  Utilisable ensuite par le reste du site via window.MCTheme.
// ============================================================================
(function () {
  'use strict';

  var STORAGE_KEY = 'macinetheque:theme';

  // ---- thèmes prédéfinis -----------------------------------------------------
  var PRESETS = [
    { id: 'givre', name: 'Bleu givré', accent: '#9ABAE6' },
    { id: 'acier', name: 'Bleu acier', accent: '#84AFE9' },
    { id: 'argent-bleute', name: 'Argent bleuté', accent: '#AFC4E3' },
    { id: 'duo', name: 'Argent + glacier', accent: '#5B9BF0', logo: '#D8D8DC', title: '#D8D8DC' },
    { id: 'glacier', name: 'Bleu glacier', accent: '#5B9BF0' },
    { id: 'argent', name: 'Argent', accent: '#D8D8DC' },
    { id: 'ambre', name: 'Ambre', accent: '#E8B04B' },
    { id: 'rouge', name: 'Rouge cinéma', accent: '#E5484D' },
    { id: 'sauge', name: 'Vert sauge', accent: '#6FBF8E' },
    { id: 'violet', name: 'Violet nuit', accent: '#9B7BF0' },
  ];
  var DEFAULT = { preset: 'givre', accent: '#9ABAE6', mode: 'dark' };

  // Palette sombre exacte du « Bleu givré » (les autres sont calculées)
  var GIVRE_DARK = {
    bg: '#0D1015', surface: '#151A21', 'surface-2': '#1C222B', line: '#262E39',
    text: '#E8EEF6', muted: '#8B97A8', accent: '#9ABAE6', 'accent-strong': '#B3CBEE',
    'accent-press': '#84A6D6', 'accent-ink': '#0D1015', 'star-empty': '#2E3642',
    success: '#7FC8A9', danger: '#E07A7A',
  };

  // ---- petites fonctions de couleur -----------------------------------------
  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    var h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbToHex(rgb) {
    return '#' + rgb.map(function (v) { return Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0'); }).join('').toUpperCase();
  }
  function rgbToHsl(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hsl(h, s, l) {
    s = Math.min(1, Math.max(0, s)); l = Math.min(1, Math.max(0, l));
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2, rgb;
    if (h < 60) rgb = [c, x, 0]; else if (h < 120) rgb = [x, c, 0]; else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c]; else if (h < 300) rgb = [x, 0, c]; else rgb = [c, 0, x];
    return rgbToHex(rgb.map(function (v) { return (v + m) * 255; }));
  }
  function mix(a, b, amount) { // amount = part de b
    var x = hexToRgb(a), y = hexToRgb(b);
    return rgbToHex(x.map(function (v, i) { return v + (y[i] - v) * amount; }));
  }
  function luminance(hex) {
    var rgb = hexToRgb(hex).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }
  function contrast(a, b) {
    var x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  /** Éclaircit (fond sombre) ou fonce (fond clair) une couleur jusqu'au contraste voulu. */
  function ensureContrast(color, against, ratio) {
    var towards = luminance(against) < 0.2 ? '#FFFFFF' : '#000000';
    var c = color;
    for (var i = 1; i <= 20 && contrast(c, against) < ratio; i += 1) c = mix(color, towards, i * 0.05);
    return c;
  }
  function rgba(hex, alpha) {
    var rgb = hexToRgb(hex);
    return 'rgba(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ', ' + alpha + ')';
  }

  // ---- calcul d'une palette ------------------------------------------------
  function presetOf(theme) {
    for (var i = 0; i < PRESETS.length; i += 1) if (PRESETS[i].id === theme.preset) return PRESETS[i];
    return null;
  }
  function accentOf(theme) {
    var preset = presetOf(theme);
    return (preset && preset.accent) || (hexToRgb(theme.accent) ? rgbToHex(hexToRgb(theme.accent)) : DEFAULT.accent);
  }

  /** Toutes les variables CSS d'un thème dans un mode ('dark' ou 'light'). */
  function palette(theme, mode) {
    var preset = presetOf(theme) || {};
    var accent = accentOf(theme);
    var hs = rgbToHsl(hexToRgb(accent));
    var h = hs[0];
    var ts = Math.min(hs[1] * 0.4, 0.24); // teinte des fonds : légère, jamais criarde
    var p = {};
    if (mode === 'light') {
      p.bg = hsl(h, ts * 1.1, 0.965);
      p.surface = hsl(h, ts * 0.8, 0.995);
      p['surface-2'] = hsl(h, ts * 1.1, 0.935);
      p.line = hsl(h, ts * 0.9, 0.86);
      p['line-strong'] = hsl(h, ts * 0.9, 0.76);
      p['star-empty'] = hsl(h, ts * 0.8, 0.82);
      p.text = hsl(h, ts * 1.2, 0.11);
      p.muted = ensureContrast(hsl(h, ts * 0.8, 0.38), p.bg, 5);
      p.faint = ensureContrast(hsl(h, ts * 0.6, 0.45), p.bg, 4.6);
      p.accent = ensureContrast(ensureContrast(accent, p.bg, 3), p['surface-2'], 2.6); // étoiles, boutons : visibles sur fond clair
      p['accent-text'] = ensureContrast(accent, p.bg, 4.6); // liens, onglet actif : lisibles
      p['accent-strong'] = mix(p.accent, '#000000', 0.1);
      p['accent-press'] = mix(p.accent, '#000000', 0.2);
      p.success = '#2E7D5B';
      p.danger = '#B83B44';
      p.overlay = rgba(p.bg, 0.88);
      p['overlay-strong'] = rgba(p.surface, 0.94);
      p.scrim = rgba(hsl(h, ts, 0.92), 0.82);
      p.shimmer = 'rgba(0, 0, 0, 0.04)';
      p['shadow-color'] = rgba(hsl(h, 0.3, 0.2), 0.14);
      p.scheme = 'light';
    } else {
      var base = theme.preset === 'givre' ? GIVRE_DARK : null;
      p.bg = base ? base.bg : hsl(h, ts, 0.07);
      p.surface = base ? base.surface : hsl(h, ts * 0.92, 0.105);
      p['surface-2'] = base ? base['surface-2'] : hsl(h, ts * 0.88, 0.14);
      p.line = base ? base.line : hsl(h, ts * 0.83, 0.19);
      p['line-strong'] = hsl(h, ts * 0.8, 0.26);
      p['star-empty'] = base ? base['star-empty'] : hsl(h, ts * 0.75, 0.22);
      p.text = base ? base.text : hsl(h, Math.min(ts * 2, 0.47), 0.94);
      p.muted = base ? base.muted : ensureContrast(hsl(h, ts * 0.6, 0.6), p.bg, 6);
      p.faint = ensureContrast(hsl(h, ts * 0.5, 0.52), p.surface, 4.6);
      // la couleur choisie est gardée telle quelle si elle se voit (≥ 3:1) ;
      // pour du texte, une version un peu éclaircie si besoin (≥ 4,5:1)
      p.accent = base ? base.accent : ensureContrast(accent, p.surface, 3);
      p['accent-text'] = base ? base.accent : ensureContrast(p.accent, p.surface, 4.6);
      p['accent-strong'] = base ? base['accent-strong'] : mix(p.accent, '#FFFFFF', 0.25);
      p['accent-press'] = base ? base['accent-press'] : mix(p.accent, '#000000', 0.14);
      p.success = '#7FC8A9';
      p.danger = '#E07A7A';
      p.overlay = rgba(p.bg, 0.86);
      p['overlay-strong'] = rgba(p.bg, 0.92);
      p.scrim = rgba(mix(p.bg, '#000000', 0.3), 0.8);
      p.shimmer = 'rgba(255, 255, 255, 0.05)';
      p['shadow-color'] = 'rgba(0, 0, 0, 0.45)';
      p.scheme = 'dark';
    }
    // texte posé sur l'accent (boutons) : sombre ou blanc, le plus lisible des deux
    var dark = mode === 'light' ? hsl(h, ts * 1.2, 0.1) : p.bg;
    p['accent-ink'] = contrast(dark, p.accent) >= contrast('#FFFFFF', p.accent) ? dark : '#FFFFFF';
    if (contrast(p['accent-ink'], p.accent) < 4.5) {
      // couleur « moyenne » (ni claire ni foncée) : on l'ajuste juste assez pour que le texte du bouton reste lisible
      p.accent = ensureContrast(p.accent, p['accent-ink'], 4.5);
      p['accent-strong'] = mix(p.accent, mode === 'light' ? '#000000' : '#FFFFFF', 0.1);
      p['accent-press'] = mix(p.accent, '#000000', 0.15);
    }
    p['accent-soft'] = rgba(p.accent, mode === 'light' ? 0.12 : 0.14);
    p['accent-line'] = rgba(p.accent, 0.45);
    // logo et titres (le thème « Argent + glacier » les met en argent)
    p.logo = ensureContrast(preset.logo || p.accent, p.bg, 3);
    p.title = ensureContrast(preset.title || p.text, p.bg, 7);
    return p;
  }

  // ---- lecture / application ----------------------------------------------
  function normalize(theme) {
    theme = theme && typeof theme === 'object' ? theme : {};
    var out = {
      preset: theme.preset === 'custom' || presetOf(theme) ? theme.preset : DEFAULT.preset,
      accent: hexToRgb(theme.accent) ? rgbToHex(hexToRgb(theme.accent)) : DEFAULT.accent,
      mode: theme.mode === 'light' || theme.mode === 'auto' ? theme.mode : 'dark',
    };
    if (out.preset !== 'custom') out.accent = accentOf(out);
    return out;
  }
  function stored() {
    try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || DEFAULT); } catch (e) { return normalize(DEFAULT); }
  }
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function resolvedMode(theme) {
    if (theme.mode === 'auto') return media && media.matches ? 'light' : 'dark';
    return theme.mode;
  }

  var current = stored();
  var listeners = [];

  function apply(theme) {
    var mode = resolvedMode(theme);
    var p = palette(theme, mode);
    var root = document.documentElement;
    Object.keys(p).forEach(function (key) { root.style.setProperty('--' + key, p[key]); });
    root.setAttribute('data-mode', mode);
    root.style.colorScheme = mode;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', p.bg);
    var scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute('content', mode);
  }

  /** Change de thème : appliqué tout de suite ; `persist` = garder dans ce navigateur. */
  function set(theme, options) {
    current = normalize(theme);
    apply(current);
    if (!options || options.persist !== false) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch (e) { /* navigation privée */ }
    }
    listeners.forEach(function (fn) { try { fn(current); } catch (e) { /* un écouteur fautif ne bloque pas les autres */ } });
    return current;
  }

  // mode « Automatique » : suit le réglage de l'appareil, même en cours de visite
  if (media) {
    var follow = function () { if (current.mode === 'auto') apply(current); };
    if (media.addEventListener) media.addEventListener('change', follow); else if (media.addListener) media.addListener(follow);
  }

  apply(current); // ← avant le premier affichage

  window.MCTheme = {
    PRESETS: PRESETS,
    DEFAULT: normalize(DEFAULT),
    get: function () { return current; },
    set: set,
    reset: function () { return set(DEFAULT); },
    palette: palette,
    resolvedMode: function () { return resolvedMode(current); },
    normalize: normalize,
    contrast: contrast,
    onChange: function (fn) { listeners.push(fn); },
  };
})();
