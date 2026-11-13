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

// Langues des libellés demandés à Wikidata : français, puis « mul » (libellé
// par défaut, commun à toutes les langues — c'est là que Wikidata range les
// titres et les noms identiques partout, comme « Avatar » ou « Christopher
// Nolan »), puis anglais.
const LABELS = 'SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,mul,en". }';
const qidOf = (uri) => String(uri).split('/').pop();
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

/** Exécute une requête SPARQL et renvoie des lignes { variable: valeur }. */
async function sparql(query, signal, timeout = 12000) {
  const url = `${SPARQL}?format=json&query=${encodeURIComponent(query)}`;
  let data;
  // « trop de demandes » (429) ou surcharge passagère (503) : on patiente puis on réessaie
  for (const pause of [1500, 4000, null]) {
    try {
      data = await fetchJson(url, { signal, timeout, headers: { Accept: 'application/sparql-results+json' } });
      break;
    } catch (error) {
      if (pause === null || ![429, 503].includes(error.status) || signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, pause));
      if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
    }
  }
  return (data?.results?.bindings || []).map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, cell.value])));
}

/** Nettoie un texte avant de l'insérer entre guillemets dans une requête. */
function quote(text) {
  return String(text).replace(/[\\"\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * Façons d'écrire un titre exact : tel que tapé, en minuscules, avec une
 * majuscule au début, avec une majuscule à chaque mot… (les titres de
 * Wikidata respectent la casse : « heat » ne trouverait pas « Heat »).
 */
function titleVariants(text) {
  const typed = quote(text);
  const lower = typed.toLocaleLowerCase('fr');
  const first = lower.charAt(0).toLocaleUpperCase('fr') + lower.slice(1);
  const words = lower.replace(/(^|[\s\-:'’])(\p{L})/gu, (m, sep, letter) => sep + letter.toLocaleUpperCase('fr'));
  const variants = new Set([typed, lower, first, words]);
  if (typed.length <= 5) variants.add(typed.toLocaleUpperCase('fr')); // sigles : « HEAT », « MASH »
  return [...variants].filter(Boolean);
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
  // Recherche par TITRE EXACT (français, anglais ou titre international), en plus
  // de la recherche par début de titre. Indispensable pour les titres faits d'un
  // mot courant : « Heat », « Seven », « Ça », « Up »… La recherche par début de
  // titre renvoie d'abord des dizaines d'autres choses portant ce nom, et le
  // film n'y figure même pas. Ici, Wikidata répond très vite (index des titres)
  // et les œuvres les plus connues passent devant (?n négatif).
  const literals = titleVariants(text).flatMap((v) => ['fr', 'en', 'mul'].map((lang) => `"${v}"@${lang}`)).join(' ');
  const exact = mode === 'prefix'
    ? `UNION { VALUES ?label { ${literals} }
             ?item rdfs:label|skos:altLabel ?label; wikibase:sitelinks ?exactLinks.
             BIND(-1 - ?exactLinks AS ?n0) }`
    : '';
  return `SELECT ?item ?itemLabel ?itemDescription ?n (MIN(?date) AS ?d) (MAX(?sl) AS ?links)
      (SAMPLE(?enName) AS ?en) (SAMPLE(?frName) AS ?fr) (SAMPLE(?kind0) AS ?kind)
      (SAMPLE(?tvmaze0) AS ?tvmaze) (SAMPLE(?imdb0) AS ?imdb)
      (SAMPLE(?enLabel0) AS ?enLabel) (SAMPLE(?mulLabel0) AS ?mulLabel) WHERE {
    hint:Query hint:optimizer "None".
    { SELECT ?item (MIN(?n0) AS ?n) WHERE {
        { SERVICE wikibase:mwapi { ${service} } BIND(?n AS ?n0) }
        ${exact}
        FILTER EXISTS { ?item wdt:P31 ?type. VALUES ?type { ${FILM_TYPES} ${SERIE_TYPES} } }
        FILTER NOT EXISTS { ?item wdt:P136 wd:Q185529 } # pas de films pornographiques
      } GROUP BY ?item ORDER BY ?n LIMIT 14 }
    OPTIONAL { ?item wdt:P31 ?serieType. VALUES ?serieType { ${SERIE_TYPES} } BIND("serie" AS ?kind0) }
    OPTIONAL { ?item wdt:P8600 ?tvmaze0 }
    OPTIONAL { ?item wdt:P345 ?imdb0 }
    OPTIONAL { ?item rdfs:label ?enLabel0. FILTER(LANG(?enLabel0) = "en") }
    OPTIONAL { ?item rdfs:label ?mulLabel0. FILTER(LANG(?mulLabel0) = "mul") }
    OPTIONAL { ?item wdt:P577|wdt:P580 ?date }
    OPTIONAL { ?item wikibase:sitelinks ?sl }
    OPTIONAL { ?enPage schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?enName }
    OPTIONAL { ?frPage schema:about ?item; schema:isPartOf <https://fr.wikipedia.org/>; schema:name ?frName }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,mul,en". }
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
    // autres titres (anglais, international) : « Up » doit trouver « Là-haut »
    altTitles: [...new Set([row.enLabel, row.mulLabel].filter((t) => t && t !== row.itemLabel))],
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

  let rows = await sparql(searchQuery(query, 'prefix'), signal);
  // Il arrive (rarement) que Wikidata réponde « rien » au lieu d'une erreur
  // quand son service de recherche est surchargé : on réessaie une fois.
  if (!rows.length && query.trim().length >= 3) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
    rows = await sparql(searchQuery(query, 'prefix'), signal);
  }
  let results = keep(rows);
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
// Identifiant Wikidata de chaque genre de film (sert à chercher des films du même genre).
export const GENRE_IDS = {
  'Science-fiction': 'Q471839', Action: 'Q188473', Aventure: 'Q319221', Thriller: 'Q2484376',
  Drame: 'Q130232', Comédie: 'Q157443', Policier: 'Q959790', Horreur: 'Q200092', Fantasy: 'Q157394',
  Romance: 'Q1054574', Guerre: 'Q369747', Western: 'Q172980', Documentaire: 'Q93204',
  Biographie: 'Q645928', Histoire: 'Q17013749', Musical: 'Q842256', Mystère: 'Q1200678',
  'Comédie dramatique': 'Q859369', 'Comédie romantique': 'Q860626', 'Super-héros': 'Q1535153',
  Espionnage: 'Q2297927', 'Film noir': 'Q185867', Catastrophe: 'Q846544', Famille: 'Q1361932',
};

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
    SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,mul,en". }
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

// Wikipédia refuse les rafales de demandes : on n'en envoie que deux à la
// fois, espacées d'un cinquième de seconde.
let running = 0;
const waiting = [];
async function politely(task) {
  if (running >= 2) await new Promise((resolve) => waiting.push(resolve));
  running += 1;
  try { return await task(); } finally {
    await wait(200);
    running -= 1;
    waiting.shift()?.();
  }
}

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
          const data = await politely(() => fetchJson(url, { timeout: 8000 }));
          return {
            extract: (data.extract || '').trim() || null,
            image: data.originalimage?.source || data.thumbnail?.source || null,
            thumb: data.thumbnail?.source || data.originalimage?.source || null,
          };
        } catch (error) {
          if (error.status === 404) return null; // pas d'article à ce nom
          // « trop de demandes » : on patiente un peu et on réessaie (2 fois au plus)
          if (error.status === 429 && attempt < 2) { await wait(1500 * (attempt + 1)); continue; }
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

// ============================================================================
//  Suggestions (page « Pour toi ») : réalisateurs, acteurs et films candidats
// ============================================================================

/**
 * Réalisateurs et acteurs principaux d'une liste de films.
 * Renvoie Map(identifiant du film → { directors: [{ id, name }], actors: [{ id, name }] }).
 * « Acteurs principaux » = les plus connus de la distribution (ceux dont
 * parlent le plus de Wikipédias), faute d'ordre d'affiche dans Wikidata.
 */
export async function getCredits(qids, signal) {
  const result = new Map();
  for (const part of chunks(qids.filter((q) => /^Q\d+$/.test(q)), 25)) {
    const rows = await sparql(`SELECT ?film ?p ?person ?personLabel ?psl WHERE {
      hint:Query hint:optimizer "None".
      VALUES ?film { ${part.map((q) => `wd:${q}`).join(' ')} }
      VALUES (?prop ?p) { (wdt:P57 "d") (wdt:P161 "a") }
      ?film ?prop ?person.
      ?person wikibase:sitelinks ?psl.
      ${LABELS}
    }`, signal, 20000);
    for (const qid of part) result.set(qid, { directors: [], actors: [] });
    const byFilm = new Map();
    for (const row of rows) {
      const film = qidOf(row.film);
      if (!byFilm.has(film)) byFilm.set(film, []);
      byFilm.get(film).push({ kind: row.p, id: qidOf(row.person), name: row.personLabel, fame: Number(row.psl) || 0 });
    }
    for (const [film, people] of byFilm) {
      const pick = (kind, max) => {
        const seen = new Set();
        return people
          .filter((person) => person.kind === kind && !/^Q\d+$/.test(person.name) && !seen.has(person.id) && seen.add(person.id))
          .sort((a, b) => b.fame - a.fame).slice(0, max)
          .map(({ id, name }) => ({ id, name }));
      };
      result.set(film, { directors: pick('d', 3), actors: pick('a', 6) });
    }
  }
  return result;
}

/**
 * Films liés à des « graines » : des réalisateurs ('director'), des acteurs
 * ('actor') ou un genre ('genre') que l'utilisateur aime.
 * `minLinks` = nombre minimal de Wikipédias qui parlent du film : c'est notre
 * indice de popularité, pour écarter les œuvres trop confidentielles.
 * Renvoie [{ qid, seed, links }] du plus connu au moins connu.
 */
export async function filmsBySeeds(kind, seedIds, signal, { minLinks = 15, limit = 50 } = {}) {
  const property = { director: 'P57', actor: 'P161', genre: 'P136' }[kind];
  const ids = seedIds.filter((q) => /^Q\d+$/.test(q));
  if (!property || !ids.length) return [];
  const rows = await sparql(`SELECT ?film ?seed (MAX(?sl) AS ?links) WHERE {
    VALUES ?seed { ${ids.map((q) => `wd:${q}`).join(' ')} }
    ?film wdt:${property} ?seed; wikibase:sitelinks ?sl.
    FILTER(?sl >= ${Number(minLinks)})
    FILTER EXISTS { ?film wdt:P31 ?type. VALUES ?type { wd:Q11424 wd:Q202866 wd:Q29168811 wd:Q24869 } }
    FILTER NOT EXISTS { ?film wdt:P136 wd:Q185529 }
  } GROUP BY ?film ?seed ORDER BY DESC(?links) LIMIT ${Number(limit)}`, signal, 20000);
  return rows.map((row) => ({ qid: qidOf(row.film), seed: qidOf(row.seed), links: Number(row.links) || 0 }));
}

/**
 * Fiche résumée de plusieurs films en une fois (titre, année, pays, genres,
 * réalisateurs, durée, pages Wikipédia). Renvoie Map(identifiant → faits).
 */
export async function getFilmsFacts(qids, signal) {
  const facts = new Map();
  for (const part of chunks(qids.filter((q) => /^Q\d+$/.test(q)), 30)) {
    const values = part.map((q) => `wd:${q}`).join(' ');
    const [scalars, facets] = await Promise.all([
      sparql(`SELECT ?film ?filmLabel (MIN(?date) AS ?d) (MAX(?sl) AS ?links) (MIN(?dur) AS ?duration)
          (SAMPLE(?enName) AS ?en) (SAMPLE(?frName) AS ?fr) (SAMPLE(?posterImg) AS ?poster) WHERE {
        hint:Query hint:optimizer "None".
        VALUES ?film { ${values} }
        ?film wikibase:sitelinks ?sl.
        OPTIONAL { ?film wdt:P577 ?date }
        OPTIONAL { ?film wdt:P2047 ?dur }
        OPTIONAL { ?film wdt:P3383 ?posterImg }
        OPTIONAL { ?enPage schema:about ?film; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?enName }
        OPTIONAL { ?frPage schema:about ?film; schema:isPartOf <https://fr.wikipedia.org/>; schema:name ?frName }
        ${LABELS}
      } GROUP BY ?film ?filmLabel`, signal, 20000),
      sparql(`SELECT ?film ?p ?v ?vLabel WHERE {
        hint:Query hint:optimizer "None".
        VALUES ?film { ${values} }
        VALUES (?prop ?p) { (wdt:P136 "g") (wdt:P495 "c") (wdt:P57 "d") }
        ?film ?prop ?v.
        ${LABELS}
      }`, signal, 20000),
    ]);
    for (const row of scalars) {
      const year = row.d ? Number(row.d.slice(0, 4)) : null;
      const duration = Math.round(Number(row.duration));
      if (!row.filmLabel || /^Q\d+$/.test(row.filmLabel)) continue; // pas de titre lisible
      facts.set(qidOf(row.film), {
        title: row.filmLabel,
        year: Number.isFinite(year) ? year : null,
        links: Number(row.links) || 0,
        runtime: duration > 0 && duration < 900 ? duration : null,
        wiki: { en: row.en || null, fr: row.fr || null },
        commonsImage: commonsUrl(row.poster) || null,
        genreLabels: [], countries: [], directors: [],
      });
    }
    for (const row of facets) {
      const film = facts.get(qidOf(row.film));
      if (!film || !row.vLabel || /^Q\d+$/.test(row.vLabel)) continue;
      if (row.p === 'g') film.genreLabels.push(row.vLabel);
      else if (row.p === 'c') film.countries.push(capitalize(row.vLabel));
      else if (!film.directors.some((d) => d.id === qidOf(row.v))) film.directors.push({ id: qidOf(row.v), name: row.vLabel });
    }
  }
  for (const film of facts.values()) {
    film.genres = cleanGenres(film.genreLabels);
    film.countries = [...new Set(film.countries)];
    delete film.genreLabels;
  }
  return facts;
}

// Genres des séries dans Wikidata (« série télévisée dramatique », « sitcom »…)
// ramenés au vocabulaire du site (celui de TVMaze, en français).
const SERIE_GENRE_ALIASES = {
  dramatique: 'Drame', policière: 'Policier', policier: 'Policier', comique: 'Comédie', comédie: 'Comédie',
  aventures: 'Aventure', aventure: 'Aventure', jeunesse: 'Jeunesse', médicale: 'Médical', familiale: 'Famille',
  romance: 'Romance', action: 'Action', fantasy: 'Fantasy', 'science-fiction': 'Science-fiction',
  horreur: 'Horreur', fantastique: 'Surnaturel', historique: 'Histoire', judiciaire: 'Judiciaire',
  espionnage: 'Espionnage', western: 'Western', guerre: 'Guerre', thriller: 'Thriller', mystère: 'Mystère',
  anime: 'Anime',
};
export function cleanSerieGenre(label) {
  const text = String(label || '').trim().toLowerCase();
  if (text.startsWith('sitcom')) return 'Comédie';
  const rest = text
    .replace(/^(série|feuilleton)( télévisée?)?( d'animation| animée)?\s*/, '')
    .replace(/^(d'|de la |de |du |des |à l'|à |pour la |pour )/, '');
  return SERIE_GENRE_ALIASES[rest] || null; // genre inconnu du site : ignoré
}

/**
 * Les séries les plus connues (celles dont parlent le plus de Wikipédias) qui
 * existent aussi sur TVMaze. Renvoie [{ tvmazeId, title, year, links, genres }].
 */
export async function popularSeries(signal, limit = 140) {
  const rows = await sparql(`SELECT ?s ?sLabel ?tvmaze ?links (MIN(?date) AS ?d) (GROUP_CONCAT(DISTINCT ?gl; separator="|") AS ?genres) WHERE {
    hint:Query hint:optimizer "None".
    { SELECT ?s (SAMPLE(?tv) AS ?tvmaze) (MAX(?sl) AS ?links) WHERE {
        ?s wdt:P8600 ?tv; wikibase:sitelinks ?sl. FILTER(?sl >= 38)
        FILTER EXISTS { ?s wdt:P31 ?type. VALUES ?type { ${SERIE_TYPES} } }
      } GROUP BY ?s ORDER BY DESC(?links) LIMIT ${Number(limit)} }
    OPTIONAL { ?s wdt:P580 ?date }
    OPTIONAL { ?s wdt:P136 ?g. ?g rdfs:label ?gl. FILTER(LANG(?gl) = "fr") }
    ${LABELS}
  } GROUP BY ?s ?sLabel ?tvmaze ?links ORDER BY DESC(?links)`, signal, 25000);
  return rows
    .filter((row) => /^\d+$/.test(row.tvmaze || '') && row.sLabel && !/^Q\d+$/.test(row.sLabel))
    .map((row) => {
      const labels = row.genres ? row.genres.split('|') : [];
      return {
        tvmazeId: row.tvmaze,
        title: row.sLabel,
        year: row.d ? Number(row.d.slice(0, 4)) : null,
        links: Number(row.links) || 0,
        genres: [...new Set(labels.map(cleanSerieGenre).filter(Boolean))],
        forKids: labels.some((label) => /jeunesse|enfants|préscolaire|ludopédagogie/.test(label)),
      };
    });
}

/** Identifiant Wikidata d'un film à partir de son titre et de son année (films venus d'iTunes). */
export async function findFilmId(title, year, signal) {
  const candidates = await searchFilms(title, signal);
  const wanted = normalize(title);
  const match = candidates.find((c) => normalize(c.title) === wanted && (!year || !c.year || Math.abs(c.year - year) <= 1))
    || candidates.find((c) => year && c.year && Math.abs(c.year - year) <= 1 && normalize(c.title).startsWith(wanted));
  return match ? match.source_id : null;
}

/**
 * Acteurs principaux de films, avec leur photo (Wikidata P161 + P18).
 * Wikidata ne garde pas l'ordre de l'affiche : on retient les `max` acteurs
 * les plus connus de la distribution (ceux dont parlent le plus de
 * Wikipédias), ce qui correspond en pratique aux rôles principaux.
 * Renvoie Map(identifiant du film → [{ id, name, photo }]).
 */
export async function getCastWithPhotos(qids, signal, max = 10) {
  const result = new Map();
  for (const part of chunks(qids.filter((q) => /^Q\d+$/.test(q)), 20)) {
    const rows = await sparql(`SELECT ?film ?person ?personLabel ?psl (SAMPLE(?img) AS ?photo) WHERE {
      hint:Query hint:optimizer "None".
      VALUES ?film { ${part.map((q) => `wd:${q}`).join(' ')} }
      ?film wdt:P161 ?person.
      ?person wikibase:sitelinks ?psl.
      OPTIONAL { ?person wdt:P18 ?img }
      ${LABELS}
    } GROUP BY ?film ?person ?personLabel ?psl`, signal, 25000);
    for (const qid of part) result.set(qid, []);
    for (const row of rows) {
      if (!row.personLabel || /^Q\d+$/.test(row.personLabel)) continue;
      result.get(qidOf(row.film))?.push({
        id: qidOf(row.person), name: row.personLabel, fame: Number(row.psl) || 0,
        photo: row.photo ? `${row.photo.replace(/^http:/, 'https:')}?width=240` : null,
      });
    }
    for (const [qid, list] of result) {
      const seen = new Set();
      result.set(qid, list.filter((p) => !seen.has(p.id) && seen.add(p.id)).sort((a, b) => b.fame - a.fame).slice(0, max)
        .map(({ id, name, photo }) => ({ id, name, photo })));
    }
  }
  return result;
}
