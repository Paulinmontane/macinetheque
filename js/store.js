// ============================================================================
//  Données de l'utilisateur : lecture et écriture dans Supabase.
//
//  Au moment de la connexion, on charge une fois toutes SES données (œuvres,
//  notes, liste à voir) et on les garde en mémoire dans `state`. Chaque
//  modification est envoyée à Supabase puis reportée dans `state`, ce qui
//  rend l'interface instantanée. Les règles RLS garantissent côté serveur
//  qu'on ne reçoit et ne modifie que ses propres lignes.
// ============================================================================
import { sb } from './supabase.js';
import { setRemoteCache } from './api/translate.js';
import { todayISO } from './utils.js';

export const state = {
  user: null,
  items: new Map(), // id → œuvre enregistrée
  ratings: [], // toutes les notes / visionnages
  watchlist: new Map(), // id de l'œuvre → date d'ajout
  loaded: false,
};

// Colonnes de la table « items » qu'on a le droit d'écrire.
const ITEM_FIELDS = ['source', 'source_id', 'type', 'title', 'year', 'countries', 'genres', 'poster_url', 'summary_fr', 'summary_original', 'runtime'];

// ---------------------------------------------------------------------------
//  Abonnements : les pages se redessinent quand les données changent.
// ---------------------------------------------------------------------------
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(); }

/** Lève une erreur lisible si Supabase répond par une erreur. */
function check({ data, error }) {
  if (error) {
    console.error('[Supabase]', error);
    throw new Error(error.message || 'Erreur de base de données');
  }
  return data;
}

/** Lit toutes les lignes d'une table (Supabase en renvoie 1000 au maximum par appel). */
async function fetchAll(table, orderColumn) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const page = check(await sb.from(table).select('*').order(orderColumn).range(from, from + pageSize - 1));
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

/** Charge toutes les données de l'utilisateur connecté. */
export async function loadAll(user) {
  state.user = user;
  const [items, ratings, watchlist] = await Promise.all([
    fetchAll('items', 'id'), fetchAll('ratings', 'id'), fetchAll('watchlist', 'added_at'),
  ]);
  state.items = new Map(items.map((item) => [item.id, item]));
  state.ratings = ratings;
  state.watchlist = new Map(watchlist.map((row) => [row.item_id, row.added_at]));
  state.loaded = true;
  emit();
}

/** Oublie tout (à la déconnexion). */
export function reset() {
  state.user = null;
  state.items = new Map();
  state.ratings = [];
  state.watchlist = new Map();
  state.loaded = false;
}

// ---------------------------------------------------------------------------
//  Lecture (en mémoire)
// ---------------------------------------------------------------------------
export function findItem(source, sourceId) {
  for (const item of state.items.values()) {
    if (item.source === source && item.source_id === String(sourceId)) return item;
  }
  return null;
}

export function ratingsOf(itemId) {
  return state.ratings.filter((row) => row.item_id === itemId);
}

/** Note d'une œuvre (season/episode vides), d'une saison ou d'un épisode. */
export function getRating(itemId, season = null, episode = null) {
  if (!itemId) return null;
  return state.ratings.find((row) => row.item_id === itemId
    && (row.season ?? null) === season && (row.episode ?? null) === episode) || null;
}

export function isInWatchlist(itemId) { return !!itemId && state.watchlist.has(itemId); }

/**
 * La collection : une entrée par œuvre ayant au moins une note / un visionnage.
 *  - rating : note de l'œuvre ; à défaut, moyenne des notes de ses épisodes/saisons
 *  - lastWatched : date de visionnage la plus récente
 */
export function collection() {
  const byItem = new Map();
  for (const row of state.ratings) {
    if (!byItem.has(row.item_id)) byItem.set(row.item_id, []);
    byItem.get(row.item_id).push(row);
  }
  const entries = [];
  for (const [itemId, rows] of byItem) {
    const item = state.items.get(itemId);
    if (!item) continue;
    const main = rows.find((row) => row.season == null && row.episode == null) || null;
    const partial = rows.filter((row) => row !== main && row.rating != null).map((row) => row.rating);
    const average = partial.length ? partial.reduce((a, b) => a + b, 0) / partial.length : null;
    const dates = rows.map((row) => row.watched_on).filter(Boolean).sort();
    entries.push({
      item,
      main,
      rows,
      rating: main?.rating ?? average, // nombre entre 1 et 5, ou null
      isAverage: main?.rating == null && average != null,
      lastWatched: dates[dates.length - 1] || null,
      episodesSeen: rows.filter((row) => row.episode != null).length,
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
//  Écriture
// ---------------------------------------------------------------------------

// Les écritures passent l'une après l'autre (file d'attente). Sans cela, deux
// modifications rapprochées (changer la date puis le commentaire) partiraient
// en même temps et la seconde écraserait la première.
let queue = Promise.resolve();
function serial(fn) {
  return (...args) => {
    const run = queue.then(() => fn(...args));
    queue = run.catch(() => {}); // une erreur ne bloque pas les écritures suivantes
    return run;
  };
}

/** Enregistre (ou met à jour) une œuvre dans la base et renvoie la ligne avec son id. */
async function ensureItemNow(data) {
  const existing = data.id ? state.items.get(data.id) : findItem(data.source, data.source_id);
  if (existing) return existing;
  const row = { user_id: state.user.id };
  for (const field of ITEM_FIELDS) row[field] = data[field] ?? (field === 'countries' || field === 'genres' ? [] : null);
  const saved = check(await sb.from('items')
    .upsert(row, { onConflict: 'user_id,source,source_id' }).select().single());
  state.items.set(saved.id, saved);
  return saved;
}

/** Complète une œuvre déjà enregistrée (résumé traduit, pays trouvé après coup…). */
export const updateItem = serial(async (id, patch) => {
  const clean = Object.fromEntries(Object.entries(patch).filter(([key]) => ITEM_FIELDS.includes(key)));
  if (!Object.keys(clean).length || !state.items.has(id)) return null;
  const saved = check(await sb.from('items').update(clean).eq('id', id).select().single());
  state.items.set(saved.id, saved);
  emit();
  return saved;
});

/**
 * Crée ou modifie une note. `target` = { season, episode } (vides pour l'œuvre).
 * `patch` peut contenir rating, comment, watched_on, runtime.
 */
export const saveRating = serial(async (itemData, target, patch) => {
  const item = await ensureItemNow(itemData);
  const season = target?.season ?? null;
  const episode = target?.episode ?? null;
  const current = getRating(item.id, season, episode);
  const row = {
    user_id: state.user.id,
    item_id: item.id,
    season,
    episode,
    rating: current?.rating ?? null,
    comment: current?.comment ?? null,
    watched_on: current ? current.watched_on : todayISO(), // 1re note : vu aujourd'hui par défaut
    runtime: current?.runtime ?? null,
    ...patch,
  };
  if (typeof row.comment === 'string') row.comment = row.comment.trim() || null;
  const saved = check(await sb.from('ratings')
    .upsert(row, { onConflict: 'user_id,item_id,season,episode' }).select().single());
  state.ratings = state.ratings.filter((r) => r.id !== saved.id && r !== current).concat(saved);

  // Noter l'œuvre elle-même la retire de la liste « à voir ».
  let removedFromWatchlist = false;
  if (season === null && state.watchlist.has(item.id)) {
    await removeFromWatchlistNow(item.id, { silent: true });
    removedFromWatchlist = true;
  }
  emit();
  return { item, rating: saved, removedFromWatchlist };
});

/** Supprime une note. L'œuvre est retirée de la base si plus rien ne s'y rattache. */
export const deleteRating = serial(async (itemId, season = null, episode = null) => {
  const current = getRating(itemId, season, episode);
  if (!current) return;
  check(await sb.from('ratings').delete().eq('id', current.id));
  state.ratings = state.ratings.filter((row) => row.id !== current.id);
  await cleanupItem(itemId);
  emit();
});

/** Marque comme vus tous les épisodes d'une saison qui ne le sont pas encore. */
export const markSeasonSeen = serial(async (itemData, seasonNumber, episodes) => {
  const item = await ensureItemNow(itemData);
  const today = todayISO();
  const rows = episodes
    .filter((ep) => !getRating(item.id, seasonNumber, ep.number))
    .map((ep) => ({
      user_id: state.user.id, item_id: item.id, season: seasonNumber, episode: ep.number,
      rating: null, comment: null, watched_on: today, runtime: ep.runtime ?? null,
    }));
  if (rows.length) {
    const saved = check(await sb.from('ratings')
      .upsert(rows, { onConflict: 'user_id,item_id,season,episode', ignoreDuplicates: true }).select());
    const ids = new Set(saved.map((row) => row.id));
    state.ratings = state.ratings.filter((row) => !ids.has(row.id)).concat(saved);
  }
  emit();
  return { item, added: rows.length };
});

export const addToWatchlist = serial(async (itemData) => {
  const item = await ensureItemNow(itemData);
  if (!state.watchlist.has(item.id)) {
    const saved = check(await sb.from('watchlist')
      .upsert({ user_id: state.user.id, item_id: item.id }, { onConflict: 'user_id,item_id', ignoreDuplicates: true })
      .select());
    state.watchlist.set(item.id, saved[0]?.added_at || new Date().toISOString());
  }
  emit();
  return item;
});

async function removeFromWatchlistNow(itemId, { silent = false } = {}) {
  check(await sb.from('watchlist').delete().eq('item_id', itemId).eq('user_id', state.user.id));
  state.watchlist.delete(itemId);
  await cleanupItem(itemId);
  if (!silent) emit();
}

export const removeFromWatchlist = serial(removeFromWatchlistNow);

/** Supprime une œuvre qui n'a plus ni note ni place dans la liste à voir. */
async function cleanupItem(itemId) {
  if (state.watchlist.has(itemId) || state.ratings.some((row) => row.item_id === itemId)) return;
  const { error } = await sb.from('items').delete().eq('id', itemId);
  if (!error) state.items.delete(itemId);
}

// ---------------------------------------------------------------------------
//  Cache des traductions (table translations_cache)
// ---------------------------------------------------------------------------
setRemoteCache({
  async get(hashes) {
    const found = new Map();
    if (!sb || !state.user) return found;
    for (let i = 0; i < hashes.length; i += 100) { // par paquets, pour garder des adresses courtes
      const rows = check(await sb.from('translations_cache')
        .select('hash, translated').in('hash', hashes.slice(i, i + 100)));
      for (const row of rows) found.set(row.hash, row.translated);
    }
    return found;
  },
  async set(hash, translated) {
    if (!sb || !state.user) return;
    await sb.from('translations_cache')
      .upsert({ hash, translated }, { onConflict: 'hash', ignoreDuplicates: true });
  },
});
