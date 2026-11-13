// ============================================================================
//  Complète, une seule fois, les informations nécessaires aux statistiques :
//   - les durées (films sans durée, épisodes de chaque saison des séries) ;
//   - les acteurs principaux de chaque œuvre (tables partagées).
//  Tout est enregistré dans Supabase : les API ne sont plus rappelées ensuite.
// ============================================================================
import * as tvmaze from '../api/tvmaze.js';
import * as wikidata from '../api/wikidata.js';
import { isAbort } from '../utils.js';
import { state, updateItem, seasonsMetaOf, loadCast, saveCast } from '../store.js';
import { workKey } from './core.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString();
let running = null;

/**
 * Complète durées et acteurs, puis renvoie la distribution de chaque œuvre
 * (Map clé → acteurs). `onProgress(texte)` pour afficher l'avancement.
 * Sans la migration V3, renvoie une distribution vide.
 */
export function ensureStatsData(signal, onProgress = () => {}) {
  if (!state.v3) return Promise.resolve(new Map());
  if (!running) running = run(signal, onProgress).finally(() => { running = null; });
  return running;
}

async function run(signal, onProgress) {
  await ensureDurations(signal, onProgress);
  return ensureCast(signal, onProgress);
}

// ---------------------------------------------------------------------------
//  Durées
// ---------------------------------------------------------------------------
async function ensureDurations(signal, onProgress) {
  const seen = new Set(state.ratings.map((row) => row.item_id));
  const series = [...state.items.values()].filter((item) => item.type === 'serie' && seen.has(item.id) && !item.meta_at && item.source === 'tvmaze');
  const films = [...state.items.values()].filter((item) => item.type === 'film' && seen.has(item.id) && !item.runtime && !item.meta_at);
  const total = series.length + films.length;
  if (!total) return;
  let done = 0;
  const step = () => onProgress(`Calcul des durées… ${++done}/${total}`);

  // séries : une requête TVMaze par série (épisodes et durées)
  for (const item of series) {
    if (signal?.aborted) return;
    try {
      const show = await tvmaze.getShow(item.source_id, signal);
      await updateItem(item.id, { seasons_meta: seasonsMetaOf(show.seasons), runtime: item.runtime || show.runtime || null, meta_at: stamp() });
    } catch (error) {
      if (isAbort(error)) return;
      if (error.status === 404) await updateItem(item.id, { meta_at: stamp() }).catch(() => {});
    }
    step();
    await wait(160); // TVMaze accepte ~20 requêtes par 10 secondes
  }

  // films : durée Wikidata (P2047), en une requête groupée
  const byQid = new Map();
  for (const item of films) {
    const qid = item.wikidata_id || (item.source === 'wikidata' ? item.source_id : null);
    if (qid) byQid.set(item.id, qid);
  }
  if (byQid.size) {
    try {
      const facts = await wikidata.getFilmsFacts([...new Set(byQid.values())], signal);
      for (const item of films) {
        const runtime = facts.get(byQid.get(item.id))?.runtime || null;
        await updateItem(item.id, { ...(runtime ? { runtime } : {}), meta_at: stamp() }).catch(() => {});
        step();
      }
    } catch (error) {
      if (isAbort(error)) return;
    }
  }
  // films sans identifiant Wikidata : on garde la durée par défaut (110 min, « estimée »)
  for (const item of films) if (!byQid.has(item.id)) { await updateItem(item.id, { meta_at: stamp() }).catch(() => {}); step(); }
}

// ---------------------------------------------------------------------------
//  Acteurs
// ---------------------------------------------------------------------------
async function ensureCast(signal, onProgress) {
  const seen = new Set(state.ratings.map((row) => row.item_id));
  const works = [...state.items.values()].filter((item) => seen.has(item.id) && workKey(item));
  let cast;
  try {
    cast = await loadCast(works.map(workKey));
  } catch (error) {
    console.warn('[Acteurs] distribution illisible :', error.message);
    return new Map();
  }
  // œuvres dont personne n'a encore enregistré les acteurs
  const missing = works.filter((item) => !cast.has(workKey(item)) && !item.cast_at);
  if (!missing.length) return cast;
  let done = 0;
  const step = () => onProgress(`Recherche des acteurs… ${++done}/${missing.length}`);

  for (const item of missing.filter((w) => w.type === 'serie')) {
    if (signal?.aborted) return cast;
    try {
      const people = await tvmaze.getCast(item.source_id, signal, 10);
      await saveCast(workKey(item), people);
      cast.set(workKey(item), people);
      await updateItem(item.id, { cast_at: stamp() }).catch(() => {});
    } catch (error) {
      if (isAbort(error)) return cast;
      console.warn('[Acteurs] série', item.title, error.message);
    }
    step();
    await wait(160);
  }

  const films = missing.filter((w) => w.type === 'film');
  if (films.length) {
    try {
      const found = await wikidata.getCastWithPhotos(films.map((f) => workKey(f).slice(3)), signal);
      for (const item of films) {
        const people = found.get(workKey(item).slice(3)) || [];
        await saveCast(workKey(item), people);
        if (people.length) cast.set(workKey(item), people);
        await updateItem(item.id, { cast_at: stamp() }).catch(() => {});
        step();
      }
    } catch (error) {
      if (!isAbort(error)) console.warn('[Acteurs] films :', error.message);
    }
  }
  return cast;
}
