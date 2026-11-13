// ============================================================================
//  Import d'historique (Netflix, Prime Video) — lecture des fichiers.
//  Module « pur » : aucun accès réseau, testable seul.
//
//  Formats reconnus :
//   - Netflix : fichier NetflixViewingHistory.csv (« Title,Date »), téléchargé
//     depuis netflix.com/viewingactivity → « Télécharger tout » ;
//   - Prime Video : texte de la page « Historique de visionnage » (copié par le
//     bouton-favori du site, ou sélectionné et collé à la main) ;
//   - tout fichier CSV avec une colonne titre et une colonne date (export de
//     données Amazon, autre service…). Saison / épisode si présents.
//
//  Résultat : une liste d'œuvres regroupées, prêtes à être retrouvées dans le
//  catalogue (js/import/match.js).
// ============================================================================

import { normalize } from '../utils.js';

/** Clé de comparaison d'un titre : sans accents, majuscules ni ponctuation. */
export const titleKey = (text) => normalize(text).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

const MONTHS = {
  janvier: 1, janv: 1, january: 1, jan: 1, février: 2, fevrier: 2, févr: 2, fevr: 2, fév: 2, fev: 2, february: 2, feb: 2,
  mars: 3, march: 3, mar: 3, avril: 4, avr: 4, april: 4, apr: 4, mai: 5, may: 5, juin: 6, june: 6, jun: 6,
  juillet: 7, juil: 7, july: 7, jul: 7, août: 8, aout: 8, august: 8, aug: 8, septembre: 9, sept: 9, september: 9, sep: 9,
  octobre: 10, oct: 10, october: 10, novembre: 11, nov: 11, november: 11, décembre: 12, decembre: 12, déc: 12, dec: 12, december: 12,
};

// ---------------------------------------------------------------------------
//  CSV
// ---------------------------------------------------------------------------
/** Lit un texte CSV (guillemets, virgules ou points-virgules). Renvoie un tableau de lignes. */
export function parseCSV(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';'
    : (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((v) => v.replace(/^﻿/, '').trim())).filter((r) => r.some(Boolean));
}

// ---------------------------------------------------------------------------
//  Dates
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => {
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1950 && y <= 2100)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/**
 * Ordre des dates chiffrées d'un fichier : « 13/11/2026 » (jour d'abord, en France)
 * ou « 11/13/26 » (mois d'abord, Netflix en anglais). On regarde toutes les dates :
 * un premier nombre > 12 → jour d'abord ; un second > 12 → mois d'abord.
 */
export function detectDayFirst(values) {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const v of values) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(v || '');
    if (!m) continue;
    if (Number(m[1]) > 12) dayFirst += 1;
    if (Number(m[2]) > 12) monthFirst += 1;
  }
  return monthFirst > dayFirst ? false : true; // par défaut : à la française
}

/** Convertit une date écrite (chiffres ou mois en lettres, français ou anglais) en AAAA-MM-JJ. */
export function parseDate(value, dayFirst = true) {
  const v = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!v) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); // 2026-11-13 ou 2026-11-13T20:15:00Z
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(v);
  if (m) return dayFirst ? iso(Number(m[3]), Number(m[2]), Number(m[1])) : iso(Number(m[3]), Number(m[1]), Number(m[2]));
  // « vendredi 13 novembre 2026 », « 13 nov. 2026 », « 1er mars 2025 »
  m = /^(?:[a-zéû]+\.?,? )?(\d{1,2})(?:er)? ([a-zéûô]+)\.? (\d{4})$/.exec(v);
  if (m && MONTHS[m[2]]) return iso(Number(m[3]), MONTHS[m[2]], Number(m[1]));
  // « November 13, 2026 », « Friday, Nov 13, 2026 »
  m = /^(?:[a-z]+,? )?([a-z]+)\.? (\d{1,2}),? (\d{4})$/.exec(v);
  if (m && MONTHS[m[1]]) return iso(Number(m[3]), MONTHS[m[1]], Number(m[2]));
  return null;
}

// ---------------------------------------------------------------------------
//  Titres : « Breaking Bad : Saison 1 : Pilote » → série, saison, épisode
// ---------------------------------------------------------------------------
const WORD_NUMBERS = {
  un: 1, une: 1, one: 1, deux: 2, two: 2, trois: 3, three: 3, quatre: 4, four: 4, cinq: 5, five: 5, six: 6, sept: 7, seven: 7,
  huit: 8, eight: 8, neuf: 9, nine: 9, dix: 10, ten: 10, onze: 11, eleven: 11, douze: 12, twelve: 12, treize: 13, thirteen: 13,
  quatorze: 14, fourteen: 14, quinze: 15, fifteen: 15, seize: 16, sixteen: 16,
};
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const toNumber = (text) => {
  if (text == null || text === '') return null;
  const t = String(text).toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return ROMAN[t] || WORD_NUMBERS[t] || null;
};

// partie qui désigne une saison : « Saison 2 », « Season 2 », « Partie 1 », « Mini-série »…
const SEASON_PART = /^(saison|season|temporada|staffel|partie|part|volume|vol\.?|livre|book|collection|chapitre|chapter)\s*([0-9]+|[ivx]+)?$/i;
const LIMITED_PART = /^(mini-?s[ée]ries?|s[ée]rie limit[ée]e|limited series)$/i;
// épisode désigné par son numéro : « Épisode 3 », « Chapitre trois », « Chapter One »
const EPISODE_NUMBER = /^(?:[ée]pisode|ep\.?|[ée]p\.?|chapitre|chapter|cap[ií]tulo|folge|partie|part)\s+([0-9]+|[a-zé]+)\b/i;

/**
 * Découpe un titre Netflix. Renvoie { show, season, episodeTitle, episodeNumber }
 * pour un épisode, ou { show: titre, season: null } si ce n'est pas un épisode.
 */
export function splitTitle(raw) {
  const title = String(raw || '').replace(/ | /g, ' ').replace(/\s+/g, ' ').trim();
  const parts = title.split(/\s*:\s+|\s+:\s*/).filter(Boolean); // « : » entouré d'au moins un espace
  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i];
    const show = parts.slice(0, i).join(': ');
    const rest = parts.slice(i + 1).join(': ');
    let season = null;
    const s = SEASON_PART.exec(part);
    if (s) season = toNumber(s[2]) || 1;
    else if (LIMITED_PART.test(part)) season = 1;
    else {
      // « Stranger Things: Stranger Things 2: … » : le nom de la série suivi d'un numéro
      const named = new RegExp(`^${show.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+([0-9]+)$`, 'i').exec(part);
      if (named) season = Number(named[1]);
    }
    if (season != null) {
      // « Harry Potter … : Partie 2 » sans rien après : c'est un film en deux parties
      if (!rest && /^(partie|part|chapitre|chapter|volume|vol|livre|book)/i.test(part)) return { show: title, season: null };
      return { show, season, episodeTitle: rest || null, episodeNumber: rest ? episodeNumberOf(rest) : null };
    }
  }
  // « Une série : Épisode 4 » (pas de saison indiquée → saison 1)
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const n = episodeNumberOf(last);
    if (n != null && /^([ée]pisode|ep\.?|[ée]p\.?)\b/i.test(last)) return { show: parts.slice(0, -1).join(': '), season: 1, episodeTitle: last, episodeNumber: n };
  }
  // « The Boys - Season 4 » / « The Boys – Saison 4 » (export Amazon)
  const dash = /^(.+?)\s+[-–—]\s+(saison|season)\s+(\d+)$/i.exec(title);
  if (dash) return { show: dash[1], season: Number(dash[3]), episodeTitle: null, episodeNumber: null };
  return { show: title, season: null };
}

export function episodeNumberOf(text) {
  const m = EPISODE_NUMBER.exec(String(text || '').trim());
  return m ? toNumber(m[1]) : null;
}

// ---------------------------------------------------------------------------
//  Texte de la page « Historique de visionnage » de Prime Video
// ---------------------------------------------------------------------------
const NOISE = /^(supprimer|retirer|remove|delete|effacer|masquer|hide|afficher|show|voir|view|see|regarder|watch|reprendre|resume|lecture|play|plus|more|charger|load|filtrer|filter|trier|sort|tout|all|paramètres|settings|compte|account|profil|profile|historique|history|vidéos|videos|les vidéos|the videos|épisodes? (regardés?|vus?|visionnés?)|episodes? (watched|viewed))\b/i;
const FOOTER = /^(©|conditions|aide|help|terms|privacy|confidentialité|cookies|retour en haut|back to top|haut de page|mentions|contact)/i;
const EPISODE_LINE = /^(?:saison|season|s)\s*(\d+)\s*[,.:·|\-–—]?\s*(?:[ée]pisode|episode|[ée]p\.?|ep\.?|e)\s*(\d+)\s*(?:[:.\-–—]\s*(.*))?$/i;
const EPISODE_ONLY = /^(?:[ée]pisode|episode|[ée]p\.?|ep\.?)\s*(\d+)\s*(?:[:.\-–—]\s*(.*))?$/i;
const SEASON_LINE = /^(?:saison|season)\s*(\d+)$/i;

/**
 * Lit le texte de la page Prime Video : une date, puis les titres regardés ce
 * jour-là (avec leurs épisodes s'il y en a). Les boutons et menus de la page
 * (« Supprimer… », « Voir les épisodes »…) sont ignorés.
 * Renvoie des visionnages [{ title, date, season, episode, episodeTitle }].
 */
export function parsePrimeText(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.replace(/ /g, ' ').trim()).filter(Boolean);
  const out = [];
  let date = null;
  let current = null; // { title, season, hasEpisodes }
  const flush = () => {
    if (current && !current.hasEpisodes) out.push({ title: current.title, date, season: current.season, episode: null, episodeTitle: null });
  };
  for (const line of lines) {
    if (FOOTER.test(line)) break;
    const d = parseDate(line);
    if (d) { flush(); current = null; date = d; continue; }
    if (!date) continue; // menus et en-tête avant la première date
    let m = EPISODE_LINE.exec(line);
    if (m && current) { current.hasEpisodes = true; out.push({ title: current.title, date, season: Number(m[1]), episode: Number(m[2]), episodeTitle: m[3] || null }); continue; }
    m = EPISODE_ONLY.exec(line);
    if (m && current) { current.hasEpisodes = true; out.push({ title: current.title, date, season: current.season || 1, episode: Number(m[1]), episodeTitle: m[2] || null }); continue; }
    m = SEASON_LINE.exec(line);
    if (m && current) { current.season = Number(m[1]); continue; }
    if (NOISE.test(line) || line.length < 2 || /^\d+\s*(min|h|%)/i.test(line) || /^\d+ (épisodes?|episodes?)$/i.test(line)
      || /(de l'|from )(historique|watch history)/i.test(line)) continue;
    flush();
    // « The Boys - Saison 4 » écrit sur une seule ligne
    const split = splitTitle(line);
    current = { title: split.season != null ? split.show : line, season: split.season, hasEpisodes: false };
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
//  Détection du format et lecture
// ---------------------------------------------------------------------------
const COLUMN = {
  title: /^(title|titre|nom|name|show|programme|program|série|serie|film|movie|content|contenu)$/i,
  titleLoose: /(title|titre)/i,
  date: /(date|datetime|jour|day|watched|vu le|playback start|start|horodatage|timestamp)/i,
  season: /(season|saison)/i,
  episode: /^(episode|épisode|episode number|episode no|n° d'épisode|numéro d'épisode|ep)$/i,
  episodeTitle: /(episode (name|title)|titre (de l'|d')?épisode|nom de l'épisode)/i,
  seconds: /(seconds?|secondes?|duration|durée)/i,
};

/**
 * Lit un fichier ou un texte collé. Renvoie
 *   { format: 'netflix' | 'prime' | 'csv', platform, viewings: [{ title, date, season, episode, episodeTitle }], skipped }
 * ou lève une erreur avec un message clair.
 */
export function readHistory(text, { fileName = '' } = {}) {
  const raw = String(text || '').replace(/^﻿/, '');
  if (!raw.trim()) throw new Error('Le fichier est vide.');
  const firstLine = raw.split(/\r?\n/, 1)[0].trim();

  // Texte copié depuis Prime Video (bouton-favori ou copier-coller de la page)
  const looksCsv = /[,;\t]/.test(firstLine) && parseCSV(raw.slice(0, 2000)).length > 1 && parseCSV(raw.slice(0, 2000))[0].length >= 2;
  if (/^MACINETHEQUE-PRIME/.test(firstLine) || !looksCsv) {
    const viewings = parsePrimeText(raw);
    if (!viewings.length) throw new Error('Aucun visionnage trouvé dans ce texte. Vérifie que tu as bien copié la page « Historique de visionnage » de Prime Video, ou choisis le fichier Netflix.');
    return { format: 'prime', platform: 'Prime Video', viewings, skipped: 0 };
  }

  const rows = parseCSV(raw);
  const header = rows[0].map((h) => h.trim());
  const body = rows.slice(1);
  const find = (re, not = []) => header.findIndex((h, i) => re.test(h) && !not.includes(i));
  let iTitle = find(COLUMN.title);
  if (iTitle < 0) iTitle = header.findIndex((h) => COLUMN.titleLoose.test(h) && !COLUMN.episodeTitle.test(h));
  const iDate = find(COLUMN.date, [iTitle]);
  if (iTitle < 0 || iDate < 0) throw new Error('Ce fichier n’a pas de colonne « titre » et « date » reconnaissable. Pour Netflix, choisis le fichier NetflixViewingHistory.csv.');
  const iSeason = find(COLUMN.season, [iTitle, iDate]);
  const iEpisode = find(COLUMN.episode, [iTitle, iDate, iSeason]);
  const iEpisodeTitle = find(COLUMN.episodeTitle, [iTitle, iDate, iSeason]);
  const iSeconds = find(COLUMN.seconds, [iTitle, iDate, iSeason, iEpisode, iEpisodeTitle]);
  const netflix = header.length === 2 && /^title$/i.test(header[0]) && /^date$/i.test(header[1]);
  const dayFirst = detectDayFirst(body.map((r) => r[iDate]));

  const viewings = [];
  let skipped = 0;
  for (const r of body) {
    const title = r[iTitle];
    const date = parseDate(r[iDate], dayFirst);
    if (!title) { skipped += 1; continue; }
    // export Amazon : les lectures de quelques secondes (bandes-annonces, essais) sont ignorées
    if (iSeconds >= 0 && Number(r[iSeconds]) > 0 && Number(r[iSeconds]) < 300) { skipped += 1; continue; }
    const season = iSeason >= 0 ? toNumber((r[iSeason] || '').replace(/\D+/g, '')) : null;
    const episode = iEpisode >= 0 ? toNumber((r[iEpisode] || '').replace(/\D+/g, '')) : null;
    viewings.push({ title, date, season, episode, episodeTitle: iEpisodeTitle >= 0 ? r[iEpisodeTitle] || null : null, structured: season != null });
  }
  const platform = netflix || /netflix/i.test(fileName) ? 'Netflix' : /prime|amazon/i.test(fileName + header.join(' ')) ? 'Prime Video' : 'Import';
  return { format: netflix ? 'netflix' : 'csv', platform, viewings, skipped };
}

// ---------------------------------------------------------------------------
//  Regroupement : une entrée par œuvre
// ---------------------------------------------------------------------------
/**
 * Regroupe les visionnages par œuvre. Une série rassemble ses épisodes
 * (chaque épisode gardé une fois, à la date où il a été vu la première fois).
 *   today : les dates futures sont écartées
 * Renvoie [{ key, title, kind: 'serie' | 'film', platform, episodes: [{ season, number, title, date }],
 *            seasonsOnly: [{ season, date }], date, first, last, count }]
 */
export function groupViewings(viewings, platform, today) {
  const works = new Map();
  for (const v of viewings) {
    const date = v.date && v.date <= today ? v.date : null;
    let show = v.title;
    let season = v.season ?? null;
    let episodeTitle = v.episodeTitle ?? null;
    let episodeNumber = v.episode ?? null;
    if (season == null && !v.structured) {
      const split = splitTitle(v.title);
      show = split.show;
      season = split.season;
      episodeTitle = split.episodeTitle ?? null;
      episodeNumber = split.episodeNumber ?? null;
    } else if (v.structured || season != null) {
      const split = splitTitle(v.title); // « The Boys: Season 4 » dans la colonne titre
      if (split.season != null) show = split.show;
    }
    const kind = season != null ? 'serie' : 'film';
    const key = `${kind}:${titleKey(show)}`;
    if (!works.has(key)) works.set(key, { key, title: show, kind, platform, episodes: new Map(), seasonsOnly: new Map(), dates: [] });
    const work = works.get(key);
    if (date) work.dates.push(date);
    if (kind === 'film') continue;
    if (episodeNumber == null && !episodeTitle) {
      // saison sans précision d'épisode (export Amazon) : gardée comme « saison regardée »
      const old = work.seasonsOnly.get(season);
      if (!old || (date && (!old.date || date < old.date))) work.seasonsOnly.set(season, { season, date });
      continue;
    }
    const epKey = `${season}|${episodeNumber ?? titleKey(episodeTitle)}`;
    const old = work.episodes.get(epKey);
    if (!old || (date && (!old.date || date < old.date))) work.episodes.set(epKey, { season, number: episodeNumber, title: episodeTitle, date });
  }
  return [...works.values()].map((w) => {
    const dates = w.dates.sort();
    return {
      key: w.key,
      title: w.title,
      kind: w.kind,
      platform: w.platform,
      episodes: [...w.episodes.values()],
      seasonsOnly: [...w.seasonsOnly.values()],
      date: dates[0] || null, // film : la première fois qu'il a été vu
      first: dates[0] || null,
      last: dates[dates.length - 1] || null,
      count: w.kind === 'film' ? 1 : w.episodes.size,
    };
  }).sort((a, b) => (b.last || '').localeCompare(a.last || '') || a.title.localeCompare(b.title, 'fr'));
}

/**
 * Associe les épisodes importés aux vrais numéros d'épisodes de la série.
 *   seasons : [{ number, episodes: [{ number, title, runtime }] }] (fiche TVMaze)
 * Par ordre de confiance : numéro donné (« Épisode 3 »), titre identique, puis,
 * pour ce qui reste, le plus petit numéro libre dans l'ordre où ils ont été vus
 * (Netflix donne les titres d'épisodes en français, TVMaze en anglais).
 * Renvoie [{ season, episode, date, runtime, guessed }] (sans doublon).
 */
export function assignEpisodes(work, seasons) {
  const result = new Map();
  const bySeason = new Map(seasons.map((s) => [s.number, s.episodes]));
  const pending = new Map(); // saison → épisodes à placer
  for (const ep of work.episodes) {
    const list = bySeason.get(ep.season);
    if (!list) continue; // saison inconnue de TVMaze
    let target = null;
    if (ep.number != null) target = list.find((e) => e.number === ep.number) || null;
    if (!target && ep.title) {
      const t = titleKey(ep.title);
      target = list.find((e) => titleKey(e.title) === t) || null;
    }
    if (target && !result.has(`${ep.season}|${target.number}`)) {
      result.set(`${ep.season}|${target.number}`, { season: ep.season, episode: target.number, date: ep.date, runtime: target.runtime ?? null, guessed: false });
    } else if (target) {
      const old = result.get(`${ep.season}|${target.number}`);
      if (ep.date && (!old.date || ep.date < old.date)) old.date = ep.date;
    } else {
      if (!pending.has(ep.season)) pending.set(ep.season, []);
      pending.get(ep.season).push(ep);
    }
  }
  for (const [season, eps] of pending) {
    const free = bySeason.get(season).filter((e) => !result.has(`${season}|${e.number}`));
    eps.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
    eps.forEach((ep, i) => {
      const target = free[i];
      if (target) result.set(`${season}|${target.number}`, { season, episode: target.number, date: ep.date, runtime: target.runtime ?? null, guessed: true });
    });
  }
  // saisons regardées sans détail des épisodes : tous les épisodes de la saison
  for (const s of work.seasonsOnly || []) {
    for (const e of bySeason.get(s.season) || []) {
      if (!result.has(`${s.season}|${e.number}`)) result.set(`${s.season}|${e.number}`, { season: s.season, episode: e.number, date: s.date, runtime: e.runtime ?? null, guessed: true });
    }
  }
  return [...result.values()].sort((a, b) => a.season - b.season || a.episode - b.episode);
}
