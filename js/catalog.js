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

/** Note de pertinence d'un titre par rapport à ce qui est tapé (plus c'est haut, mieux c'est). */
function matchScore(title, query) {
  const t = normalize(title);
  const q = normalize(query);
  if (!q) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  // on ignore l'article de début : « matrix » doit trouver « The Matrix »
  if (t.replace(/^(the|le|la|les|l'|un|une|a|an) ?/, '').startsWith(q)) return 72;
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
    item.score = matchScore(item.title, query) + Math.min(item.popularity || 0, 100) * 0.25
      + (item.poster_url || item.wiki?.en ? 3 : 0);
    remember(item);
  }
  return merged.sort((a, b) => b.score - a.score);
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

/** Décrit les pannes de façon utile : les films ont deux sources, une seule suffit. */
function summarize(failed) {
  const names = failed.map((source) => source.name);
  const messages = [];
  if (names.includes('tvmaze')) messages.push('séries');
  if (names.includes('itunes') && names.includes('wikidata')) messages.push('films');
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
