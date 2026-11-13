// ============================================================================
//  Récaps mensuels et annuels : quels récaps sont disponibles, leurs données
//  (calculées par js/stats/core.js) et leur cache dans Supabase (table recaps).
// ============================================================================
import { todayISO } from '../utils.js';
import { state, saveRecap, markRecapSeen } from '../store.js';
import { buildViewings, availableRecaps, computeRecap, recapSignature, monthName } from '../stats/core.js';

/** La date du jour (heure de Paris). Les tests peuvent la fixer avec window.__MC_TODAY. */
export function recapToday() {
  return (typeof window !== 'undefined' && window.__MC_TODAY) || todayISO();
}

/** « d’octobre », « de mars » : élision devant une voyelle. */
export function ofMonth(monthKey) {
  const name = monthName(monthKey);
  return /^[aeiouyéèâàô]/i.test(name) ? `d’${name}` : `de ${name}`;
}

/** Titre d'un récap : « Ton mois d’octobre 2026 » / « Ton année 2026 ». */
export function recapTitle(recap) {
  return recap.kind === 'year' ? `Ton année ${recap.key}` : `Ton mois ${ofMonth(recap.key)} ${recap.key.slice(0, 4)}`;
}

/** Nom court : « Octobre 2026 » / « 2026 ». */
export function recapName(recap) {
  if (recap.kind === 'year') return recap.key;
  const name = monthName(recap.key);
  return `${name[0].toUpperCase()}${name.slice(1)} ${recap.key.slice(0, 4)}`;
}

/**
 * Un récap est « déjà vu » s'il a été ouvert. Exception : le récap d'une année
 * ouvert en décembre (version « en cours ») redevient nouveau le 1er janvier,
 * quand sa version définitive arrive.
 */
function isSeen(recap, row) {
  if (!row?.seen_at) return false;
  if (recap.kind !== 'year' || recap.provisional) return true;
  return new Date(row.seen_at) >= new Date(`${Number(recap.key) + 1}-01-01T00:00:00+01:00`);
}

/** Récaps disponibles aujourd'hui, du plus récent au plus ancien, avec leur état « déjà vu ». */
export function listRecaps() {
  const data = buildViewings(state.items, state.ratings);
  return availableRecaps(data, recapToday()).map((recap) => ({ ...recap, seen: isSeen(recap, state.recaps.get(`${recap.kind}:${recap.key}`)) }));
}

/**
 * Le récap à annoncer sur l'accueil, ou null : seulement les récaps qui
 * viennent de sortir (le mois dernier, l'année en cours en décembre, l'année
 * passée en janvier) et pas encore ouverts. Priorité : l'année terminée, puis
 * le mois, puis l'année « en cours ».
 */
export function pendingRecap() {
  if (!state.v3) return null;
  const today = recapToday();
  const [y, m] = today.split('-').map(Number);
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const fresh = listRecaps().filter((r) => !r.seen && (
    (r.kind === 'month' && r.key === lastMonth)
    || (r.kind === 'year' && r.provisional)
    || (r.kind === 'year' && m === 1 && r.key === String(y - 1))));
  const rank = (r) => (r.kind === 'year' && !r.provisional ? 0 : r.kind === 'month' ? 1 : 2);
  return fresh.sort((a, b) => rank(a) - rank(b))[0] || null;
}

/** Texte de la bannière : « Ton récap d’octobre est prêt ». */
export function bannerText(recap) {
  if (recap.kind === 'year') return recap.provisional ? `Ton récap ${recap.key} (en cours) est prêt` : `Ton récap de l’année ${recap.key} est prêt`;
  return `Ton récap ${ofMonth(recap.key)} est prêt`;
}

/**
 * Données d'un récap : relues du cache si les notes de la période n'ont pas
 * changé depuis le dernier calcul, sinon recalculées puis enregistrées.
 *   cast : distribution des œuvres (pour l'écran « acteur du mois »)
 */
export async function getRecap(recap, cast, { fetchCached }) {
  const period = { kind: recap.kind, key: recap.key };
  const signature = `${recapSignature(state.ratings, state.items, period)}:${cast.size}`;
  const row = state.recaps.get(`${recap.kind}:${recap.key}`);
  if (row && row.signature === signature) {
    const cached = await fetchCached(recap.kind, recap.key).catch(() => null);
    if (cached?.data?.minutes != null) return { ...cached.data, provisional: recap.provisional, fromCache: true };
  }
  const data = buildViewings(state.items, state.ratings);
  const result = computeRecap(data, state.ratings, state.items, cast, period, recapToday());
  if (result) await saveRecap(recap.kind, recap.key, signature, result).catch((error) => console.warn('[Récaps] cache non enregistré :', error.message));
  return result ? { ...result, provisional: recap.provisional, fromCache: false } : null;
}

export { markRecapSeen };
