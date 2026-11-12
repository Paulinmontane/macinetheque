// ============================================================================
//  Sélecteur de date de visionnage (aucune date à taper à la main).
//
//   - pré-rempli avec la date du jour (heure de Paris) ;
//   - raccourcis en un clic : « Aujourd'hui », « Hier », « Choisir une date… »
//     (ouvre le calendrier du téléphone ou de l'ordinateur), « Date inconnue » ;
//   - les dates futures sont refusées.
//
//  Valeur : une date 'AAAA-MM-JJ', ou null pour « date inconnue ».
// ============================================================================
import { h, icon, toast, todayISO, yesterdayISO, formatDate } from '../utils.js';

let counter = 0;

/**
 *   value    : date de départ ; `undefined` = aujourd'hui, `null` = inconnue
 *   onChange : appelée avec la nouvelle valeur quand l'utilisateur en change
 *   label    : texte lu par les lecteurs d'écran
 * L'élément renvoyé possède getValue() et setValue(valeur).
 */
export function datePicker({ value, onChange, label = 'Date de visionnage' } = {}) {
  let current = value === undefined ? todayISO() : value;
  const id = `date-${++counter}`;

  const chip = (text, onClick) => h('button', { class: 'chipbtn', type: 'button', 'aria-pressed': 'false', onClick }, text);
  const today = chip('Aujourd’hui', () => choose(todayISO()));
  const yesterday = chip('Hier', () => choose(yesterdayISO()));
  const unknown = chip('Date inconnue', () => choose(null));

  // « Choisir une date… » : le vrai champ date du navigateur est posé, invisible,
  // par-dessus le bouton. Un appui ouvre donc directement le calendrier natif
  // (roue ou calendrier sur iPhone), sans rien taper.
  const native = h('input', { class: 'chipbtn__native', type: 'date', id, max: todayISO(), 'aria-label': `${label} : choisir une date`, tabindex: '-1' });
  const customText = h('span', {}, 'Choisir une date…');
  const custom = h('button', { class: 'chipbtn chipbtn--date', type: 'button', 'aria-pressed': 'false', 'aria-haspopup': 'dialog' }, icon('calendar', 15), customText);
  const customWrap = h('span', { class: 'chipbtn__wrap' }, custom, native);

  const openNative = () => {
    native.max = todayISO();
    try { native.showPicker(); } catch { native.focus(); native.click(); }
  };
  custom.addEventListener('click', openNative);
  native.addEventListener('click', () => { try { native.showPicker(); } catch { /* le navigateur ouvre déjà son calendrier */ } });
  native.addEventListener('change', () => {
    const picked = native.value;
    if (!picked) { native.value = current || ''; return; } // champ vidé : on ne change rien
    if (picked > todayISO()) { // sécurité : certains navigateurs ignorent « max »
      toast('Une date future n’est pas possible.', 'error');
      native.value = current || '';
      return;
    }
    choose(picked);
  });

  function paint() {
    const isToday = current === todayISO();
    const isYesterday = current === yesterdayISO();
    const isCustom = current !== null && !isToday && !isYesterday;
    today.setAttribute('aria-pressed', String(isToday));
    yesterday.setAttribute('aria-pressed', String(isYesterday));
    unknown.setAttribute('aria-pressed', String(current === null));
    custom.setAttribute('aria-pressed', String(isCustom));
    customText.textContent = isCustom ? formatDate(current, { short: true }) : 'Choisir une date…';
    native.value = current || '';
    root.dataset.value = current === null ? '' : current;
  }

  function choose(next) {
    if (next === current) { paint(); return; }
    current = next;
    paint();
    onChange?.(current);
  }

  const root = h('div', { class: 'datepick', role: 'group', 'aria-label': label }, today, yesterday, customWrap, unknown);
  root.getValue = () => current;
  root.setValue = (next) => { current = next === undefined ? todayISO() : next; paint(); };
  paint();
  return root;
}
