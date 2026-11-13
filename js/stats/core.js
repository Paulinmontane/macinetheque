// ============================================================================
//  Module de calcul commun : temps de visionnage, compteurs, récaps, acteurs.
//  Utilisé par la page Statistiques, les Récaps et les stats sur les acteurs.
//  Fonctions « pures » (aucun accès au réseau ni à la page) : faciles à tester.
//
//  Règles :
//   - une œuvre / un épisode compte dans une période selon SA DATE DE
//     VISIONNAGE ; « date inconnue » compte seulement dans « depuis toujours » ;
//   - les dates de visionnage sont des jours (AAAA-MM-JJ) déjà à l'heure de
//     Paris : jour, mois et année se découpent donc directement dans la date ;
//   - durée : celle du film ou de l'épisode ; à défaut, la durée moyenne des
//     épisodes de la série ; à défaut, 110 min (film) ou 45 min (épisode),
//     signalé comme « durée estimée » ;
//   - une SAISON notée ou marquée vue sans ses épisodes compte pour tous ses
//     épisodes, à la date de la saison, sans doublon avec les épisodes notés
//     un par un (un épisode noté garde sa propre date) ;
//   - une série est « regardée » sur une période s'il y a au moins un épisode
//     (ou une saison) vu dans la période.
// ============================================================================

export const DEFAULT_FILM_MINUTES = 110;
export const DEFAULT_EPISODE_MINUTES = 45;

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

// ---------------------------------------------------------------------------
//  Note « la plus précise disponible » d'une œuvre (V2)
// ---------------------------------------------------------------------------
/**
 * À partir des lignes de notes d'une œuvre : la note de l'œuvre elle-même,
 * sinon la moyenne de ses saisons notées, sinon la moyenne de ses épisodes notés.
 */
export function summarizeRatings(rows) {
  const main = rows.find((row) => row.season == null && row.episode == null) || null;
  const seasons = rows.filter((row) => row.season != null && row.episode == null && row.rating != null).map((row) => row.rating);
  const episodes = rows.filter((row) => row.episode != null && row.rating != null).map((row) => row.rating);
  let value = null;
  let basis = null;
  let count = 0;
  if (main?.rating != null) { value = main.rating; basis = 'direct'; count = 1; } else if (seasons.length) { value = mean(seasons); basis = 'saisons'; count = seasons.length; } else if (episodes.length) { value = mean(episodes); basis = 'épisodes'; count = episodes.length; }
  return { main, direct: main?.rating ?? null, value, basis, count };
}

// ---------------------------------------------------------------------------
//  Périodes
// ---------------------------------------------------------------------------
/**
 * Une période : { kind: 'day' | 'month' | 'year' | 'all', key }
 *   day → '2026-10-14'   month → '2026-10'   year → '2026'   all → ''
 */
export function inPeriod(date, period) {
  if (period.kind === 'all') return true;
  return !!date && date.startsWith(period.key);
}

/** Période précédente (ou suivante avec step = +1). */
export function shiftPeriod(period, step) {
  if (period.kind === 'all') return period;
  if (period.kind === 'year') return { kind: 'year', key: String(Number(period.key) + step) };
  if (period.kind === 'month') {
    const [y, m] = period.key.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + step, 1));
    return { kind: 'month', key: d.toISOString().slice(0, 7) };
  }
  const [y, m, d] = period.key.split('-').map(Number);
  return { kind: 'day', key: new Date(Date.UTC(y, m - 1, d + step)).toISOString().slice(0, 10) };
}

export function daysInMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------
//  Visionnages : chaque film ou épisode vu, avec sa date et sa durée
// ---------------------------------------------------------------------------
/** Liste [[épisode, durée], …] d'une saison, d'après items.seasons_meta. */
function seasonEpisodes(item, season) {
  const meta = item.seasons_meta;
  if (!meta || typeof meta !== 'object') return null;
  const list = meta[String(season)];
  return Array.isArray(list) ? list : null;
}

/** Durée connue d'un épisode dans seasons_meta (ou null). */
function metaRuntime(item, season, episode) {
  const found = (seasonEpisodes(item, season) || []).find(([number]) => number === episode);
  return found?.[1] ?? null;
}

/** Durée moyenne des épisodes connus d'une série (ou null). */
function averageEpisode(item) {
  if (item.runtime) return item.runtime;
  const all = Object.values(item.seasons_meta || {}).flat().map(([, minutes]) => minutes).filter((x) => x > 0);
  return all.length ? Math.round(mean(all)) : null;
}

/**
 * Transforme les notes en « visionnages ».
 *   items   : Map(id → œuvre)    ratings : lignes de la table ratings
 * Renvoie { viewings, seasons, incomplete }
 *   viewings   : [{ itemId, item, kind: 'film' | 'episode', date, minutes,
 *                   estimated, season, episode, rating, viaSeason }]
 *   seasons    : [{ itemId, item, season, total, date, complete }] saisons
 *                entièrement vues (date = jour où la dernière a été vue)
 *   incomplete : saisons marquées vues dont on ne connaît pas encore les épisodes
 */
export function buildViewings(items, ratings) {
  const viewings = [];
  const byItem = new Map();
  for (const row of ratings) {
    if (!byItem.has(row.item_id)) byItem.set(row.item_id, []);
    byItem.get(row.item_id).push(row);
  }
  const finished = [];
  const incomplete = [];

  for (const [itemId, rows] of byItem) {
    const item = items.get(itemId);
    if (!item) continue;

    if (item.type === 'film') {
      const row = rows.find((r) => r.season == null && r.episode == null);
      if (!row) continue;
      viewings.push({
        itemId, item, kind: 'film', date: row.watched_on || null,
        minutes: item.runtime || DEFAULT_FILM_MINUTES, estimated: !item.runtime,
        season: null, episode: null, rating: row.rating ?? null, viaSeason: false,
      });
      continue;
    }

    // ---- série : épisodes vus un par un
    const episodeRows = new Map(); // « saison:épisode » → ligne
    for (const row of rows) {
      if (row.episode == null || row.season == null) continue;
      episodeRows.set(`${row.season}:${row.episode}`, row);
      const minutes = row.runtime || metaRuntime(item, row.season, row.episode) || averageEpisode(item);
      viewings.push({
        itemId, item, kind: 'episode', date: row.watched_on || null,
        minutes: minutes || DEFAULT_EPISODE_MINUTES, estimated: !minutes,
        season: row.season, episode: row.episode, rating: row.rating ?? null, viaSeason: false,
      });
    }

    // ---- saisons notées / marquées vues sans leurs épisodes
    const seasonRows = new Map(rows.filter((r) => r.season != null && r.episode == null).map((r) => [r.season, r]));
    for (const [season, row] of seasonRows) {
      const episodes = seasonEpisodes(item, season);
      if (!episodes) { incomplete.push({ itemId, item, season }); continue; }
      for (const [number, runtime] of episodes) {
        if (episodeRows.has(`${season}:${number}`)) continue; // déjà compté avec sa propre date
        const minutes = runtime || averageEpisode(item);
        viewings.push({
          itemId, item, kind: 'episode', date: row.watched_on || null,
          minutes: minutes || DEFAULT_EPISODE_MINUTES, estimated: !minutes,
          season, episode: number, rating: null, viaSeason: true,
        });
      }
    }

    // ---- saisons terminées : chaque épisode de la saison est vu
    const seasonsKnown = new Set([...Object.keys(item.seasons_meta || {}).map(Number), ...seasonRows.keys()]);
    for (const season of seasonsKnown) {
      const episodes = seasonEpisodes(item, season);
      const seasonRow = seasonRows.get(season);
      if (!episodes || !episodes.length) {
        // épisodes inconnus : une saison marquée vue compte quand même comme terminée
        if (seasonRow) finished.push({ itemId, item, season, total: null, date: seasonRow.watched_on || null });
        continue;
      }
      const dates = [];
      let complete = true;
      for (const [number] of episodes) {
        const own = episodeRows.get(`${season}:${number}`);
        if (own) dates.push(own.watched_on || null);
        else if (seasonRow) dates.push(seasonRow.watched_on || null);
        else { complete = false; break; }
      }
      if (!complete) continue;
      // terminée le jour où le dernier épisode a été vu ; une date inconnue → « depuis toujours » seulement
      const date = dates.includes(null) ? null : dates.sort().at(-1);
      finished.push({ itemId, item, season, total: episodes.length, date });
    }
  }
  return { viewings, seasons: finished, incomplete };
}

// ---------------------------------------------------------------------------
//  Statistiques d'une période
// ---------------------------------------------------------------------------
const MONTH_KEYS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

/**
 * Tout ce qu'affiche la page Statistiques pour une période.
 *   data   : résultat de buildViewings
 *   ratings: toutes les lignes de notes (pour la note moyenne et la répartition)
 *   period : { kind, key }
 *   today  : 'AAAA-MM-JJ' (pour les moyennes d'une période en cours)
 */
export function periodStats(data, ratings, items, period, today) {
  const views = data.viewings.filter((v) => inPeriod(v.date, period));
  const sum = (list) => list.reduce((total, v) => total + v.minutes, 0);
  const films = views.filter((v) => v.kind === 'film');
  const episodes = views.filter((v) => v.kind === 'episode');
  const seriesIds = new Set(episodes.map((v) => v.itemId));
  const seasons = data.seasons.filter((s) => inPeriod(s.date, period));

  // notes données pendant la période (tous niveaux : films, séries, saisons, épisodes)
  const rated = ratings.filter((row) => row.rating != null && inPeriod(row.watched_on, period) && items.has(row.item_id));
  const workRows = rated.filter((row) => row.episode == null);
  const episodeNotes = rated.filter((row) => row.episode != null).map((row) => row.rating);
  const distribution = (list) => [1, 2, 3, 4, 5].map((n) => list.filter((value) => value === n).length);

  // ---- graphique : une barre par jour (mois), par mois (année), par année (depuis toujours)
  let buckets = [];
  if (period.kind === 'month') {
    buckets = Array.from({ length: daysInMonth(period.key) }, (_, i) => ({ key: `${period.key}-${String(i + 1).padStart(2, '0')}`, minutes: 0 }));
  } else if (period.kind === 'year') {
    buckets = MONTH_KEYS.map((m) => ({ key: `${period.key}-${m}`, minutes: 0 }));
  } else if (period.kind === 'all') {
    const years = data.viewings.map((v) => v.date?.slice(0, 4)).filter(Boolean).sort();
    if (years.length) for (let y = Number(years[0]); y <= Number(years.at(-1)); y += 1) buckets.push({ key: String(y), minutes: 0 });
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  const bucketOf = (date) => (period.kind === 'month' ? date : period.kind === 'year' ? date.slice(0, 7) : date.slice(0, 4));
  for (const v of views) if (v.date && period.kind !== 'day') { const b = byKey.get(bucketOf(v.date)); if (b) b.minutes += v.minutes; }

  // ---- moyennes : par jour sur le mois, par mois sur l'année (jusqu'à aujourd'hui pour la période en cours)
  const total = sum(views);
  let perDay = null;
  let perMonth = null;
  if (period.kind === 'month') {
    const days = period.key === today.slice(0, 7) ? Number(today.slice(8, 10)) : period.key > today.slice(0, 7) ? 0 : daysInMonth(period.key);
    perDay = days ? total / days : null;
  } else if (period.kind === 'year') {
    const months = period.key === today.slice(0, 4) ? Number(today.slice(5, 7)) : period.key > today.slice(0, 4) ? 0 : 12;
    perMonth = months ? total / months : null;
  }

  // ---- genres et pays des œuvres vues pendant la période
  const workIds = new Set(views.map((v) => v.itemId));
  const rowsByItem = new Map();
  for (const row of ratings) { if (!rowsByItem.has(row.item_id)) rowsByItem.set(row.item_id, []); rowsByItem.get(row.item_id).push(row); }
  const tally = (field) => {
    const map = new Map();
    for (const id of workIds) {
      const item = items.get(id);
      const note = summarizeRatings(rowsByItem.get(id) || []).value;
      for (const name of item?.[field] || []) {
        if (!map.has(name)) map.set(name, { label: name, value: 0, notes: [] });
        map.get(name).value += 1;
        if (note != null) map.get(name).notes.push(note);
      }
    }
    return [...map.values()]
      .map((b) => ({ label: b.label, value: b.value, average: mean(b.notes) }))
      .sort((a, b) => b.value - a.value || (b.average || 0) - (a.average || 0) || a.label.localeCompare(b.label, 'fr'));
  };

  return {
    period,
    minutes: total,
    filmMinutes: sum(films),
    seriesMinutes: sum(episodes),
    estimatedMinutes: sum(views.filter((v) => v.estimated)),
    films: films.length,
    series: seriesIds.size,
    seasons: seasons.length,
    episodes: episodes.length,
    average: mean(rated.map((row) => row.rating)),
    rated: rated.length,
    distributionWorks: distribution(workRows.map((row) => row.rating)),
    distributionEpisodes: distribution(episodeNotes),
    buckets,
    perDay,
    perMonth,
    viewings: views,
    genres: tally('genres'),
    countries: tally('countries'),
  };
}

// ---------------------------------------------------------------------------
//  Acteurs
// ---------------------------------------------------------------------------
/** Clé d'une œuvre dans item_cast : « wd:Q25188 » (film) ou « tm:169 » (série). */
export function workKey(item) {
  if (item.type === 'serie') return item.source === 'tvmaze' ? `tm:${item.source_id}` : null;
  const qid = item.wikidata_id || (item.source === 'wikidata' ? item.source_id : null);
  return qid ? `wd:${qid}` : null;
}

/**
 * Classements des acteurs pour une période et un filtre.
 *   cast   : Map(clé d'œuvre → [{ id, name, photo }])
 *   filter : 'film' | 'serie' | 'all'
 *   minWorks : nombre minimal d'œuvres NOTÉES pour l'« acteur préféré »
 * Renvoie { mostWatched: [...], favorite: [...] }, chaque acteur :
 *   { id, name, photo, minutes, works, rated, average, items: [ids] }
 */
export function actorStats(data, ratings, items, cast, period, filter = 'all', { minWorks = 2 } = {}) {
  const people = new Map();
  const get = (person) => {
    if (!people.has(person.id)) people.set(person.id, { ...person, minutes: 0, workIds: new Set(), notes: new Map() });
    return people.get(person.id);
  };
  const views = data.viewings.filter((v) => inPeriod(v.date, period) && (filter === 'all' || v.item.type === filter));
  for (const v of views) {
    for (const person of cast.get(workKey(v.item)) || []) {
      const p = get(person);
      p.minutes += v.minutes;
      p.workIds.add(v.itemId);
    }
  }
  // note de chaque œuvre vue dans la période (la plus précise disponible)
  const rowsByItem = new Map();
  for (const row of ratings) { if (!rowsByItem.has(row.item_id)) rowsByItem.set(row.item_id, []); rowsByItem.get(row.item_id).push(row); }
  for (const p of people.values()) {
    for (const id of p.workIds) {
      const note = summarizeRatings(rowsByItem.get(id) || []).value;
      if (note != null) p.notes.set(id, note);
    }
  }
  const list = [...people.values()].map((p) => ({
    id: p.id, name: p.name, photo: p.photo || null,
    minutes: p.minutes, works: p.workIds.size, items: [...p.workIds],
    rated: p.notes.size, average: mean([...p.notes.values()]),
  }));
  const byName = (a, b) => a.name.localeCompare(b.name, 'fr');
  return {
    mostWatched: list.filter((p) => p.minutes > 0).sort((a, b) => b.minutes - a.minutes || b.works - a.works || byName(a, b)),
    favorite: list.filter((p) => p.rated >= minWorks).sort((a, b) => b.average - a.average || b.rated - a.rated || b.minutes - a.minutes || byName(a, b)),
  };
}

// ---------------------------------------------------------------------------
//  Récaps
// ---------------------------------------------------------------------------
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export function periodLabel(period) {
  if (period.kind === 'year') return period.key;
  if (period.kind === 'month') return `${MONTHS_FR[Number(period.key.slice(5, 7)) - 1]} ${period.key.slice(0, 4)}`;
  if (period.kind === 'day') {
    const [y, m, d] = period.key.split('-').map(Number);
    return `${d === 1 ? '1er' : d} ${MONTHS_FR[m - 1]} ${y}`;
  }
  return 'depuis toujours';
}
export const monthName = (monthKey) => MONTHS_FR[Number(monthKey.slice(5, 7)) - 1];

/**
 * Récaps disponibles à la date `today` :
 *   - le récap d'un mois à partir du 1er du mois suivant ;
 *   - le récap de l'année à partir du 1er décembre (« en cours »), définitif le 1er janvier ;
 *   - aucun récap pour une période sans rien de vu.
 * Du plus récent au plus ancien.
 */
export function availableRecaps(data, today) {
  const months = new Set();
  const years = new Set();
  for (const v of data.viewings) {
    if (!v.date) continue;
    months.add(v.date.slice(0, 7));
    years.add(v.date.slice(0, 4));
  }
  const currentMonth = today.slice(0, 7);
  const currentYear = today.slice(0, 4);
  const list = [];
  for (const y of years) {
    if (y < currentYear) list.push({ kind: 'year', key: y, provisional: false });
    else if (y === currentYear && today.slice(5, 7) === '12') list.push({ kind: 'year', key: y, provisional: true });
  }
  for (const m of months) if (m < currentMonth) list.push({ kind: 'month', key: m, provisional: false });
  // l'année juste après son dernier mois : 2026 vient avant décembre 2026
  const end = (r) => (r.kind === 'year' ? `${r.key}-12-99` : `${r.key}-99`);
  return list.sort((a, b) => end(b).localeCompare(end(a)) || (a.kind === 'year' ? -1 : 1));
}

/** Empreinte des notes d'une période : si elle change, le récap est recalculé. */
export function recapSignature(ratings, items, period) {
  const rows = ratings
    .filter((row) => items.has(row.item_id))
    .filter((row) => inPeriod(row.watched_on, period) || (row.season != null && row.episode == null))
    .map((row) => `${row.id}:${row.updated_at || ''}:${row.rating ?? ''}:${row.watched_on || ''}`)
    .sort()
    .join('|');
  let hash = 5381;
  for (let i = 0; i < rows.length; i += 1) hash = ((hash * 33) ^ rows.charCodeAt(i)) >>> 0; // empreinte « djb2 »
  return `${rows.length}-${hash.toString(36)}`;
}

/** Résumé d'une œuvre pour un récap (ce qui sera affiché et mis en cache). */
const brief = (item) => ({ id: item.id, title: item.title, year: item.year || null, type: item.type, poster: item.poster_url || null, source: item.source, source_id: item.source_id });

/**
 * Calcule toutes les données d'un récap (mois ou année).
 * Chaque écran sans données vaut null : il sera sauté.
 */
export function computeRecap(data, ratings, items, cast, period, today) {
  const stats = periodStats(data, ratings, items, period, today);
  if (!stats.viewings.length) return null;
  const previous = periodStats(data, ratings, items, shiftPeriod(period, -1), today);
  const rowsByItem = new Map();
  for (const row of ratings) { if (!rowsByItem.has(row.item_id)) rowsByItem.set(row.item_id, []); rowsByItem.get(row.item_id).push(row); }
  const views = stats.viewings;

  // ---- film préféré : meilleure note, puis le plus récent
  const filmViews = views.filter((v) => v.kind === 'film');
  const ratedFilms = filmViews.filter((v) => v.rating != null)
    .sort((a, b) => b.rating - a.rating || String(b.date).localeCompare(String(a.date)));
  const favoriteFilm = ratedFilms[0]
    ? { ...brief(ratedFilms[0].item), rating: ratedFilms[0].rating, date: ratedFilms[0].date, comment: (rowsByItem.get(ratedFilms[0].itemId) || []).find((r) => r.season == null)?.comment || null }
    : null;

  // ---- séries : temps passé, note la plus précise
  const series = new Map();
  for (const v of views.filter((x) => x.kind === 'episode')) {
    if (!series.has(v.itemId)) series.set(v.itemId, { item: v.item, minutes: 0, episodes: 0, last: '' });
    const s = series.get(v.itemId);
    s.minutes += v.minutes;
    s.episodes += 1;
    if ((v.date || '') > s.last) s.last = v.date || '';
  }
  const seriesList = [...series.values()].map((s) => ({ ...s, rating: summarizeRatings(rowsByItem.get(s.item.id) || []).value }));
  const favoriteSeries = seriesList.filter((s) => s.rating != null)
    .sort((a, b) => b.rating - a.rating || b.minutes - a.minutes || b.last.localeCompare(a.last))[0] || null;
  const mostTimeSeries = [...seriesList].sort((a, b) => b.minutes - a.minutes || b.episodes - a.episodes)[0] || null;

  // ---- épisode le mieux noté
  const bestEpisode = views.filter((v) => v.kind === 'episode' && v.rating != null)
    .sort((a, b) => b.rating - a.rating || String(b.date).localeCompare(String(a.date)))[0] || null;

  // ---- jour et mois record
  const byDay = new Map();
  for (const v of views) byDay.set(v.date, (byDay.get(v.date) || 0) + v.minutes);
  const [recordDay, recordDayMinutes] = [...byDay.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const recordMonth = period.kind === 'year'
    ? [...stats.buckets].sort((a, b) => b.minutes - a.minutes || a.key.localeCompare(b.key))[0]
    : null;

  // ---- tops de l'année
  const top5Films = period.kind === 'year'
    ? ratedFilms.slice(0, 5).map((v) => ({ ...brief(v.item), rating: v.rating })) : [];
  const top5Series = period.kind === 'year'
    ? seriesList.filter((s) => s.rating != null).sort((a, b) => b.rating - a.rating || b.minutes - a.minutes).slice(0, 5).map((s) => ({ ...brief(s.item), rating: s.rating })) : [];

  // ---- acteur de la période (sauté s'il n'y a pas assez de données)
  const actors = actorStats(data, ratings, items, cast, period, 'all');
  const topActor = actors.mostWatched[0];
  const actor = topActor && (topActor.works >= 2 || topActor.minutes >= 180)
    ? { id: topActor.id, name: topActor.name, photo: topActor.photo, minutes: topActor.minutes, works: topActor.works }
    : null;

  const percent = previous.minutes ? Math.round(((stats.minutes - previous.minutes) / previous.minutes) * 100) : null;
  return {
    kind: period.kind,
    key: period.key,
    label: periodLabel(period),
    minutes: stats.minutes,
    filmMinutes: stats.filmMinutes,
    seriesMinutes: stats.seriesMinutes,
    estimated: stats.estimatedMinutes > 0,
    previousMinutes: previous.minutes,
    evolution: percent,
    films: stats.films,
    series: stats.series,
    seasons: stats.seasons,
    episodes: stats.episodes,
    favoriteFilm,
    favoriteSeries: favoriteSeries ? { ...brief(favoriteSeries.item), rating: favoriteSeries.rating, minutes: favoriteSeries.minutes } : null,
    bestEpisode: bestEpisode ? { ...brief(bestEpisode.item), season: bestEpisode.season, episode: bestEpisode.episode, rating: bestEpisode.rating } : null,
    mostTimeSeries: mostTimeSeries ? { ...brief(mostTimeSeries.item), minutes: mostTimeSeries.minutes, episodes: mostTimeSeries.episodes } : null,
    genres: stats.genres.slice(0, 5),
    countries: stats.countries.slice(0, 5),
    average: stats.average,
    distribution: [0, 1, 2, 3, 4].map((i) => stats.distributionWorks[i] + stats.distributionEpisodes[i]),
    recordDay: { date: recordDay, minutes: recordDayMinutes },
    recordMonth: recordMonth && recordMonth.minutes ? { key: recordMonth.key, minutes: recordMonth.minutes } : null,
    top5Films,
    top5Series,
    actor,
  };
}
