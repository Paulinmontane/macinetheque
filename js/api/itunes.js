// ============================================================================
//  Films : API iTunes Search (gratuite, sans clé, boutique française).
//  Documentation : https://performance-partners.apple.com/search-api
//
//  ⚠️ Cette API est limitée (~20 requêtes par minute) et son catalogue de
//  films est devenu très incomplet. Elle est donc interrogée en premier, et
//  complétée par Wikidata (voir wikidata.js) pour tout ce qu'elle ne trouve pas.
// ============================================================================
import { fetchJson, normalize } from '../utils.js';

const BASE = 'https://itunes.apple.com';

/** Affiche haute résolution : l'URL contient « 100x100 », on demande « 600x600 ». */
export function hiResArtwork(url, size = 600) {
  if (!url) return null;
  return url.replace(/\/\d+x\d+(bb)?(-\d+)?\.(jpg|png|webp)$/i, `/${size}x${size}bb.$3`);
}

/** Convertit un film iTunes vers le format commun du site. */
export function mapMovie(track, index = 0) {
  const artwork = track.artworkUrl100 || track.artworkUrl60 || null;
  const summary = (track.longDescription || track.shortDescription || '').trim();
  return {
    source: 'itunes',
    source_id: String(track.trackId),
    type: 'film',
    // « Mort en Direct (VF) » → « Mort en Direct »
    title: (track.trackName || 'Sans titre').replace(/\s*\((VF|VOST|VOSTFR|VO)\)\s*$/i, ''),
    year: track.releaseDate ? Number(track.releaseDate.slice(0, 4)) : null,
    countries: [], // iTunes ne donne pas le pays de production → complété par Wikidata
    genres: track.primaryGenreName ? [track.primaryGenreName] : [],
    poster_url: hiResArtwork(artwork, 600),
    thumb_url: hiResArtwork(artwork, 200),
    summary_fr: summary || null, // boutique française : résumé déjà en français
    summary_original: null,
    summary_lang: summary ? 'fr' : null,
    runtime: track.trackTimeMillis ? Math.round(track.trackTimeMillis / 60000) : null,
    popularity: Math.max(0, 30 - index * 4), // iTunes classe déjà par pertinence (sans mesurer la notoriété)
    relevance: 0,
  };
}

// iTunes répond « 403 » quand on dépasse sa limite : on le laisse alors
// tranquille une minute au lieu d'insister (Wikidata prend le relais).
let pausedUntil = 0;
async function call(url, signal) {
  if (Date.now() < pausedUntil) throw new Error('iTunes en pause (limite de requêtes atteinte)');
  try {
    return await fetchJson(url, { signal, timeout: 8000 });
  } catch (error) {
    if (error.status === 403 || error.status === 429) pausedUntil = Date.now() + 60000;
    throw error;
  }
}

const onlyMovies = (data) => (data?.results || [])
  .filter((track) => track.kind === 'feature-movie' && track.trackId)
  .slice(0, 8)
  .map(mapMovie);

/** Recherche de films par titre. */
export async function searchMovies(query, signal) {
  const term = encodeURIComponent(query);
  // 1) recherche « films » classique
  let movies = onlyMovies(await call(`${BASE}/search?term=${term}&media=movie&entity=movie&country=fr&lang=fr_fr&limit=8`, signal));
  // 2) si elle ne renvoie rien (cas fréquent désormais), recherche générale
  //    dans la boutique, dont on ne garde que les films
  if (!movies.length && query.trim().length >= 3) {
    // (cette recherche fouille aussi les descriptions : on écarte les films
    //  dont le titre n'a aucun rapport avec ce qui est tapé)
    const wanted = normalize(query);
    movies = onlyMovies(await call(`${BASE}/search?term=${term}&country=fr&lang=fr_fr&limit=50`, signal))
      .filter((movie) => normalize(movie.title).includes(wanted));
  }
  return movies;
}

/** Fiche d'un film à partir de son identifiant iTunes. */
export async function getMovie(id, signal) {
  const data = await call(`${BASE}/lookup?id=${encodeURIComponent(id)}&country=fr&lang=fr_fr`, signal);
  const track = (data?.results || []).find((t) => t.kind === 'feature-movie');
  if (!track) throw new Error('Film introuvable sur iTunes');
  return mapMovie(track);
}
