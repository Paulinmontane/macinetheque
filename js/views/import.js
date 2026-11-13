// ============================================================================
//  Page « Importer mon historique » : Netflix et Prime Video.
//
//  Netflix et Amazon n'offrent aucun moyen officiel de relier un autre site à
//  ton compte (et il ne faut jamais donner ton mot de passe à un autre site).
//  On part donc de ce qu'ils permettent de récupérer :
//   - Netflix : le fichier de ton activité (« Télécharger tout ») ;
//   - Prime Video : le texte de la page « Historique de visionnage », copié par
//     un bouton-favori (ordinateur) ou sélectionné et collé à la main.
//  Tout est lu dans ton navigateur ; seules les œuvres que tu valides sont
//  enregistrées, comme « vues » (sans note), à leur date de visionnage.
// ============================================================================
import { h, icon, toast, formatDate, formatNumber, isAbort, todayISO } from '../utils.js';
import { state, findItem, ratingsOf, importViewings } from '../store.js';
import { pageHeader, poster } from '../ui/cards.js';
import { loadItem, thumbnail } from '../catalog.js';
import { readHistory, groupViewings, assignEpisodes } from '../import/parse.js';
import { matchAll } from '../import/match.js';

const NETFLIX_URL = 'https://www.netflix.com/viewingactivity';
const PRIME_URLS = [['primevideo.com', 'https://www.primevideo.com/settings/watch-history'], ['amazon.fr', 'https://www.amazon.fr/gp/video/settings/watch-history']];

/**
 * Bouton-favori pour Prime Video (à glisser dans la barre de favoris).
 * Sur la page « Historique de visionnage » : il fait défiler la page jusqu'en
 * bas (pour tout charger), ouvre les listes d'épisodes, puis copie le texte de
 * la page. Il ne clique JAMAIS sur un bouton « Supprimer ».
 */
const BOOKMARKLET = `(async()=>{const w=t=>new Promise(r=>setTimeout(r,t));if(!/primevideo|amazon\\./.test(location.hostname)){alert("Ouvre d'abord la page Historique de visionnage de Prime Video, puis reclique sur ce favori.");return}
let last=0;for(let i=0;i<80;i++){window.scrollTo(0,document.body.scrollHeight);await w(800);const hh=document.body.scrollHeight;if(hh===last)break;last=hh}
for(const b of document.querySelectorAll('button,[role=button],a,summary')){const t=(b.textContent||'').trim();if(t.length<60&&/(épisode|episode)/i.test(t)&&/(voir|afficher|show|view|see)/i.test(t)&&!/(supprim|remov|delet|effac|retir)/i.test(t)&&b.getAttribute('aria-expanded')!=='true'){try{b.click()}catch(e){}await w(80)}}
await w(1200);const text='MACINETHEQUE-PRIME\\n'+location.hostname+'\\n'+document.body.innerText;
try{await navigator.clipboard.writeText(text);alert('Historique copié ✔ Retourne sur MaCinéthèque et colle-le dans la zone prévue.')}catch(e){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/plain'}));a.download='historique-prime-video.txt';document.body.append(a);a.click();alert('Historique enregistré dans le fichier historique-prime-video.txt : choisis-le sur MaCinéthèque.')}})()`;

const plural = (n, one, many = `${one}s`) => `${formatNumber(n)} ${n > 1 ? many : one}`;

export function renderImport(root) {
  const controller = new AbortController();
  let works = [];
  let platform = '';

  // ------------------------------------------------------------------ étape 1 : choisir la source
  function chooseStep(error = null) {
    const fileInput = (label) => {
      const input = h('input', { type: 'file', accept: '.csv,.txt,text/csv,text/plain', class: 'import__file' });
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (file) readText(await file.text(), file.name);
      });
      return h('label', { class: 'btn btn--primary import__pick' }, icon('download', 18), label, input);
    };
    const paste = h('textarea', { class: 'input import__paste', rows: 4, placeholder: 'Colle ici le texte copié depuis Prime Video', 'aria-label': 'Texte copié depuis Prime Video' });
    const bookmarklet = h('a', { class: 'btn import__bookmarklet', href: `javascript:${encodeURIComponent(BOOKMARKLET)}`, onClick: (event) => { event.preventDefault(); toast('Ne clique pas ici : fais glisser ce bouton dans ta barre de favoris.'); } }, '📥 Copier mon historique Prime');

    root.replaceChildren(
      pageHeader('Importer mon historique', 'Ajoute d’un coup tout ce que tu as regardé sur Netflix et Prime Video.'),
      ...(error ? [h('p', { class: 'form__error import__error', role: 'alert' }, error)] : []),
      h('section', { class: 'panel import__source' },
        h('h2', { class: 'panel__title' }, h('span', { class: 'import__logo import__logo--netflix', 'aria-hidden': 'true' }, 'N'), 'Netflix'),
        h('ol', { class: 'import__steps' },
          h('li', {}, 'Ouvre ', h('a', { href: NETFLIX_URL, target: '_blank', rel: 'noopener' }, 'ton activité Netflix'), ' dans le navigateur (pas l’application), sur ordinateur ou sur iPhone, et choisis ton profil.'),
          h('li', {}, 'Tout en bas de la liste : ', h('strong', {}, 'Télécharger tout'), '. Le fichier ', h('code', {}, 'NetflixViewingHistory.csv'), ' arrive dans tes téléchargements.'),
          h('li', {}, 'Choisis ce fichier ici :')),
        fileInput('Choisir le fichier Netflix')),
      h('section', { class: 'panel import__source' },
        h('h2', { class: 'panel__title' }, h('span', { class: 'import__logo import__logo--prime', 'aria-hidden': 'true' }, 'P'), 'Prime Video'),
        h('h3', { class: 'import__subtitle' }, 'Sur ordinateur (le plus simple)'),
        h('ol', { class: 'import__steps' },
          h('li', {}, 'Fais glisser ce bouton dans ta barre de favoris (une seule fois) : ', bookmarklet),
          h('li', {}, 'Ouvre ton historique Prime Video : ', PRIME_URLS.map(([name, url], i) => [i ? ' ou ' : '', h('a', { href: url, target: '_blank', rel: 'noopener' }, name)]), '.'),
          h('li', {}, 'Clique sur le favori : la page défile toute seule, puis l’historique est copié.'),
          h('li', {}, 'Reviens ici et colle-le (Ctrl+V) dans la zone ci-dessous.')),
        h('h3', { class: 'import__subtitle' }, 'Sur iPhone ou sans favori'),
        h('p', { class: 'muted' }, 'Ouvre l’historique, fais défiler jusqu’en bas, sélectionne tout le texte de la page (Ctrl+A ou appui long → Tout sélectionner), copie, puis colle-le ici.'),
        paste,
        h('div', { class: 'import__actions' },
          h('button', { class: 'btn btn--primary', type: 'button', onClick: () => readText(paste.value, 'prime.txt') }, 'Lire le texte collé'),
          fileInput('Choisir un fichier'))),
      h('p', { class: 'muted import__privacy' }, icon('eye', 16),
        'Le site ne se connecte jamais à ton compte Netflix ou Amazon et ne te demande aucun mot de passe. Le fichier est lu sur ton appareil : seules les œuvres que tu valides sont ajoutées à ta collection, comme « vues » (sans note), à leur date.'),
      h('p', { class: 'muted' }, 'Tu as demandé tes données à Amazon (fichier ', h('code', {}, 'Digital.PrimeVideo.Viewinghistory.csv'), ') ou tu as un autre fichier avec des titres et des dates ? Il marche aussi : choisis-le avec un des boutons.'));
  }

  function readText(text, fileName) {
    let parsed;
    try { parsed = readHistory(text, { fileName }); } catch (error) { chooseStep(error.message); return; }
    platform = parsed.platform;
    works = groupViewings(parsed.viewings, platform, todayISO()).filter((w) => w.title && w.title.length > 1);
    if (!works.length) { chooseStep('Aucune œuvre trouvée dans ce fichier.'); return; }
    reviewStep(parsed);
  }

  // ------------------------------------------------------------------ étape 2 : vérifier
  function reviewStep(parsed) {
    const films = works.filter((w) => w.kind === 'film').length;
    const series = works.length - films;
    const dates = works.flatMap((w) => [w.first, w.last]).filter(Boolean).sort();
    const progress = h('p', { class: 'reco-note', 'aria-live': 'polite' }, h('span', { class: 'spinner' }), `Recherche des œuvres… 0 / ${works.length}`);
    const list = h('div', { class: 'import__list' });
    const go = h('button', { class: 'btn btn--primary', type: 'button', disabled: true }, 'Importer');
    const bar = h('div', { class: 'import__bar' }, h('span', { class: 'import__count' }), go);
    root.replaceChildren(
      pageHeader(`Import ${platform}`, `${plural(parsed.viewings.length, 'ligne lue', 'lignes lues')} · ${plural(films, 'film')} · ${plural(series, 'série')}${dates.length ? ` · du ${formatDate(dates[0])} au ${formatDate(dates.at(-1))}` : ''}`),
      h('p', { class: 'muted' }, platform === 'Netflix' ? 'Netflix note aussi ce qui a seulement été commencé : décoche ce que tu n’as pas vraiment regardé.' : 'Décoche ce que tu ne veux pas ajouter.'),
      progress, list, bar);

    const updateBar = () => {
      const chosen = works.filter((w) => w.checked && w.match);
      const eps = chosen.reduce((t, w) => t + (w.kind === 'serie' ? w.count : 0), 0);
      bar.querySelector('.import__count').textContent = chosen.length
        ? `${plural(chosen.length, 'œuvre')}${eps ? ` · ${plural(eps, 'épisode')}` : ''}`
        : 'Rien de coché';
      go.disabled = !chosen.length;
      go.textContent = chosen.length ? `Importer ${plural(chosen.length, 'œuvre')}` : 'Importer';
    };

    const row = (work) => {
      const m = work.match;
      const owned = m && findItem(m.source, m.source_id);
      const seen = owned && ratingsOf(owned.id).length > 0;
      const status = !m ? (work.failed ? ['Recherche impossible pour le moment', 'missing'] : ['Introuvable', 'missing'])
        : seen ? ['Déjà dans ta collection', 'owned'] : owned ? ['Dans ta liste à voir', 'owned'] : !work.sure ? ['À vérifier', 'check'] : null;
      const box = h('input', { type: 'checkbox', class: 'import__check', checked: !!work.checked, disabled: !m, 'aria-label': `Importer ${work.title}` });
      box.addEventListener('change', () => { work.checked = box.checked; updateBar(); });
      const thumb = h('span', { class: 'import__thumb' }, m ? poster(m) : null);
      if (m && !m.thumb_url && !m.poster_url && m.wiki) {
        thumbnail(m, controller.signal).then((url) => { if (url) { m.thumb_url = url; thumb.replaceChildren(poster(m)); } }).catch(() => {});
      }
      const detail = work.kind === 'film'
        ? (work.date ? `Vu le ${formatDate(work.date)}` : 'Date inconnue')
        : `${plural(work.count, 'épisode')}${work.seasonsOnly.length ? `${work.count ? ' + ' : ''}${plural(work.seasonsOnly.length, 'saison entière', 'saisons entières')}` : ''}${work.first ? ` · ${work.first === work.last ? formatDate(work.first) : `${formatDate(work.first, { short: true })} → ${formatDate(work.last, { short: true })}`}` : ''}`;
      let choice = null;
      if (work.candidates?.length > 1) {
        choice = h('select', { class: 'select import__choice', 'aria-label': `Autre œuvre pour ${work.title}` },
          work.candidates.map((c, i) => h('option', { value: i, selected: c.item === m }, `${c.item.title}${c.item.year ? ` (${c.item.year})` : ''} · ${c.item.type === 'serie' ? 'série' : 'film'}`)));
        choice.addEventListener('change', () => {
          work.match = work.candidates[Number(choice.value)].item;
          work.kind = work.match.type; // un titre pris pour un film peut être une série, et inversement
          work.sure = true;
          work.checked = true;
          node.replaceWith(row(work));
          updateBar();
        });
      }
      const node = h('div', { class: `import__row${!m ? ' is-missing' : ''}`, dataset: { key: work.key } },
        box, thumb,
        h('div', { class: 'import__text' },
          h('p', { class: 'import__title' }, m ? `${m.title}${m.year ? ` (${m.year})` : ''}` : work.title,
            m ? h('span', { class: 'badge' }, m.type === 'serie' ? 'Série' : 'Film') : null),
          m && m.title !== work.title ? h('p', { class: 'import__from' }, `${platform} : « ${work.title} »`) : null,
          h('p', { class: 'import__detail' }, detail),
          status ? h('p', { class: `import__status import__status--${status[1]}` }, status[0]) : null,
          choice));
      return node;
    };

    const paint = () => {
      const order = (w) => (!w.match ? 2 : !w.sure ? 0 : 1); // à vérifier d'abord, introuvables à la fin
      list.replaceChildren(...[...works].sort((a, b) => order(a) - order(b)).map(row));
      updateBar();
    };

    const search = (targets) => matchAll(targets, controller.signal, (done, total) => { progress.lastChild.textContent = `Recherche des œuvres… ${done} / ${total}`; })
      .then(() => {
        for (const w of targets) { // les choix déjà faits sur les autres lignes sont gardés
          // une série trouvée comme film (ou l'inverse) suit le type de l'œuvre trouvée
          if (w.match && w.match.type !== w.kind && w.kind === 'film') w.kind = w.match.type;
          w.checked = !!w.match && (w.sure || !!findItem(w.match.source, w.match.source_id));
        }
        const found = works.filter((w) => w.match).length;
        const toCheck = works.filter((w) => w.match && !w.sure).length;
        const missing = works.filter((w) => !w.match && w.failed); // source qui n'a pas répondu : on peut réessayer
        progress.replaceChildren(`${found} sur ${works.length} retrouvées${toCheck ? ` · ${toCheck} à vérifier (non cochées : coche-les si c’est la bonne œuvre, ou choisis-en une autre dans la liste)` : ''}.`,
          ...(missing.length ? [h('button', { class: 'btn btn--small import__retry', type: 'button', onClick: () => {
            progress.replaceChildren(h('span', { class: 'spinner' }), h('span', {}, `Recherche des œuvres… 0 / ${missing.length}`));
            search(missing);
          } }, icon('refresh', 15), `Relancer la recherche (${missing.length})`)] : []));
        paint();
      })
      .catch((error) => { if (!isAbort(error)) { console.error(error); progress.textContent = 'La recherche a échoué. Vérifie ta connexion et réessaie.'; } });
    search(works);

    go.addEventListener('click', () => importStep());
  }

  // ------------------------------------------------------------------ étape 3 : importer
  async function importStep() {
    const chosen = works.filter((w) => w.checked && w.match);
    const status = h('p', { class: 'import__progress', 'aria-live': 'polite' });
    const meter = h('progress', { class: 'import__meter', max: chosen.length, value: 0 });
    root.replaceChildren(pageHeader(`Import ${platform}`, 'Ne ferme pas cette page pendant l’import.'), h('section', { class: 'panel' }, status, meter));
    const failed = [];
    let films = 0;
    let episodes = 0;
    let dated = 0;
    for (const [i, work] of chosen.entries()) {
      if (controller.signal.aborted) return;
      status.replaceChildren(h('span', { class: 'spinner' }), `${i + 1} / ${chosen.length} · ${work.match.title}`);
      try {
        // fiche complète : genres, pays, durée, et la liste des épisodes d'une série
        const item = await loadItem(work.match.source, work.match.source_id, controller.signal).catch((error) => {
          if (isAbort(error) || work.match.type === 'serie') throw error;
          return work.match; // film : la fiche courte suffit si Wikidata ne répond pas
        });
        let rows;
        if (item.type === 'serie') {
          const eps = assignEpisodes(work, item.seasons || []);
          rows = eps.map((e) => ({ season: e.season, episode: e.episode, watched_on: e.date, runtime: e.runtime }));
          // titre sans détail d'épisode (ex. « The Office » seul) : la série est marquée vue, sans épisode
          if (!rows.length && !work.episodes.length && !work.seasonsOnly.length) rows = [{ season: null, episode: null, watched_on: work.date, runtime: null }];
          if (!rows.length) throw new Error('aucun épisode reconnu');
        } else {
          rows = [{ season: null, episode: null, watched_on: work.date, runtime: item.runtime ?? null }];
        }
        const result = await importViewings(item, rows);
        if (item.type === 'serie') episodes += result.added; else films += result.added;
        dated += result.dated;
      } catch (error) {
        if (isAbort(error)) return;
        console.warn('[Import]', work.title, error);
        failed.push(work.match?.title || work.title);
      }
      meter.value = i + 1;
    }
    root.replaceChildren(
      pageHeader('Import terminé'),
      h('section', { class: 'panel import__done' },
        h('div', { class: 'import__done-icon' }, icon('check', 30)),
        h('p', { class: 'import__done-title' }, `${plural(films, 'film ajouté', 'films ajoutés')} · ${plural(episodes, 'épisode ajouté', 'épisodes ajoutés')}`),
        dated ? h('p', { class: 'muted' }, `${plural(dated, 'date complétée', 'dates complétées')} sur des œuvres que tu avais déjà.`) : null,
        h('p', { class: 'muted' }, 'Tes notes existantes n’ont pas été modifiées. Tu peux maintenant noter ce que tu as vu.'),
        failed.length ? h('p', { class: 'form__error' }, `Pas pu importer : ${failed.join(', ')}. Tu peux les ajouter à la main avec la recherche.`) : null,
        h('div', { class: 'import__actions' },
          h('a', { class: 'btn btn--primary', href: '#/stats' }, 'Voir mes stats'),
          h('a', { class: 'btn', href: '#/' }, 'Ma collection'),
          h('button', { class: 'btn', type: 'button', onClick: () => chooseStep() }, 'Importer autre chose'))));
  }

  if (!state.user) return () => {};
  chooseStep();
  return () => controller.abort();
}
