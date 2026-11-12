// ============================================================================
//  Profil de goûts et classement des suggestions (calculs purs, sans réseau).
//
//  1. buildProfile : à partir de mes notes, donne un « poids » à chaque genre,
//     réalisateur, acteur, pays et décennie.
//       5★ = +2   4★ = +1   3★ = 0   2★ = −1   1★ = −2
//     (pour une série : la note la plus précise disponible — la série, sinon
//     la moyenne des saisons, sinon la moyenne des épisodes)
//     Liste « à voir » : léger signal positif. « Pas intéressé » : léger négatif.
//  2. scoreCandidate : note une œuvre candidate avec ces poids + un bonus de
//     popularité, et dit POURQUOI elle est proposée.
//  3. diversify : évite d'enchaîner dix films du même réalisateur.
// ============================================================================

export const WATCHLIST_WEIGHT = 0.5; // une œuvre que je veux voir : léger « j'aime »
export const DISMISSED_WEIGHT = -0.5; // une suggestion refusée : léger « je n'aime pas »
export const MIN_RATED = 3; // en dessous : pas assez de notes pour personnaliser

/** Poids d'une note : 5 → +2, 4 → +1, 3 → 0, 2 → −1, 1 → −2 (les moyennes donnent des valeurs intermédiaires). */
export function weightOf(rating) { return rating - 3; }

const decadeOf = (year) => (year ? Math.floor(year / 10) * 10 : null);

/**
 * Construit le profil.
 *   entries   : la collection (store.collection()) — { item, rating } par œuvre
 *   watchlist : les œuvres de la liste « à voir »
 *   dismissed : les suggestions refusées ({ title, facets })
 */
export function buildProfile({ entries = [], watchlist = [], dismissed = [] }) {
  const profile = {
    rated: 0, // nombre d'œuvres ayant une note exploitable
    genres: new Map(), directors: new Map(), actors: new Map(), countries: new Map(), decades: new Map(),
  };

  /** Ajoute le poids `w` d'une œuvre à l'une de ses caractéristiques. */
  const bump = (map, key, name, w, title) => {
    if (key == null || key === '') return;
    if (!map.has(key)) map.set(key, { w: 0, name, liked: null });
    const facet = map.get(key);
    facet.w += w;
    // on retient l'œuvre la mieux notée qui a cette caractéristique : elle
    // servira à expliquer la suggestion (« Parce que tu as aimé … »)
    if (title && w > 0 && (!facet.liked || w > facet.liked.w)) facet.liked = { title, w };
  };
  const add = (source, w, title) => {
    for (const genre of source.genres || []) bump(profile.genres, genre, genre, w, title);
    for (const person of source.directors || []) bump(profile.directors, person.id, person.name, w, title);
    for (const person of source.actors || []) bump(profile.actors, person.id, person.name, w, title);
    for (const country of source.countries || []) bump(profile.countries, country, country, w, title);
    const decade = decadeOf(source.year);
    if (decade) bump(profile.decades, decade, `années ${decade}`, w, title);
  };

  for (const entry of entries) {
    if (entry.rating == null) continue; // vu mais jamais noté : ne dit rien de mes goûts
    profile.rated += 1;
    add(entry.item, weightOf(entry.rating), entry.item.title);
  }
  for (const item of watchlist) add(item, WATCHLIST_WEIGHT, null);
  for (const row of dismissed) add(row.facets || {}, DISMISSED_WEIGHT, null);
  return profile;
}

/** Les meilleures entrées (poids > 0) d'une caractéristique, de la plus aimée à la moins aimée. */
function top(map, max, filter = () => true) {
  return [...map.entries()]
    .filter(([key, facet]) => facet.w > 0 && filter(key))
    .sort((a, b) => b[1].w - a[1].w)
    .slice(0, max)
    .map(([key]) => key);
}

/**
 * Les « graines » : ce que j'aime le plus, et dont on va chercher des œuvres proches.
 * `key` résume ces graines : si elle change, les suggestions sont recalculées.
 */
export function seedsOf(profile, genreIds) {
  const seeds = {
    directors: top(profile.directors, 4, (id) => /^Q\d+$/.test(id)),
    actors: top(profile.actors, 5, (id) => /^Q\d+$/.test(id)), // acteurs de films (identifiants Wikidata)
    tvActors: top(profile.actors, 4, (id) => /^tm\d+$/.test(id)), // acteurs de séries (identifiants TVMaze)
    genres: top(profile.genres, 3, (name) => !!genreIds[name]),
    cold: profile.rated < MIN_RATED,
  };
  seeds.key = JSON.stringify([seeds.cold, seeds.directors, seeds.actors, seeds.tvActors, seeds.genres]);
  return seeds;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const maxPositive = (map) => Math.max(1, ...[...map.values()].map((facet) => facet.w));

/**
 * Note une œuvre candidate. Renvoie { score, reason, reasonKey, parts }.
 *   candidate : { title, type, genres, countries, year, directors, actors, popularity (0-1) }
 */
export function scoreCandidate(candidate, profile) {
  const norm = {
    directors: maxPositive(profile.directors), actors: maxPositive(profile.actors),
    genres: maxPositive(profile.genres), countries: maxPositive(profile.countries), decades: maxPositive(profile.decades),
  };
  const weight = (map, key, scale) => (map.has(key) ? map.get(key).w / scale : 0);

  // Réalisateurs et acteurs : on additionne (un film peut réunir deux personnes aimées).
  const people = (list, map, scale) => (list || []).map((person) => ({ ...person, facet: map.get(person.id), value: weight(map, person.id, scale) }));
  const directors = people(candidate.directors, profile.directors, norm.directors);
  const actors = people(candidate.actors, profile.actors, norm.actors);
  // Genres : moyenne des genres de l'œuvre (un genre inconnu de mes goûts compte pour 0).
  const genres = (candidate.genres || []).map((name) => ({ name, facet: profile.genres.get(name), value: weight(profile.genres, name, norm.genres) }));

  const parts = {
    directors: 3 * clamp(directors.reduce((sum, d) => sum + d.value, 0), -1.5, 1.5),
    actors: 2 * clamp(actors.reduce((sum, a) => sum + a.value, 0), -1.5, 1.5),
    genres: 2 * (genres.length ? genres.reduce((sum, g) => sum + g.value, 0) / genres.length : 0),
    countries: 0.5 * Math.max(0, ...(candidate.countries || []).map((c) => weight(profile.countries, c, norm.countries))),
    decade: 0.4 * weight(profile.decades, decadeOf(candidate.year), norm.decades),
    popularity: clamp(candidate.popularity ?? 0, 0, 1.3), // bonus : évite les œuvres trop confidentielles
  };
  const score = Object.values(parts).reduce((a, b) => a + b, 0);

  // La raison affichée : la caractéristique aimée qui pèse le plus.
  const bestOf = (list) => list.filter((x) => x.value > 0 && x.facet?.liked).sort((a, b) => b.value - a.value)[0];
  const director = bestOf(directors);
  const actor = bestOf(actors);
  const genre = bestOf(genres);
  let reason = { liked: null, text: candidate.type === 'serie' ? 'Une série très populaire' : 'Un film très populaire' };
  let reasonKey = 'populaire';
  if (director && parts.directors >= Math.max(parts.actors, parts.genres, 0.3)) {
    reason = { liked: director.facet.liked.title, text: `même réalisateur : ${director.name}` };
    reasonKey = `réal:${director.id}`;
  } else if (actor && parts.actors >= Math.max(parts.genres, 0.3)) {
    reason = { liked: actor.facet.liked.title, text: `aussi avec ${actor.name}` };
    reasonKey = `acteur:${actor.id}`;
  } else if (genre && parts.genres >= 0.3) {
    reason = { liked: genre.facet.liked.title, text: `même genre : ${genre.name.toLowerCase()}` };
    reasonKey = `genre:${genre.name}`;
  }
  return { score, reason, reasonKey, parts };
}

/**
 * Classe les candidats en variant les plaisirs : chaque nouvelle suggestion
 * perd des points si son réalisateur, sa raison ou son type ont déjà été
 * beaucoup proposés juste avant.
 *   scored : [{ candidate, score, reasonKey }]
 */
export function diversify(scored) {
  const remaining = [...scored];
  const ordered = [];
  const seen = new Map(); // clé → nombre de fois déjà retenue
  const count = (key) => seen.get(key) || 0;
  const keysOf = (entry) => [
    entry.reasonKey,
    ...(entry.candidate.directors || []).map((d) => `réal:${d.id}`),
    `type:${entry.candidate.type}`,
  ];
  while (remaining.length) {
    let best = 0;
    let bestValue = -Infinity;
    remaining.forEach((entry, index) => {
      const directors = (entry.candidate.directors || []).reduce((sum, d) => sum + count(`réal:${d.id}`), 0);
      const value = entry.score
        - 1.3 * directors * directors // pas dix films du même réalisateur à la suite (la pénalité grandit vite)
        - 0.7 * (entry.reasonKey.startsWith('réal:') ? 0 : count(entry.reasonKey)) // ni dix fois la même raison
        - 0.12 * count(`type:${entry.candidate.type}`); // films et séries alternent
      if (value > bestValue) { bestValue = value; best = index; }
    });
    const [picked] = remaining.splice(best, 1);
    for (const key of new Set(keysOf(picked))) seen.set(key, count(key) + 1);
    ordered.push(picked);
  }
  return ordered;
}
