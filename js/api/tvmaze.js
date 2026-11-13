// ============================================================================
//  Séries : API TVMaze (gratuite, sans clé, appelable depuis le navigateur).
//  Documentation : https://www.tvmaze.com/api
// ============================================================================
import { fetchJson, stripHtml, countryName } from '../utils.js';

const BASE = 'https://api.tvmaze.com';

// TVMaze donne les genres en anglais : on les traduit une fois pour toutes.
const GENRES_FR = {
  Action: 'Action', Adult: 'Adulte', Adventure: 'Aventure', Anime: 'Anime', Children: 'Jeunesse',
  Comedy: 'Comédie', Crime: 'Policier', DIY: 'Bricolage', Drama: 'Drame', Espionage: 'Espionnage',
  Family: 'Famille', Fantasy: 'Fantastique', Food: 'Cuisine', History: 'Histoire', Horror: 'Horreur',
  Legal: 'Judiciaire', Medical: 'Médical', Music: 'Musique', Mystery: 'Mystère', Nature: 'Nature',
  Romance: 'Romance', 'Science-Fiction': 'Science-fiction', Sports: 'Sport', Supernatural: 'Surnaturel',
  Thriller: 'Thriller', Travel: 'Voyage', War: 'Guerre', Western: 'Western',
};

/** Convertit une série TVMaze vers le format commun du site. */
export function mapShow(show, relevance = 0) {
  const country = show.network?.country || show.webChannel?.country || null;
  const summary = stripHtml(show.summary);
  return {
    source: 'tvmaze',
    source_id: String(show.id),
    type: 'serie',
    title: show.name || 'Sans titre',
    year: show.premiered ? Number(show.premiered.slice(0, 4)) : null,
    countries: country ? [countryName(country.code, country.name)] : [],
    genres: (show.genres || []).map((g) => GENRES_FR[g] || g),
    poster_url: show.image?.original || show.image?.medium || null,
    thumb_url: show.image?.medium || show.image?.original || null,
    summary_fr: null,
    summary_original: summary || null,
    summary_lang: summary ? 'en' : null, // les résumés TVMaze sont rédigés en anglais
    runtime: show.averageRuntime || show.runtime || null,
    // popularité (0-100) et pertinence, utilisées pour classer les suggestions
    // Popularité TVMaze (0-100) : elle favorise les séries récentes et reste
    // peu fiable. On la réduit ; quand Wikidata connaît la série, c'est son
    // nombre de pages Wikipédia qui sert de mesure (voir catalog.js).
    popularity: (show.weight || 0) * 0.4,
    // note moyenne des spectateurs de TVMaze (sur 10) et nature de l'émission
    audienceRating: show.rating?.average ?? null,
    showType: show.type || null,
    relevance,
  };
}

/** Recherche de séries par titre. */
export async function searchShows(query, signal) {
  const data = await fetchJson(`${BASE}/search/shows?q=${encodeURIComponent(query)}`, { signal });
  return (data || [])
    .filter((entry) => !(entry.show.genres || []).includes('Adult')) // pas de contenu pour adultes
    .map((entry) => mapShow(entry.show, entry.score || 0));
}

/** Retrouve l'identifiant TVMaze d'une série à partir de son identifiant IMDb (tt0903747…). */
export async function idFromImdb(imdbId, signal) {
  const show = await fetchJson(`${BASE}/lookup/shows?imdb=${encodeURIComponent(imdbId)}`, { signal });
  if (!show?.id) throw new Error('Série introuvable sur TVMaze');
  return String(show.id);
}

/** Fiche complète d'une série : infos + saisons + épisodes (une seule requête). */
export async function getShow(id, signal) {
  const show = await fetchJson(`${BASE}/shows/${encodeURIComponent(id)}?embed[]=seasons&embed[]=episodes`, { signal });
  const item = mapShow(show);

  // On ne garde que les épisodes « normaux » (les hors-séries n'ont pas de numéro).
  const episodes = (show._embedded?.episodes || []).filter((ep) => ep.number != null && ep.season != null);
  const seasonsInfo = new Map((show._embedded?.seasons || []).map((s) => [s.number, s]));

  const bySeason = new Map();
  for (const ep of episodes) {
    if (!bySeason.has(ep.season)) bySeason.set(ep.season, []);
    bySeason.get(ep.season).push({
      number: ep.number,
      title: ep.name || `Épisode ${ep.number}`,
      airdate: ep.airdate || null,
      runtime: ep.runtime || item.runtime || null,
      summary: stripHtml(ep.summary) || null,
    });
  }

  item.seasons = [...bySeason.keys()].sort((a, b) => a - b).map((number) => {
    const info = seasonsInfo.get(number);
    const list = bySeason.get(number).sort((a, b) => a.number - b.number);
    return {
      number,
      year: (info?.premiereDate || list[0]?.airdate || '').slice(0, 4) || null,
      episodes: list,
    };
  });
  return item;
}

// ---------------------------------------------------------------------------
//  Suggestions (page « Pour toi »)
// ---------------------------------------------------------------------------

/** Fiche courte d'une série (sans les épisodes). */
export async function getShowLight(id, signal) {
  return mapShow(await fetchJson(`${BASE}/shows/${encodeURIComponent(id)}`, { signal }));
}

/** Acteurs principaux d'une série : [{ id: 'tm14245', name: 'Bryan Cranston' }]. */
export async function getCast(id, signal, max = 6) {
  const cast = await fetchJson(`${BASE}/shows/${encodeURIComponent(id)}/cast`, { signal });
  const seen = new Set();
  return (cast || [])
    .map((entry) => entry.person)
    .filter((person) => person?.id && !seen.has(person.id) && seen.add(person.id))
    .slice(0, max)
    .map((person) => ({ id: `tm${person.id}`, name: person.name, photo: person.image?.medium?.replace(/^http:/, 'https:') || null }));
}

/** Les autres séries d'un acteur (identifiant « tm14245 »), avec leur fiche courte. */
export async function castCredits(personId, signal) {
  const id = String(personId).replace(/^tm/, '');
  const credits = await fetchJson(`${BASE}/people/${encodeURIComponent(id)}/castcredits?embed=show`, { signal });
  return (credits || []).map((credit) => credit._embedded?.show).filter(Boolean).map((show) => mapShow(show));
}
