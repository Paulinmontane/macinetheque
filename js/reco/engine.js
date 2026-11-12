// ============================================================================
//  Moteur de suggestions (page « Pour toi »). Aucune clé API : il n'utilise
//  que les sources déjà employées par le site.
//
//  1. ensureCredits : complète les œuvres déjà enregistrées avec leurs
//     réalisateurs et acteurs principaux (une seule fois par œuvre).
//  2. loadSuggestions : calcule mon profil de goûts, puis va chercher des
//     œuvres candidates —
//       films  : Wikidata (même réalisateur, mêmes acteurs, mêmes genres),
//       séries : TVMaze (autres séries de mes acteurs préférés) + les séries
//                les plus connues, triées selon mes genres.
//     Le résultat est gardé ~24 h dans Supabase pour une ouverture rapide.
//  3. rank : classe les candidats avec le profil du moment (recalculé à
//     chaque nouvelle note), en retirant ce que j'ai déjà vu, mis « à voir »
//     ou refusé.
// ============================================================================
import * as wikidata from '../api/wikidata.js';
import * as tvmaze from '../api/tvmaze.js';
import { normalize, isAbort } from '../utils.js';
import { state, collection, updateItem, readSuggestionsCache, writeSuggestionsCache } from '../store.js';
import { buildProfile, seedsOf, scoreCandidate, diversify } from './profile.js';

const CACHE_HOURS = 24;
const FILM_POOL = 48; // nombre de films candidats dont on charge la fiche
const SERIE_POOL = 14; // nombre de séries « populaires » dont on charge la fiche
// Sans assez de notes : genres servant à proposer des films populaires variés.
const DEFAULT_GENRES = ['Action', 'Comédie', 'Science-fiction', 'Aventure'];
// Genres très vastes : on exige des films plus connus (requête plus rapide).
const BIG_GENRES = new Set(['Drame', 'Comédie']);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const keyOf = (item) => `${item.source}:${item.source_id}`;

/** Mon profil de goûts du moment. */
export function currentProfile() {
  return buildProfile({
    entries: collection(),
    watchlist: [...state.watchlist.keys()].map((id) => state.items.get(id)).filter(Boolean),
    dismissed: [...state.dismissed.values()],
  });
}

// ---------------------------------------------------------------------------
//  1. Réalisateurs / acteurs / identifiant Wikidata des œuvres enregistrées
// ---------------------------------------------------------------------------
let creditsRun = null;

/**
 * Complète les œuvres qui n'ont pas encore ces informations (credits_at vide).
 * `onProgress(fait, total)` permet d'afficher l'avancement.
 */
export function ensureCredits(signal, onProgress = () => {}) {
  if (!creditsRun) creditsRun = completeCredits(signal, onProgress).finally(() => { creditsRun = null; });
  return creditsRun;
}

async function completeCredits(signal, onProgress) {
  const todo = [...state.items.values()].filter((item) => !item.credits_at);
  if (!todo.length) return;
  let done = 0;
  const step = () => { done += 1; onProgress(done, todo.length); };
  const stamp = () => new Date().toISOString();
  onProgress(0, todo.length);

  // ---- films : identifiant Wikidata, puis réalisateurs + acteurs en une requête groupée
  const films = todo.filter((item) => item.type === 'film');
  const ids = new Map(); // id de l'œuvre → identifiant Wikidata
  for (const film of films) {
    if (signal?.aborted) return;
    let qid = film.wikidata_id || (film.source === 'wikidata' ? film.source_id : null);
    if (!qid) { // film venu d'iTunes : on le retrouve par son titre et son année
      try { qid = await wikidata.findFilmId(film.title, film.year, signal); } catch (error) { if (isAbort(error)) return; qid = undefined; }
    }
    if (qid === undefined) { step(); continue; } // panne passagère : on réessaiera une autre fois
    if (!qid) { await updateItem(film.id, { credits_at: stamp() }).catch(() => {}); step(); continue; } // introuvable : inutile d'insister
    ids.set(film.id, qid);
  }
  if (ids.size) {
    try {
      const credits = await wikidata.getCredits([...new Set(ids.values())], signal);
      for (const [itemId, qid] of ids) {
        const found = credits.get(qid) || { directors: [], actors: [] };
        await updateItem(itemId, { wikidata_id: qid, directors: found.directors, actors: found.actors, credits_at: stamp() }).catch(() => {});
        step();
      }
    } catch (error) {
      if (isAbort(error)) return;
      console.warn('[Suggestions] réalisateurs/acteurs indisponibles pour le moment :', error.message);
      for (let i = 0; i < ids.size; i += 1) step();
    }
  }

  // ---- séries : acteurs principaux (TVMaze), une série après l'autre pour ménager le service
  for (const serie of todo.filter((item) => item.type === 'serie')) {
    if (signal?.aborted) return;
    try {
      const actors = await tvmaze.getCast(serie.source_id, signal);
      await updateItem(serie.id, { actors, credits_at: stamp() }).catch(() => {});
    } catch (error) {
      if (isAbort(error)) return;
      if (error.status === 404) await updateItem(serie.id, { credits_at: stamp() }).catch(() => {});
    }
    step();
    await wait(150);
  }
}

// ---------------------------------------------------------------------------
//  2. Recherche des œuvres candidates
// ---------------------------------------------------------------------------

/** Vrai si l'œuvre est déjà notée, déjà « à voir » ou déjà refusée. */
export function isExcluded(candidate) {
  if (state.dismissed.has(keyOf(candidate))) return true;
  const title = normalize(candidate.title);
  for (const item of state.items.values()) {
    if (item.source === candidate.source && item.source_id === String(candidate.source_id)) return true;
    if (candidate.wikidata_id && (item.wikidata_id === candidate.wikidata_id || (item.source === 'wikidata' && item.source_id === candidate.wikidata_id))) return true;
    // même titre, même type, même année à un an près (ex. film enregistré depuis iTunes)
    if (item.type === candidate.type && normalize(item.title) === title
      && (!item.year || !candidate.year || Math.abs(item.year - candidate.year) <= 1)) return true;
  }
  return false;
}

/** Lance plusieurs recherches en parallèle ; une recherche en panne ne bloque pas les autres. */
async function settle(tasks, signal) {
  const results = await Promise.allSettled(tasks);
  if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
  let failures = 0;
  const values = results.map((result) => {
    if (result.status === 'fulfilled') return result.value;
    failures += 1;
    console.warn('[Suggestions] une source ne répond pas :', result.reason?.message);
    return [];
  });
  return { values, failures };
}

/** Films candidats (Wikidata). */
async function fetchFilms(profile, seeds, signal) {
  const genreNames = seeds.cold || !seeds.genres.length ? DEFAULT_GENRES : seeds.genres;
  const { values, failures } = await settle([
    wikidata.filmsBySeeds('director', seeds.directors, signal, { minLinks: 10, limit: 50 }),
    wikidata.filmsBySeeds('actor', seeds.actors, signal, { minLinks: 20, limit: 50 }),
    ...genreNames.map((name) => wikidata.filmsBySeeds('genre', [wikidata.GENRE_IDS[name]], signal, { minLinks: BIG_GENRES.has(name) ? 80 : 55, limit: 30 })),
  ], signal);

  // Un même film peut sortir de plusieurs recherches : on fusionne.
  const found = new Map(); // identifiant Wikidata → { links, actors: [identifiants des acteurs aimés] }
  const note = (rows, kind) => {
    for (const row of rows) {
      if (!found.has(row.qid)) found.set(row.qid, { qid: row.qid, links: row.links, directors: new Set(), actors: new Set() });
      const film = found.get(row.qid);
      film.links = Math.max(film.links, row.links);
      if (kind === 'director') film.directors.add(row.seed);
      if (kind === 'actor') film.actors.add(row.seed);
    }
  };
  note(values[0], 'director');
  note(values[1], 'actor');
  values.slice(2).forEach((rows) => note(rows, 'genre'));

  // On ne charge la fiche que des plus prometteurs : ceux liés à un réalisateur
  // ou un acteur aimé d'abord, puis les plus connus.
  const weightOf = (map, id) => Math.max(0, map.get(id)?.w || 0);
  const shortlist = [...found.values()]
    .filter((film) => !isExcluded({ source: 'wikidata', source_id: film.qid, wikidata_id: film.qid, type: 'film', title: '' }))
    .map((film) => ({
      ...film,
      rough: 3 * [...film.directors].reduce((sum, id) => sum + weightOf(profile.directors, id), 0)
        + 2 * [...film.actors].reduce((sum, id) => sum + weightOf(profile.actors, id), 0)
        + Math.min(film.links, 120) / 120,
    }))
    .sort((a, b) => b.rough - a.rough)
    .slice(0, FILM_POOL);

  const facts = await wikidata.getFilmsFacts(shortlist.map((film) => film.qid), signal);
  const films = [];
  for (const film of shortlist) {
    const fact = facts.get(film.qid);
    if (!fact) continue;
    films.push({
      source: 'wikidata', source_id: film.qid, wikidata_id: film.qid, type: 'film',
      title: fact.title, year: fact.year, countries: fact.countries, genres: fact.genres,
      directors: fact.directors.slice(0, 3),
      // acteurs : ceux que j'aime et qui jouent dans ce film (la distribution
      // complète sera ajoutée si j'enregistre l'œuvre)
      actors: [...film.actors].map((id) => ({ id, name: profile.actors.get(id)?.name || '' })),
      runtime: fact.runtime, poster_url: fact.commonsImage, thumb_url: fact.commonsImage,
      summary_fr: null, summary_original: null, wiki: fact.wiki,
      popularity: Math.min(fact.links, 120) / 120,
    });
  }
  return { films, failures };
}

/** Séries candidates (TVMaze + séries les plus connues). */
async function fetchSeries(profile, seeds, signal) {
  const series = new Map(); // identifiant TVMaze → série
  let failures = 0;
  const keep = (show, extra = {}) => {
    if (!show?.source_id || series.has(show.source_id) || isExcluded(show)) return;
    if (!['Scripted', 'Animation'].includes(show.showType)) return; // pas d'émissions, de documentaires…
    if (!show.poster_url || (show.genres || []).includes('Adulte')) return;
    if (show.runtime && show.runtime < 15) return; // pas de mini-épisodes ni de bonus
    series.set(show.source_id, {
      ...show, directors: [], actors: [],
      // popularité : poids TVMaze (0-100) et note des spectateurs (sur 10)
      popularity: (extra.links ? Math.min(extra.links, 120) / 120 : (show.popularity || 0) / 40 * 0.7)
        + (show.audienceRating ? Math.max(0, show.audienceRating - 7) * 0.15 : 0),
      ...extra,
    });
  };

  // a) les autres séries des acteurs de mes séries préférées
  for (const actorId of seeds.tvActors) {
    try {
      const shows = await tvmaze.castCredits(actorId, signal);
      for (const show of shows) {
        if ((show.audienceRating || 0) < 6.5) continue; // « bien notées » seulement
        keep(show, { actors: [{ id: actorId, name: profile.actors.get(actorId)?.name || '' }] });
        const known = series.get(show.source_id);
        if (known && !known.actors.some((a) => a.id === actorId)) known.actors.push({ id: actorId, name: profile.actors.get(actorId)?.name || '' });
      }
    } catch (error) {
      if (isAbort(error)) throw error;
      failures += 1;
    }
    await wait(120);
  }

  // b) les séries les plus connues, triées d'abord selon mes genres préférés
  try {
    const pool = await wikidata.popularSeries(signal);
    const rough = pool
      .filter((serie) => !serie.forKids && !series.has(serie.tvmazeId)
        && !isExcluded({ source: 'tvmaze', source_id: serie.tvmazeId, type: 'serie', title: serie.title, year: serie.year }))
      .map((serie) => ({ serie, score: scoreCandidate({ ...serie, type: 'serie', popularity: Math.min(serie.links, 120) / 120 }, profile).score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, SERIE_POOL);
    for (const { serie } of rough) {
      if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
      try {
        keep(await tvmaze.getShowLight(serie.tvmazeId, signal), { links: serie.links });
      } catch (error) {
        if (isAbort(error)) throw error;
        failures += 1;
      }
      await wait(160); // TVMaze accepte ~20 requêtes par 10 secondes
    }
  } catch (error) {
    if (isAbort(error)) throw error;
    console.warn('[Suggestions] séries populaires indisponibles :', error.message);
    failures += 1;
  }
  return { series: [...series.values()], failures };
}

/**
 * Charge les suggestions : depuis le cache s'il a moins de 24 h et que mes
 * goûts principaux n'ont pas changé, sinon en interrogeant les sources.
 *   force    : true = bouton « Rafraîchir »
 *   onStep   : (texte) => … pour afficher où on en est
 *   onUpdate : ({ candidates }) => … appelé dès qu'une partie est prête
 */
export async function loadSuggestions({ force = false, signal, onStep = () => {}, onUpdate = () => {} } = {}) {
  await ensureCredits(signal, (done, total) => onStep(`Analyse de ta collection… ${done}/${total}`));
  if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
  const profile = currentProfile();
  const seeds = seedsOf(profile, wikidata.GENRE_IDS);

  if (!force) {
    try {
      const cached = await readSuggestionsCache();
      const age = cached ? (Date.now() - new Date(cached.generated_at).getTime()) / 3600000 : Infinity;
      if (cached && age < CACHE_HOURS && cached.seeds_key === seeds.key && cached.payload?.candidates?.length) {
        return { candidates: cached.payload.candidates, generatedAt: cached.generated_at, seedsKey: seeds.key, fromCache: true, failures: 0 };
      }
    } catch (error) { console.warn('[Suggestions] cache illisible :', error.message); }
  }

  onStep('Recherche de films qui pourraient te plaire…');
  let candidates = [];
  let failures = 0;
  const films = await fetchFilms(profile, seeds, signal).catch((error) => {
    if (isAbort(error)) throw error;
    console.warn('[Suggestions] films indisponibles :', error.message);
    return { films: [], failures: 1 };
  });
  candidates = films.films;
  failures += films.failures;
  onUpdate({ candidates });

  onStep('Recherche de séries qui pourraient te plaire…');
  const series = await fetchSeries(profile, seeds, signal);
  candidates = candidates.concat(series.series);
  failures += series.failures;
  onUpdate({ candidates });

  const generatedAt = new Date().toISOString();
  if (candidates.length) await saveCache(seeds.key, candidates);
  return { candidates, generatedAt, seedsKey: seeds.key, fromCache: false, failures };
}

/** Enregistre les candidats (avec les affiches et résumés déjà récupérés). */
export async function saveCache(seedsKey, candidates) {
  try {
    await writeSuggestionsCache(seedsKey, { version: 1, candidates });
  } catch (error) { console.warn('[Suggestions] cache non enregistré :', error.message); }
}


// ---------------------------------------------------------------------------
//  3. Classement
// ---------------------------------------------------------------------------

/**
 * Classe les candidats pour l'affichage.
 *   type  : 'all' | 'film' | 'serie'      genre : '' ou un genre
 * Renvoie { list: [{ candidate, score, reason }], profile, genres }.
 */
export function rank(candidates, { type = 'all', genre = '' } = {}) {
  const profile = currentProfile();
  const available = candidates.filter((candidate) => !isExcluded(candidate));
  const genres = [...new Set(available.flatMap((candidate) => candidate.genres || []))].sort((a, b) => a.localeCompare(b, 'fr'));
  const scored = available
    .filter((candidate) => (type === 'all' || candidate.type === type) && (!genre || (candidate.genres || []).includes(genre)))
    .map((candidate) => ({ candidate, ...scoreCandidate(candidate, profile) }));
  return { list: diversify(scored), profile, genres };
}

// ---------------------------------------------------------------------------
//  Affiche et résumé d'un film candidat (Wikipédia), chargés à l'affichage
// ---------------------------------------------------------------------------
export async function loadFilmDetails(candidate, signal) {
  if (candidate.type !== 'film' || candidate.detailed) return false;
  const [fr, en] = await Promise.all([
    wikidata.wikipediaSummary('fr', candidate.wiki?.fr, signal),
    wikidata.wikipediaSummary('en', candidate.wiki?.en, signal),
  ]);
  if (fr?.failed || en?.failed) return false; // Wikipédia ne répond pas : on réessaiera
  candidate.poster_url = candidate.poster_url || en?.image || fr?.image || null;
  candidate.thumb_url = candidate.thumb_url || en?.thumb || fr?.thumb || candidate.poster_url;
  if (fr?.extract) candidate.summary_fr = fr.extract;
  else if (en?.extract) candidate.summary_original = en.extract;
  candidate.detailed = true;
  return true;
}
