// ============================================================================
//  Données de l'utilisateur : lecture et écriture dans Supabase.
//
//  Au moment de la connexion, on charge une fois toutes SES données (œuvres,
//  notes, liste à voir, suggestions refusées) et on les garde en mémoire dans
//  `state`. Chaque modification est envoyée à Supabase puis reportée dans
//  `state`, ce qui rend l'interface instantanée. Les règles RLS garantissent
//  côté serveur qu'on ne reçoit et ne modifie que ses propres lignes.
// ============================================================================
import { sb } from './supabase.js';
import { setRemoteCache } from './api/translate.js';
import { todayISO } from './utils.js';
import { summarizeRatings } from './stats/core.js';

export { summarizeRatings }; // (le calcul est centralisé dans js/stats/core.js)

export const state = {
  user: null,
  items: new Map(), // id → œuvre enregistrée
  ratings: [], // toutes les notes / visionnages
  watchlist: new Map(), // id de l'œuvre → date d'ajout
  dismissed: new Map(), // « source:id » → suggestion refusée
  // La migration V2 (supabase/migration_v2.sql) a-t-elle été appliquée ?
  // Tant que non, le site fonctionne comme avant ; seule la page « Pour toi » attend.
  v2: false,
  // Migration V3 (supabase/migration_v3.sql) : durées, acteurs, récaps, réglages.
  v3: false,
  recaps: new Map(), // « kind:période » → { kind, period, signature, seen_at, generated_at }
  settings: null, // réglages enregistrés (thème) ou null
  loaded: false,
};

// Colonnes de la table « items » qu'on a le droit d'écrire.
const ITEM_FIELDS = ['source', 'source_id', 'type', 'title', 'year', 'countries', 'genres', 'poster_url', 'summary_fr', 'summary_original', 'runtime'];
// … et celles ajoutées par la migration V2 (pour les suggestions).
const ITEM_FIELDS_V2 = ['wikidata_id', 'directors', 'actors', 'credits_at'];
// … et par la migration V3 (durées des épisodes, vérifications)
const ITEM_FIELDS_V3 = ['seasons_meta', 'meta_at', 'cast_at'];
const LIST_FIELDS = ['countries', 'genres', 'directors', 'actors'];
const itemFields = () => [...ITEM_FIELDS, ...(state.v2 ? ITEM_FIELDS_V2 : []), ...(state.v3 ? ITEM_FIELDS_V3 : [])];

/**
 * Durées des épisodes d'une série, saison par saison, au format stocké dans
 * items.seasons_meta : {"1": [[1, 58], [2, 48]], …}.
 */
export function seasonsMetaOf(seasons) {
  if (!Array.isArray(seasons) || !seasons.length) return null;
  return Object.fromEntries(seasons.map((season) => [String(season.number), season.episodes.map((ep) => [ep.number, ep.runtime ?? null])]));
}

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
  const [items, ratings, watchlist, probe, probe3] = await Promise.all([
    fetchAll('items', 'id'), fetchAll('ratings', 'id'), fetchAll('watchlist', 'added_at'),
    // Petit test : la colonne et la table ajoutées par la migration V2 existent-elles ?
    Promise.all([
      sb.from('items').select('credits_at').limit(1),
      sb.from('dismissed_suggestions').select('*').order('created_at'),
    ]),
    // … et celles de la migration V3 ?
    Promise.all([
      sb.from('items').select('seasons_meta').limit(1),
      sb.from('recaps').select('kind, period, signature, seen_at, generated_at'),
      sb.from('user_settings').select('theme, updated_at').maybeSingle(),
    ]),
  ]);
  state.items = new Map(items.map((item) => [item.id, item]));
  state.ratings = ratings;
  state.watchlist = new Map(watchlist.map((row) => [row.item_id, row.added_at]));
  state.v2 = !probe[0].error && !probe[1].error;
  state.dismissed = new Map((state.v2 ? probe[1].data : []).map((row) => [`${row.source}:${row.source_id}`, row]));
  state.v3 = state.v2 && probe3.every((result) => !result.error);
  state.recaps = new Map((state.v3 ? probe3[1].data : []).map((row) => [`${row.kind}:${row.period}`, row]));
  state.settings = state.v3 ? probe3[2].data : null;
  state.loaded = true;
  emit();
}

/** Oublie tout (à la déconnexion). */
export function reset() {
  state.user = null;
  state.items = new Map();
  state.ratings = [];
  state.watchlist = new Map();
  state.dismissed = new Map();
  state.v2 = false;
  state.v3 = false;
  state.recaps = new Map();
  state.settings = null;
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

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/**
 * Moyenne INDICATIVE des épisodes notés d'une saison (jamais enregistrée
 * comme note de la saison). Renvoie { value, count } ou null.
 */
export function seasonAverage(itemId, season) {
  const notes = state.ratings
    .filter((row) => row.item_id === itemId && row.season === season && row.episode != null && row.rating != null)
    .map((row) => row.rating);
  return notes.length ? { value: mean(notes), count: notes.length } : null;
}

/** Moyenne indicative d'une série (à partir de ses saisons, sinon de ses épisodes). */
export function seriesAverage(itemId) {
  const summary = summarizeRatings(ratingsOf(itemId).filter((row) => row.season != null));
  return summary.value != null ? { value: summary.value, basis: summary.basis, count: summary.count } : null;
}

/**
 * La collection : une entrée par œuvre ayant au moins une note / un visionnage.
 *  - rating : note de l'œuvre ; à défaut, moyenne indicative (saisons, sinon épisodes)
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
    const summary = summarizeRatings(rows);
    const dates = rows.map((row) => row.watched_on).filter(Boolean).sort();
    entries.push({
      item,
      main: summary.main,
      rows,
      rating: summary.value, // nombre entre 1 et 5, ou null
      isAverage: summary.basis !== null && summary.basis !== 'direct',
      basis: summary.basis,
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
  // série : on garde tout de suite la durée de chaque épisode (temps de visionnage)
  if (state.v3 && data.type === 'serie' && !data.seasons_meta && data.seasons) data = { ...data, seasons_meta: seasonsMetaOf(data.seasons), meta_at: new Date().toISOString() };
  for (const field of itemFields()) {
    if (LIST_FIELDS.includes(field)) row[field] = Array.isArray(data[field]) ? data[field] : [];
    else row[field] = data[field] ?? null;
  }
  const saved = check(await sb.from('items')
    .upsert(row, { onConflict: 'user_id,source,source_id' }).select().single());
  state.items.set(saved.id, saved);
  return saved;
}

/** Complète une œuvre déjà enregistrée (résumé traduit, pays, réalisateurs trouvés après coup…). */
export const updateItem = serial(async (id, patch) => {
  const allowed = itemFields();
  const clean = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
  if (!Object.keys(clean).length || !state.items.has(id)) return null;
  const saved = check(await sb.from('items').update(clean).eq('id', id).select().single());
  state.items.set(saved.id, saved);
  emit();
  return saved;
});

/**
 * Crée ou modifie une note. `target` = { season, episode } (vides pour l'œuvre).
 * `patch` peut contenir rating, comment, watched_on, runtime — chacun est
 * facultatif et peut valoir null (note retirée, date inconnue…).
 * Seule la ligne visée est touchée : noter une saison ne crée, ne modifie et
 * n'efface aucun épisode, et inversement.
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
    watched_on: current ? current.watched_on : todayISO(), // 1re fois : aujourd'hui, sauf indication contraire
    runtime: current?.runtime ?? null,
    ...patch,
  };
  if (typeof row.comment === 'string') row.comment = row.comment.trim() || null;
  if (row.watched_on && row.watched_on > todayISO()) throw new Error('Une date de visionnage ne peut pas être dans le futur.');
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

/**
 * Marque comme vus tous les épisodes d'une saison qui ne le sont pas encore :
 * la date est enregistrée (aujourd'hui par défaut, ou null pour « inconnue »),
 * sans imposer de note. Les épisodes déjà notés ou déjà vus ne sont pas touchés.
 */
export const markSeasonSeen = serial(async (itemData, seasonNumber, episodes, date = todayISO()) => {
  const item = await ensureItemNow(itemData);
  const rows = episodes
    .filter((ep) => !getRating(item.id, seasonNumber, ep.number))
    .map((ep) => ({
      user_id: state.user.id, item_id: item.id, season: seasonNumber, episode: ep.number,
      rating: null, comment: null, watched_on: date, runtime: ep.runtime ?? null,
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

/**
 * Import d'historique (Netflix, Prime Video) : enregistre des visionnages
 * « vus » (sans note) pour une œuvre.
 *   rows : [{ season, episode, watched_on, runtime }] (season/episode vides pour un film)
 * Ne touche jamais à une note, un commentaire ou une date déjà présents :
 * seule une date « inconnue » est complétée. Renvoie { item, added, dated }.
 */
export const importViewings = serial(async (itemData, rows) => {
  const item = await ensureItemNow(itemData);
  const fresh = [];
  const toDate = [];
  for (const r of rows) {
    if (r.watched_on && r.watched_on > todayISO()) continue;
    const current = getRating(item.id, r.season ?? null, r.episode ?? null);
    if (!current) {
      fresh.push({ user_id: state.user.id, item_id: item.id, season: r.season ?? null, episode: r.episode ?? null, rating: null, comment: null, watched_on: r.watched_on || null, runtime: r.runtime ?? null });
    } else if (!current.watched_on && r.watched_on) toDate.push([current, r.watched_on]);
  }
  for (let i = 0; i < fresh.length; i += 200) {
    const saved = check(await sb.from('ratings')
      .upsert(fresh.slice(i, i + 200), { onConflict: 'user_id,item_id,season,episode', ignoreDuplicates: true }).select());
    const ids = new Set(saved.map((row) => row.id));
    state.ratings = state.ratings.filter((row) => !ids.has(row.id)).concat(saved);
  }
  for (const [current, date] of toDate) {
    const saved = check(await sb.from('ratings').update({ watched_on: date }).eq('id', current.id).select().single());
    state.ratings = state.ratings.filter((row) => row.id !== saved.id).concat(saved);
  }
  // un film vu sort de la liste « à voir »
  if (item.type === 'film' && state.watchlist.has(item.id)) await removeFromWatchlistNow(item.id, { silent: true });
  emit();
  return { item, added: fresh.length, dated: toDate.length };
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
//  Suggestions : refus (« pas intéressé ») et cache d'environ 24 h
// ---------------------------------------------------------------------------

/** Retient qu'une suggestion ne m'intéresse pas : elle ne sera plus proposée. */
export const dismissSuggestion = serial(async (candidate) => {
  const row = {
    user_id: state.user.id,
    source: candidate.source,
    source_id: String(candidate.source_id),
    type: candidate.type,
    title: candidate.title,
    // ce qui caractérise l'œuvre refusée : sert de léger signal négatif
    facets: {
      genres: candidate.genres || [],
      countries: candidate.countries || [],
      year: candidate.year || null,
      directors: candidate.directors || [],
      actors: candidate.actors || [],
    },
  };
  // simple ajout : si la suggestion avait déjà été refusée, on n'y touche pas
  const rows = check(await sb.from('dismissed_suggestions')
    .upsert(row, { onConflict: 'user_id,source,source_id', ignoreDuplicates: true }).select());
  const saved = rows[0] || row;
  state.dismissed.set(`${saved.source}:${saved.source_id}`, saved);
  emit();
  return saved;
});

/** Lit les suggestions gardées en cache (ou null). */
export async function readSuggestionsCache() {
  const { data, error } = await sb.from('suggestions_cache').select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Enregistre les suggestions calculées (une seule ligne par utilisateur). */
export async function writeSuggestionsCache(seedsKey, payload) {
  const { error } = await sb.from('suggestions_cache').upsert(
    { user_id: state.user.id, seeds_key: seedsKey, payload, generated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
  if (error) throw new Error(error.message);
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

// ---------------------------------------------------------------------------
//  V3 : acteurs (tables partagées people / item_cast)
// ---------------------------------------------------------------------------

/**
 * Acteurs déjà connus pour une liste d'œuvres (clés « wd:Q… » / « tm:… »).
 * Renvoie Map(clé → [{ id, name, photo, ord }]) (rôle principal en premier).
 */
export async function loadCast(keys) {
  const cast = new Map();
  const unique = [...new Set(keys.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 80) {
    const rows = check(await sb.from('item_cast')
      .select('work, ord, person:people(id, name, photo_url)').in('work', unique.slice(i, i + 80)));
    for (const row of rows) {
      if (!row.person) continue;
      if (!cast.has(row.work)) cast.set(row.work, []);
      cast.get(row.work).push({ id: row.person.id, name: row.person.name, photo: row.person.photo_url, ord: row.ord });
    }
  }
  for (const list of cast.values()) list.sort((a, b) => a.ord - b.ord);
  return cast;
}

/** Enregistre la distribution d'une œuvre (ajout seulement : rien n'est écrasé). */
export async function saveCast(work, people) {
  if (!people.length) return;
  check(await sb.from('people').upsert(
    people.map((p) => ({ id: p.id, name: p.name, photo_url: p.photo || null })),
    { onConflict: 'id', ignoreDuplicates: true },
  ));
  check(await sb.from('item_cast').upsert(
    people.map((p, ord) => ({ work, person_id: p.id, ord })),
    { onConflict: 'work,person_id', ignoreDuplicates: true },
  ));
}

// ---------------------------------------------------------------------------
//  V3 : récaps
// ---------------------------------------------------------------------------
export async function readRecap(kind, period) {
  const { data, error } = await sb.from('recaps').select('*').eq('kind', kind).eq('period', period).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function saveRecap(kind, period, signature, data) {
  const row = check(await sb.from('recaps').upsert(
    { user_id: state.user.id, kind, period, signature, data, generated_at: new Date().toISOString() },
    { onConflict: 'user_id,kind,period' },
  ).select('kind, period, signature, seen_at, generated_at').single());
  state.recaps.set(`${kind}:${period}`, row);
  return row;
}

export async function markRecapSeen(kind, period) {
  const row = check(await sb.from('recaps').update({ seen_at: new Date().toISOString() })
    .eq('user_id', state.user.id).eq('kind', kind).eq('period', period)
    .select('kind, period, signature, seen_at, generated_at').maybeSingle());
  if (row) state.recaps.set(`${kind}:${period}`, row);
  emit();
}

// ---------------------------------------------------------------------------
//  V3 : réglages (thème de couleurs)
// ---------------------------------------------------------------------------
export async function saveSettings(theme) {
  if (!state.v3 || !state.user) return;
  const row = check(await sb.from('user_settings').upsert(
    { user_id: state.user.id, theme },
    { onConflict: 'user_id' },
  ).select('theme, updated_at').single());
  state.settings = row;
}
