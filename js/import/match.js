// ============================================================================
//  Import d'historique — retrouver chaque titre dans le catalogue du site.
//  Séries : TVMaze d'abord (rapide, titres anglais et souvent français),
//  puis Wikidata (titres français, « La casa de papel » → Money Heist).
//  Films : Wikidata (titres français, anglais et originaux).
//  Les réponses sont gardées pendant la visite (relancer un import est rapide).
// ============================================================================
import * as tvmaze from '../api/tvmaze.js';
import * as wikidata from '../api/wikidata.js';
import { remember } from '../catalog.js';
import { isAbort } from '../utils.js';
import { titleKey } from './parse.js';

const cache = new Map();

/** Note de ressemblance entre le titre importé et une œuvre du catalogue. */
function score(candidate, work) {
  const wanted = titleKey(work.title);
  const titles = [candidate.title, ...(candidate.altTitles || [])].map(titleKey);
  let s = 0;
  if (titles.includes(wanted)) s += 100;
  else if (titles.some((t) => t.replace(/^(the|le|la|les|l) /, '') === wanted.replace(/^(the|le|la|les|l) /, ''))) s += 90;
  else if (titles.some((t) => t.startsWith(`${wanted} `) || wanted.startsWith(`${t} `))) s += 35;
  if (candidate.type === work.kind) s += 25;
  s += Math.min(candidate.popularity || 0, 100) * 0.3;
  if (work.first && candidate.year && candidate.year > Number(work.first.slice(0, 4))) s -= 60; // sorti après avoir été vu : impossible
  return s;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function candidatesFor(work, signal) {
  const key = `${work.kind}|${titleKey(work.title)}`;
  if (cache.has(key)) return cache.get(key);
  let failed = false; // une source n'a pas répondu (surcharge…) : on ne retient pas « introuvable »
  const ask = (fn) => fn().catch((error) => { if (isAbort(error)) throw error; failed = true; return []; });
  let list = [];
  if (work.kind === 'serie') {
    list = await ask(() => tvmaze.searchShows(work.title, signal));
    if (!list.some((c) => score(c, work) >= 100)) {
      const more = await ask(() => wikidata.searchTitles(work.title, signal));
      list = list.concat(more.filter((c) => c.type === 'serie'));
    }
  } else {
    list = await ask(() => wikidata.searchTitles(work.title, signal));
  }
  const ranked = list
    .map((c) => ({ item: c, score: score(c, work) }))
    .filter((c) => c.score > 20)
    .sort((a, b) => b.score - a.score)
    // une même série peut arriver par TVMaze et par Wikidata : une seule fois
    .filter((c, i, all) => all.findIndex((o) => o.item.type === c.item.type && titleKey(o.item.title) === titleKey(c.item.title) && o.item.year === c.item.year) === i)
    .slice(0, 5);
  ranked.forEach((c) => remember(c.item));
  if (failed && !ranked.length) { const error = new Error('source indisponible'); error.retry = true; throw error; }
  cache.set(key, ranked);
  return ranked;
}

/**
 * Cherche toutes les œuvres, quelques-unes à la fois.
 *   onProgress(done, total) après chaque œuvre
 * Complète chaque œuvre avec { candidates, match, sure } :
 *   sure = titre identique et bon type (cochée d'office) ; sinon « à vérifier ».
 */
export async function matchAll(works, signal, onProgress = () => {}) {
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < works.length) {
      const work = works[next];
      next += 1;
      work.failed = false;
      try {
        work.candidates = await candidatesFor(work, signal);
      } catch (error) {
        if (isAbort(error)) throw error;
        // source surchargée : un second essai un peu plus tard
        await wait(1500);
        try { work.candidates = await candidatesFor(work, signal); } catch (again) {
          if (isAbort(again)) throw again;
          work.candidates = [];
          work.failed = true;
        }
      }
      const best = work.candidates[0] || null;
      work.match = best?.item || null;
      work.sure = !!best && best.score >= 125;
      done += 1;
      onProgress(done, works.length);
    }
  };
  await Promise.all([worker(), worker()]); // deux à la fois : Wikidata limite les demandes
  return works;
}
