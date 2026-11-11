// ============================================================================
//  Traduction anglais → français avec MyMemory (gratuit, sans clé).
//  Documentation : https://mymemory.translated.net/doc/spec.php
//
//  - MyMemory refuse les textes de plus de 500 caractères : on découpe le
//    résumé en morceaux (par phrases) et on recolle les traductions.
//  - Chaque traduction est mise en cache (mémoire + table Supabase
//    « translations_cache ») : un même résumé n'est jamais traduit deux fois.
// ============================================================================
import { fetchJson, sha256, decodeEntities } from '../utils.js';
import { MYMEMORY_EMAIL } from '../config.js';

const ENDPOINT = 'https://api.mymemory.translated.net/get';
const MAX_CHUNK = 450; // marge de sécurité sous la limite de 500

// Le cache distant est branché par store.js (pour ne pas dépendre de Supabase ici).
let remoteCache = { get: async () => new Map(), set: async () => {} };
export function setRemoteCache(cache) { remoteCache = cache; }

const memory = new Map(); // empreinte → traduction
let quotaReached = false; // quota journalier atteint : on arrête d'insister

export class TranslationError extends Error {
  constructor(message, reason) { super(message); this.name = 'TranslationError'; this.reason = reason; }
}

/** Devine si un texte est en anglais (mots très courants de chaque langue). */
export function looksEnglish(text) {
  const words = ` ${String(text || '').toLowerCase().replace(/[^a-zàâçéèêëîïôûùüÿœ']+/g, ' ')} `;
  const count = (list) => list.reduce((n, w) => n + (words.split(` ${w} `).length - 1), 0);
  const en = count(['the', 'and', 'of', 'to', 'is', 'in', 'his', 'her', 'with', 'for', 'that', 'who', 'as', 'their', 'when', 'from', 'he', 'she', 'they']);
  const fr = count(['le', 'la', 'les', 'des', 'et', 'est', 'un', 'une', 'du', 'dans', 'qui', 'que', 'pour', 'son', 'sa', 'ses', 'avec', 'au', 'sur', 'il', 'elle']);
  return en > fr && en >= 2;
}

/** Découpe un texte en morceaux de moins de `max` caractères, sans couper les phrases si possible. */
export function splitText(text, max = MAX_CHUNK) {
  const chunks = [];
  let current = '';
  const push = () => { if (current.trim()) chunks.push(current.trim()); current = ''; };
  // 1) on coupe par phrases ; 2) une phrase trop longue est coupée par mots
  const sentences = String(text).match(/[^.!?…\n]+[.!?…]*["”’)]*\s*|\n+/g) || [String(text)];
  for (const sentence of sentences) {
    if (sentence.length > max) {
      push();
      for (const word of sentence.split(/(\s+)/)) {
        if ((current + word).length > max) push();
        if (word.length > max) { // « mot » démesuré : on tranche net
          for (let i = 0; i < word.length; i += max) chunks.push(word.slice(i, i + max));
        } else current += word;
      }
      push();
    } else {
      if ((current + sentence).length > max) push();
      current += sentence;
    }
  }
  push();
  return chunks;
}

/** Traduit un seul morceau (< 500 caractères). */
async function translateChunk(chunk, signal) {
  let url = `${ENDPOINT}?q=${encodeURIComponent(chunk)}&langpair=en|fr`;
  if (MYMEMORY_EMAIL) url += `&de=${encodeURIComponent(MYMEMORY_EMAIL)}`;
  let data;
  try {
    data = await fetchJson(url, { signal, timeout: 12000 });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    if (error.status === 429) { quotaReached = true; throw new TranslationError('Quota de traduction atteint', 'quota'); }
    throw new TranslationError('Service de traduction injoignable', 'network');
  }
  const translated = data?.responseData?.translatedText || '';
  const status = Number(data?.responseStatus);
  if (status === 429 || data?.quotaFinished || /MYMEMORY WARNING/i.test(translated)) {
    quotaReached = true;
    throw new TranslationError('Quota de traduction atteint', 'quota');
  }
  if (status !== 200 || !translated || /QUERY LENGTH LIMIT|INVALID/i.test(translated)) {
    throw new TranslationError('Traduction impossible', 'invalid');
  }
  return decodeEntities(translated);
}

/** Lit d'un coup les traductions déjà en cache pour une liste de textes. */
export async function cachedTranslations(texts) {
  const result = new Map(); // texte original → traduction
  const missing = new Map(); // empreinte → texte
  for (const text of new Set(texts.filter(Boolean))) {
    const hash = await sha256(text.trim());
    if (memory.has(hash)) result.set(text, memory.get(hash));
    else missing.set(hash, text);
  }
  if (missing.size) {
    try {
      const found = await remoteCache.get([...missing.keys()]);
      for (const [hash, translated] of found) {
        memory.set(hash, translated);
        result.set(missing.get(hash), translated);
      }
    } catch { /* cache indisponible : on traduira normalement */ }
  }
  return result;
}

/**
 * Traduit un texte anglais en français. Passe par le cache ; lève une
 * TranslationError si le service gratuit est indisponible ou à court de quota.
 */
export async function translateToFrench(text, signal) {
  const original = String(text || '').trim();
  if (!original) return '';
  const cached = await cachedTranslations([original]);
  if (cached.has(original)) return cached.get(original);
  if (quotaReached) throw new TranslationError('Quota de traduction atteint', 'quota');

  const parts = [];
  for (const chunk of splitText(original)) {
    parts.push(await translateChunk(chunk, signal)); // l'un après l'autre, pour ménager le service
  }
  const translated = parts.join(' ').replace(/\s+([.,])/g, '$1').trim();

  const hash = await sha256(original);
  memory.set(hash, translated);
  remoteCache.set(hash, translated).catch(() => {}); // le cache distant est un bonus
  return translated;
}
