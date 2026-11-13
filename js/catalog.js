// ============================================================================
//  Catalogue : recherche unifiée (films + séries) et chargement d'une fiche.
//
//  Sources, toutes gratuites et sans clé :
//    - séries : TVMaze (fiche, saisons, épisodes) ; Wikidata permet en plus de
//               les trouver dès les premières lettres du titre
//    - films  : iTunes (boutique française), complété par Wikidata/Wikipédia
//  Chaque source est indépendante : si l'une ne répond pas, les autres
//  s'affichent quand même et un message discret le signale.
// ============================================================================
import * as tvmaze from './api/tvmaze.js';
import * as itunes from './api/itunes.js';
import * as wikidata from './api/wikidata.js';
import { normalize, isAbort } from './utils.js';
import { findItem } from './store.js';

const SOURCES = [
  { name: 'tvmaze', label: 'séries (TVMaze)', search: tvmaze.searchShows },
  { name: 'itunes', label: 'films (iTunes)', search: itunes.searchMovies },
  { name: 'wikidata', label: 'films et séries (Wikidata)', search: wikidata.searchTitles },
];

// Résultats déjà obtenus pendant cette visite : « source|recherche » → résultats.
const searchCache = new Map();
// Œuvres déjà vues passer (suggestions, fiches) : « source:id » → œuvre.
const known = new Map();

export function remember(item) {
  if (!item?.source) return item;
  const key = `${item.source}:${item.source_id}`;
  const merged = { ...(known.get(key) || {}), ...item };
  known.set(key, merged);
  return merged;
}
export function recall(source, id) { return known.get(`${source}:${id}`) || null; }

/**
 * Note de pertinence d'une œuvre par rapport à ce qui est tapé : on compare
 * au titre français et aux autres titres connus (titre original ou anglais :
 * taper « Up » doit trouver « Là-haut »).
 */
function itemMatch(item, query) {
  return Math.max(matchScore(item.title, query), ...(item.altTitles || []).map((t) => matchScore(t, query) - 5));
}

/** Titre réduit à ses lettres et chiffres : « M.A.S.K. » = « MASK », « Spider-Man » = « spiderman ». */
const compact = (text) => normalize(text).replace(/[^\p{L}\p{N}]+/gu, '');

/** Note de pertinence d'un titre par rapport à ce qui est tapé (plus c'est haut, mieux c'est). */
function matchScore(title, query) {
  const t = normalize(title);
  const q = normalize(query);
  if (!q) return 0;
  if (t === q || (compact(q) && compact(t) === compact(q))) return 100;
  // article ou nom du studio en tête : « Flash » = « The Flash », « Daredevil » = « Marvel's Daredevil »
  const bare = t.replace(/^(the|le|la|les|l'|un|une|a|an|marvel's|dc's) ?/, '');
  if (bare === q || (compact(q) && compact(bare) === compact(q))) return 95;
  if (t.startsWith(q)) return 80;
  // on ignore l'article de début : « matrix » doit trouver « The Matrix »
  if (bare.startsWith(q)) return 72;
  if (t.includes(` ${q}`)) return 55;
  if (t.includes(q)) return 40;
  return 15;
}

/** Fusionne, dédoublonne et classe les résultats des différentes sources. */
function mergeResults(lists, query) {
  const merged = [];
  const byKey = new Map(); // « source:id » → œuvre déjà retenue
  for (const item of lists.flat()) {
    // Même série trouvée par TVMaze ET par Wikidata (même identifiant TVMaze) :
    // on garde une seule suggestion, avec l'affiche TVMaze et la meilleure
    // popularité des deux (Wikidata la mesure mieux).
    const key = `${item.source}:${item.source_id}`;
    const same = byKey.get(key);
    if (same) {
      const keep = same.poster_url ? same : item;
      const other = keep === same ? item : same;
      // on garde aussi l'autre titre pour le classement : TVMaze dit « The Flash »
      // ou « Marvel's Daredevil », Wikidata « Flash » ou « Daredevil »
      keep.altTitles = [...new Set([...(keep.altTitles || []), other.title, ...(other.altTitles || [])])].filter((t) => t && t !== keep.title);
      keep.popularity = Math.max(keep.popularity || 0, other.popularity || 0);
      keep.wiki = keep.wiki || other.wiki;
      if (keep !== same) { merged[merged.indexOf(same)] = keep; byKey.set(key, keep); }
      continue;
    }
    // Même film trouvé sur iTunes ET Wikidata : on garde iTunes (affiche HD,
    // résumé français) et on retient l'identifiant Wikidata pour le pays.
    const twin = item.type === 'film' && merged.find((other) => other.type === 'film'
      && other.source !== item.source && normalize(other.title) === normalize(item.title)
      && (!other.year || !item.year || Math.abs(other.year - item.year) <= 1));
    if (twin) {
      if (twin.source === 'itunes') twin.wikidataId = item.source_id;
      else { item.wikidataId = twin.source_id; merged[merged.indexOf(twin)] = item; }
      continue;
    }
    merged.push(item);
    byKey.set(key, item);
  }
  for (const item of merged) {
    // la notoriété compte beaucoup : « break » doit proposer Breaking Bad avant
    // des films confidentiels qui s'appellent exactement « Break »
    item.score = itemMatch(item, query) + Math.min(item.popularity || 0, 100) * 0.4
      + (item.poster_url || item.wiki?.en ? 3 : 0);
    remember(item);
  }
  // TVMaze propose aussi des séries seulement « proches » à l'écrit (« inception » →
  // « Deception ») : sans rapport avec le texte tapé et jugées peu pertinentes par
  // TVMaze, on les écarte. Une faute de frappe (« breking bad ») reste trouvée.
  return merged
    .filter((item) => item.source !== 'tvmaze' || itemMatch(item, query) > 15 || (item.relevance || 0) >= 0.45 || nearlySame(item.title, query))
    .sort((a, b) => b.score - a.score);
}

/** Vrai si le titre ne diffère de ce qui est tapé que par une petite faute (1 lettre pour 6). */
function nearlySame(title, query) {
  const a = compact(title);
  const b = compact(query);
  if (b.length < 4) return false;
  const max = Math.max(1, Math.floor(b.length / 6));
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] <= max;
}

/**
 * Recherche dans toutes les sources en parallèle.
 * `onUpdate({ results, pending, failed })` est appelé dès qu'une source répond,
 * pour afficher les suggestions au fur et à mesure.
 */
export async function searchAll(query, signal, onUpdate = () => {}) {
  const q = query.trim();
  const lists = [];
  const failed = [];
  let pending = SOURCES.length;

  await Promise.all(SOURCES.map(async (source) => {
    const key = `${source.name}|${normalize(q)}`;
    try {
      if (!searchCache.has(key)) searchCache.set(key, await source.search(q, signal));
      lists.push(searchCache.get(key).map((item) => ({ ...item })));
    } catch (error) {
      if (isAbort(error) || signal?.aborted) return;
      console.warn(`[Recherche] ${source.label} indisponible :`, error.message);
      failed.push(source);
    } finally {
      pending -= 1;
      if (!signal?.aborted) onUpdate({ results: mergeResults(lists, q), pending, failed: summarize(failed) });
    }
  }));
  return { results: mergeResults(lists, q), pending: 0, failed: summarize(failed) };
}

/**
 * Décrit les pannes de façon utile. Wikidata fournit presque tous les films
 * (iTunes n'en connaît plus guère) : s'il ne répond pas, la recherche de films
 * est incomplète, même si iTunes a répondu.
 */
function summarize(failed) {
  const names = failed.map((source) => source.name);
  const messages = [];
  if (names.includes('tvmaze')) messages.push('séries');
  if (names.includes('wikidata')) messages.push('films');
  return messages;
}

/** Miniature d'une suggestion (les films Wikidata vont la chercher sur Wikipédia). */
export async function thumbnail(item, signal) {
  if (item.thumb_url || item.poster_url) return item.thumb_url || item.poster_url;
  if (!item.wiki) return null; // seules les œuvres venues de Wikidata ont une page Wikipédia
  const thumb = await wikidata.thumbFor(item, signal).catch(() => null);
  if (thumb) remember({ ...item, thumb_url: thumb });
  return thumb;
}

/**
 * Charge la fiche complète d'une œuvre.
 * En cas de panne de la source, on se rabat sur la copie enregistrée dans la
 * collection (si elle existe) plutôt que d'afficher une erreur.
 */
export async function loadItem(source, id, signal) {
  const saved = findItem(source, id);
  try {
    let item;
    if (source === 'tvmaze') item = await tvmaze.getShow(id, signal);
    else if (source === 'tvmaze-imdb') item = await tvmaze.getShow(await tvmaze.idFromImdb(id, signal), signal);
    else if (source === 'wikidata') item = await wikidata.getFilm(id, signal);
    else if (source === 'itunes') {
      const cached = recall(source, id);
      item = cached?.title ? cached : await itunes.getMovie(id, signal);
    } else throw new Error('Source inconnue');
    return remember({ ...item, offline: false });
  } catch (error) {
    if (isAbort(error)) throw error;
    const fallback = saved || recall(source, id);
    if (fallback?.title) return { ...fallback, offline: true };
    throw error;
  }
}

/**
 * Film iTunes : va chercher sur Wikidata ce qu'iTunes ne donne pas
 * (pays de production, genres détaillés). Renvoie les champs à compléter.
 */
export async function enrichFromWikidata(item, signal) {
  if (item.source !== 'itunes' || item.countries?.length) return null;
  try {
    const facts = item.wikidataId
      ? await wikidata.getFilmFacts(item.wikidataId, signal)
      : await wikidata.findFilmFacts(item.title, item.year, signal);
    if (!facts) return null;
    const patch = {};
    if (facts.countries.length) patch.countries = facts.countries;
    if (facts.genres.length > (item.genres?.length || 0)) patch.genres = facts.genres;
    if (!item.runtime && facts.runtime) patch.runtime = facts.runtime;
    if (!Object.keys(patch).length) return null;
    remember({ ...item, ...patch });
    return patch;
  } catch (error) {
    if (!isAbort(error)) console.warn('[Wikidata] complément indisponible :', error.message);
    return null;
  }
}
