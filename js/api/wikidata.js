// ============================================================================
//  Films : Wikidata + Wikipédia (gratuits, sans clé, appelables du navigateur).
//
//  Rôle :
//   1. compléter iTunes avec le PAYS DE PRODUCTION (et les genres) d'un film ;
//   2. servir de source de films à part entière quand iTunes ne trouve rien
//      (recherche, année, pays, genres, durée) ; l'affiche et le résumé français
//      viennent alors de Wikipédia ;
//   3. proposer aussi les SÉRIES dès les premières lettres tapées (TVMaze ne
//      cherche que des mots entiers : « break » ne trouve pas « Breaking Bad »).
//      Wikidata connaît l'identifiant TVMaze de chaque série : la fiche, les
//      saisons et les épisodes viennent ensuite de TVMaze, comme d'habitude.
//
//  On utilise le point d'accès SPARQL de Wikidata (query.wikidata.org) et
//  l'API REST de Wikipédia : les deux autorisent les appels depuis un site web.
// ============================================================================
import { fetchJson, normalize, capitalize } from '../utils.js';

const SPARQL = 'https://query.wikidata.org/sparql';

// Types Wikidata considérés comme « un film » (film, film d'animation,
// long métrage, téléfilm, documentaire, court métrage…).
const FILM_TYPES = [
  'Q11424', 'Q202866', 'Q29168811', 'Q24869', 'Q506240', 'Q93204',
  'Q226730', 'Q20650540', 'Q24862', 'Q17517379',
].map((q) => `wd:${q}`).join(' ');

// Types Wikidata considérés comme « une série » (série télévisée, série web,
// mini-série, série d'animation, anime, sitcom, docu-série…).
const SERIE_TYPES = [
  'Q5398426', 'Q526877', 'Q1259759', 'Q581714', 'Q63952888', 'Q117467246',
  'Q15416', 'Q21188110',
].map((q) => `wd:${q}`).join(' ');

/** Exécute une requête SPARQL et renvoie des lignes { variable: valeur }. */
async function sparql(query, signal, timeout = 12000) {
  const url = `${SPARQL}?format=json&query=${encodeURIComponent(query)}`;
  const data = await fetchJson(url, { signal, timeout, headers: { Accept: 'application/sparql-results+json' } });
  return (data?.results?.bindings || []).map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, cell.value])));
}

/** Nettoie un texte avant de l'insérer entre guillemets dans une requête. */
function quote(text) {
  return String(text).replace(/[\\"\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Construit la requête de recherche (par début de titre, ou en plein texte). */
function searchQuery(text, mode) {
  const service = mode === 'prefix'
    ? `bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch";
         mwapi:search "${quote(text)}"; mwapi:language "fr"; mwapi:limit 50 .
       ?item wikibase:apiOutputItem mwapi:item. ?n wikibase:apiOrdinal true.`
    : `bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "Search";
         mwapi:srsearch "${quote(text)} haswbstatement:P31=Q11424|P31=Q202866|P31=Q29168811|P31=Q24869|P31=Q506240|P31=Q5398426";
         mwapi:srlimit 10 .
       ?item wikibase:apiOutputItem mwapi:title. ?n wikibase:apiOrdinal true.`;
  return `SELECT ?item ?itemLabel ?itemDescription ?n (MIN(?date) AS ?d) (MAX(?sl) AS ?links)
      (SAMPLE(?enName) AS ?en) (SAMPLE(?frName) AS ?fr) (SAMPLE(?kind0) AS ?kind)
      (SAMPLE(?tvmaze0) AS ?tvmaze) (SAMPLE(?imdb0) AS ?imdb) WHERE {
    hint:Query hint:optimizer "None".
    { SELECT ?item ?n WHERE {
        SERVICE wikibase:mwapi { ${service} }
        FILTER EXISTS { ?item wdt:P31 ?type. VALUES ?type { ${FILM_TYPES} ${SERIE_TYPES} } }
        FILTER NOT EXISTS { ?item wdt:P136 wd:Q185529 } # pas de films pornographiques
      } ORDER BY ?n LIMIT 10 }
    OPTIONAL { ?item wdt:P31 ?serieType. VALUES ?serieType { ${SERIE_TYPES} } BIND("serie" AS ?kind0) }
    OPTIONAL { ?item wdt:P8600 ?tvmaze0 }
    OPTIONAL { ?item wdt:P345 ?imdb0 }
    OPTIONAL { ?item wdt:P577|wdt:P580 ?date }
    OPTIONAL { ?item wikibase:sitelinks ?sl }
    OPTIONAL { ?enPage schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?enName }
    OPTIONAL { ?frPage schema:about ?item; schema:isPartOf <https://fr.wikipedia.org/>; schema:name ?frName }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
  } GROUP BY ?item ?itemLabel ?itemDescription ?n ORDER BY ?n`;
}

/** Convertit une ligne de résultat de recherche vers le format commun. */
function mapSearchRow(row) {
  const qid = row.item.split('/').pop();
  const year = row.d ? Number(row.d.slice(0, 4)) : null;
  const isSerie = row.kind === 'serie';
  // Une série est ouverte directement sur TVMaze (identifiant connu de Wikidata),
  // ou retrouvée sur TVMaze grâce à son identifiant IMDb.
  let source = 'wikidata';
  let sourceId = qid;
  if (isSerie) {
    if (/^\d+$/.test(row.tvmaze || '')) { source = 'tvmaze'; sourceId = row.tvmaze; }
    else if (/^tt\d+$/.test(row.imdb || '')) { source = 'tvmaze-imdb'; sourceId = row.imdb; }
    else return null; // série inconnue de TVMaze : impossible d'afficher ses épisodes
  }
  return {
    source,
    source_id: sourceId,
    type: isSerie ? 'serie' : 'film',
    title: row.itemLabel,
    year: Number.isFinite(year) ? year : null,
    countries: [],
    genres: [],
    poster_url: null,
    thumb_url: null,
    summary_fr: null,
    summary_original: null,
    summary_lang: null,
    runtime: null,
    description: row.itemDescription || null, // ex. « film de Christopher Nolan, sorti en 2010 »
    fromWikidata: true,
    wiki: { en: row.en || null, fr: row.fr || null },
    popularity: Math.min(Number(row.links) || 0, 150) / 1.5, // nombre de Wikipédias qui en parlent
    relevance: 0,
  };
}

/** Recherche de films par titre. */
/** Recherche de films ET de séries par début de titre (puis en plein texte si besoin). */
export async function searchTitles(query, signal) {
  const keep = (rows) => rows
    .filter((row) => row.itemLabel && !/^Q\d+$/.test(row.itemLabel)) // sans titre lisible → ignoré
    .map(mapSearchRow)
    .filter(Boolean)
    // fiches Wikidata quasi vides (ni année, ni article Wikipédia) → ignorées
    .filter((film) => film.year || film.wiki.en || film.wiki.fr);

  let results = keep(await sparql(searchQuery(query, 'prefix'), signal));
  // Peu de résultats par « début de titre » (ex. « amelie poulain ») :
  // on complète avec une recherche en plein texte.
  if (results.length < 3 && query.trim().length >= 4) {
    try {
      const more = keep(await sparql(searchQuery(query, 'fulltext'), signal));
      const known = new Set(results.map((r) => r.source_id));
      results = results.concat(more.filter((r) => !known.has(r.source_id)));
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      // la recherche complémentaire est facultative : on garde ce qu'on a
    }
  }
  return results;
}

/** Recherche de films uniquement (sert à retrouver le pays d'un film iTunes). */
export async function searchFilms(query, signal) {
  return (await searchTitles(query, signal)).filter((item) => item.type === 'film');
}

// ---------------------------------------------------------------------------
//  Genres : Wikidata donne des libellés longs (« film ou téléfilm d'aventure »)
//  qu'on ramène à des genres courts (« Aventure »).
// ---------------------------------------------------------------------------
const GENRE_ALIASES = {
  dramatique: 'Drame', drame: 'Drame', biographique: 'Biographie', historique: 'Histoire',
  criminel: 'Policier', policier: 'Policier', romantique: 'Romance', amour: 'Romance',
  familial: 'Famille', 'pour enfants': 'Jeunesse', musical: 'Musical', énigme: 'Mystère',
  fantastique: 'Fantastique', documentaire: 'Documentaire', animation: 'Animation',
  'comédie': 'Comédie', comique: 'Comédie', horreur: 'Horreur', épouvante: 'Horreur',
};
export function cleanGenre(label) {
  let text = String(label || '').trim().toLowerCase();
  if (!text || text === 'film noir') return text ? 'Film noir' : '';
  text = text
    .replace(/^(film|cinéma|téléfilm|série)( (ou|et) (téléfilm|série télévisée))?\s+/, '')
    .replace(/^(d'|de la |de |du |des |à |a )/, '');
  return GENRE_ALIASES[text] || capitalize(text);
}
// Genres « principaux », par ordre de préférence quand il faut en choisir quelques-uns.
const MAIN_GENRES = [
  'Science-fiction', 'Action', 'Aventure', 'Thriller', 'Drame', 'Comédie', 'Policier', 'Horreur',
  'Fantastique', 'Fantasy', 'Animation', 'Romance', 'Guerre', 'Western', 'Documentaire',
  'Biographie', 'Histoire', 'Musical', 'Mystère', 'Famille', 'Jeunesse', 'Comédie dramatique',
  'Comédie romantique', 'Film noir', 'Espionnage', 'Catastrophe', 'Super-héros',
];
export function cleanGenres(labels, max = 4) {
  const seen = new Set();
  const genres = [];
  for (const label of labels) {
    const genre = cleanGenre(label);
    const key = normalize(genre);
    // on écarte les sous-genres trop longs (« Action de science-fiction »…)
    if (!genre || seen.has(key) || genre.split(' ').length > 2) continue;
    seen.add(key);
    genres.push(genre);
  }
  const rank = (g) => { const i = MAIN_GENRES.indexOf(g); return i === -1 ? 100 + g.length : i; };
  return genres.sort((a, b) => rank(a) - rank(b)).slice(0, max);
}

/** Détails Wikidata d'un film : année, pays, genres, durée, affiche libre, pages Wikipédia. */
export async function getFilmFacts(qid, signal) {
  if (!/^Q\d+$/.test(qid)) throw new Error('Identifiant Wikidata invalide');
  const rows = await sparql(`SELECT ?itemLabel ?itemDescription (MIN(?date) AS ?d)
      (GROUP_CONCAT(DISTINCT ?countryLabel; separator="|") AS ?countries)
      (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") AS ?genres)
      (MIN(?dur) AS ?duration) (SAMPLE(?posterImg) AS ?poster) (SAMPLE(?img) AS ?image)
      (SAMPLE(?enName) AS ?en) (SAMPLE(?frName) AS ?fr) WHERE {
    VALUES ?item { wd:${qid} }
    OPTIONAL { ?item wdt:P577 ?date }
    OPTIONAL { ?item wdt:P495 ?country. ?country rdfs:label ?countryLabel. FILTER(LANG(?countryLabel) = "fr") }
    OPTIONAL { ?item wdt:P136 ?genre. ?genre rdfs:label ?genreLabel. FILTER(LANG(?genreLabel) = "fr") }
    OPTIONAL { ?item wdt:P2047 ?dur }
    OPTIONAL { ?item wdt:P3383 ?posterImg }
    OPTIONAL { ?item wdt:P18 ?img }
    OPTIONAL { ?enPage schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?enName }
    OPTIONAL { ?frPage schema:about ?item; schema:isPartOf <https://fr.wikipedia.org/>; schema:name ?frName }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
  } GROUP BY ?itemLabel ?itemDescription`, signal);

  const row = rows[0];
  if (!row || !row.itemLabel) throw new Error('Film introuvable sur Wikidata');
  const year = row.d ? Number(row.d.slice(0, 4)) : null;
  const duration = Math.round(Number(row.duration));
  return {
    title: row.itemLabel,
    description: row.itemDescription || null,
    year: Number.isFinite(year) ? year : null,
    countries: row.countries ? row.countries.split('|').map(capitalize) : [],
    genres: row.genres ? cleanGenres(row.genres.split('|')) : [],
    runtime: duration > 0 && duration < 900 ? duration : null,
    commonsImage: commonsUrl(row.poster) || null, // vraie affiche libre de droits (rare)
    fallbackImage: commonsUrl(row.image) || null, // autre image d'illustration
    wiki: { en: row.en || null, fr: row.fr || null },
  };
}

/** Lien d'image Wikimedia Commons en https, redimensionnée à 600 px de large. */
function commonsUrl(url) {
  if (!url) return null;
  return `${url.replace(/^http:/, 'https:')}?width=600`;
}

// ---------------------------------------------------------------------------
//  Wikipédia : résumé d'introduction + image principale d'un article.
// ---------------------------------------------------------------------------
const summaryCache = new Map();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Renvoie { extract, image, thumb } pour un article, `null` si l'article
 * n'existe pas, ou { failed: true } si Wikipédia n'a pas répondu (panne
 * passagère, trop de demandes) — pour que l'appelant sache que c'est provisoire.
 */
export async function wikipediaSummary(lang, title, signal) {
  if (!title) return null;
  const key = `${lang}:${title}`;
  // Une seule requête par article : les demandes suivantes réutilisent la première.
  if (!summaryCache.has(key)) {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
    const load = async () => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const data = await fetchJson(url, { timeout: 8000 });
          return {
            extract: (data.extract || '').trim() || null,
            image: data.originalimage?.source || data.thumbnail?.source || null,
            thumb: data.thumbnail?.source || data.originalimage?.source || null,
          };
        } catch (error) {
          if (error.status === 404) return null; // pas d'article à ce nom
          // « trop de demandes » : on patiente un peu et on réessaie (2 fois au plus)
          if (error.status === 429 && attempt < 2) { await wait(900 * (attempt + 1)); continue; }
          setTimeout(() => summaryCache.delete(key), 20000); // on pourra réessayer plus tard
          return { failed: true };
        }
      }
    };
    summaryCache.set(key, load());
  }
  const result = await summaryCache.get(key);
  if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
  return result;
}

/** Miniature d'affiche pour une suggestion de recherche (Wikipédia). */
export async function thumbFor(item, signal) {
  const en = await wikipediaSummary('en', item.wiki?.en, signal);
  if (en?.thumb) return en.thumb;
  const fr = await wikipediaSummary('fr', item.wiki?.fr, signal);
  return fr?.thumb || null;
}

/** Fiche complète d'un film Wikidata : faits + affiche + résumé. */
export async function getFilm(qid, signal) {
  const facts = await getFilmFacts(qid, signal);
  const [fr, en] = await Promise.all([
    wikipediaSummary('fr', facts.wiki.fr, signal),
    wikipediaSummary('en', facts.wiki.en, signal),
  ]);
  // Wikipédia n'a pas répondu : la fiche est provisoirement incomplète.
  const partial = !!(fr?.failed || en?.failed);
  // Affiche : affiche libre (Commons) > image de l'article anglais (souvent
  // l'affiche du film) > image de l'article français > autre illustration
  // (en dernier recours seulement, et jamais à cause d'une simple panne).
  const poster = facts.commonsImage || en?.image || fr?.image || (partial ? null : facts.fallbackImage) || null;
  const summaryFr = fr?.extract || null;
  const summaryEn = !summaryFr ? en?.extract || null : null;
  return {
    source: 'wikidata',
    source_id: qid,
    type: 'film',
    title: facts.title,
    year: facts.year,
    countries: facts.countries,
    genres: facts.genres,
    poster_url: poster,
    thumb_url: en?.thumb || fr?.thumb || poster,
    summary_fr: summaryFr,
    summary_original: summaryEn,
    summary_lang: summaryFr ? 'fr' : summaryEn ? 'en' : null,
    runtime: facts.runtime,
    description: facts.description,
    wiki: facts.wiki,
    partial,
  };
}

/**
 * Pour un film venu d'iTunes : retrouve le même film sur Wikidata (même titre,
 * même année à un an près) et renvoie son pays de production, ses genres, etc.
 */
export async function findFilmFacts(title, year, signal) {
  const candidates = await searchFilms(title, signal);
  const wanted = normalize(title);
  const match = candidates.find((c) => normalize(c.title) === wanted && (!year || !c.year || Math.abs(c.year - year) <= 1))
    || candidates.find((c) => year && c.year && Math.abs(c.year - year) <= 1 && normalize(c.title).startsWith(wanted));
  if (!match) return null;
  return getFilmFacts(match.source_id, signal);
}
