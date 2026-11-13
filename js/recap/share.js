// ============================================================================
//  Image de partage d'un récap : PNG 1080 × 1920 (format « story »),
//  dessinée aux couleurs du thème choisi, puis partagée avec le menu de
//  partage du téléphone (navigator.share) ou, à défaut, téléchargée.
// ============================================================================
import { formatNumber, formatTime } from '../utils.js';
import { recapName } from './service.js';

const W = 1080;
const H = 1920;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous'; // les affiches autorisent la copie : l'image reste exportable
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
    setTimeout(() => resolve(null), 8000);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Le logo caméra, dessiné au trait (mêmes formes que le SVG du site). */
function drawLogo(ctx, x, y, height, color) {
  const k = height / 96;
  ctx.save();
  ctx.translate(x, y); ctx.scale(k, k);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 5; ctx.lineJoin = 'round';
  for (const cx of [27, 61]) {
    ctx.beginPath(); ctx.arc(cx, 22, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, 22, 3, 0, Math.PI * 2); ctx.fill();
  }
  roundRect(ctx, 7, 44, 72, 44, 6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(79, 56); ctx.lineTo(105, 44); ctx.lineTo(105, 88); ctx.lineTo(79, 76); ctx.closePath(); ctx.stroke();
  ctx.restore();
}

/** Dessine l'image et renvoie un Blob PNG. */
export async function renderShareImage(recap) {
  const colors = { bg: css('bg'), surface: css('surface'), surface2: css('surface-2'), line: css('line'), text: css('text'), muted: css('muted'), accent: css('accent'), logo: css('logo'), title: css('title') };
  try { await Promise.all([document.fonts.load('800 120px Manrope'), document.fonts.load('600 40px Manrope')]); } catch { /* police système à défaut */ }
  const font = (weight, size) => `${weight} ${size}px Manrope, system-ui, sans-serif`;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // fond : dégradé du thème + halo discret de l'accent
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, colors.surface); gradient.addColorStop(1, colors.bg);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 520, 40, W / 2, 520, 700);
  glow.addColorStop(0, `${colors.accent}33`); glow.addColorStop(1, `${colors.accent}00`);
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  // en-tête
  drawLogo(ctx, 90, 96, 78, colors.logo);
  ctx.fillStyle = colors.title; ctx.font = font(800, 54); ctx.textBaseline = 'middle';
  ctx.fillText('MaCinéthèque', 210, 136);
  ctx.fillStyle = colors.accent; ctx.font = font(700, 40);
  ctx.fillText(`Mon récap · ${recapName(recap)}${recap.provisional ? ' (en cours)' : ''}`, 90, 260);

  // affiche de l'œuvre phare
  const star = recap.favoriteFilm || recap.favoriteSeries || recap.mostTimeSeries;
  const img = await loadImage(star?.poster);
  let y = 330;
  if (img) {
    const ph = 560; const pw = Math.round(ph * (2 / 3));
    const px = (W - pw) / 2;
    ctx.save(); roundRect(ctx, px, y, pw, ph, 28); ctx.clip();
    const scale = Math.max(pw / img.width, ph / img.height);
    ctx.drawImage(img, px + (pw - img.width * scale) / 2, y + (ph - img.height * scale) / 2, img.width * scale, img.height * scale);
    ctx.restore();
    ctx.strokeStyle = colors.line; ctx.lineWidth = 2; roundRect(ctx, px, y, pw, ph, 28); ctx.stroke();
    ctx.fillStyle = colors.muted; ctx.font = font(600, 34); ctx.textAlign = 'center';
    ctx.fillText(`${recap.favoriteFilm ? 'Film préféré' : 'Série phare'} : ${star.title}`.slice(0, 48), W / 2, y + ph + 50);
    ctx.textAlign = 'left';
    y += ph + 120;
  } else {
    y += 80;
  }

  // temps total
  ctx.textAlign = 'center';
  ctx.fillStyle = colors.title; ctx.font = font(800, 132);
  ctx.fillText(formatTime(recap.minutes), W / 2, y + 60);
  ctx.fillStyle = colors.muted; ctx.font = font(600, 38);
  ctx.fillText('de films et de séries', W / 2, y + 150);
  y += 230;

  // chiffres clés (2 × 2)
  const cells = [[recap.films, recap.films > 1 ? 'films' : 'film'], [recap.series, recap.series > 1 ? 'séries' : 'série'], [recap.seasons, recap.seasons > 1 ? 'saisons' : 'saison'], [recap.episodes, recap.episodes > 1 ? 'épisodes' : 'épisode']];
  const cw = 420; const ch = 170; const gap = 30; const x0 = (W - cw * 2 - gap) / 2;
  cells.forEach(([value, label], i) => {
    const cx = x0 + (i % 2) * (cw + gap); const cy = y + Math.floor(i / 2) * (ch + gap);
    ctx.fillStyle = colors.surface2; roundRect(ctx, cx, cy, cw, ch, 26); ctx.fill();
    ctx.fillStyle = colors.accent; ctx.font = font(800, 76); ctx.fillText(formatNumber(value), cx + cw / 2, cy + 72);
    ctx.fillStyle = colors.muted; ctx.font = font(600, 34); ctx.fillText(label, cx + cw / 2, cy + 132);
  });
  y += ch * 2 + gap + 90;

  if (recap.average != null) {
    ctx.fillStyle = colors.text; ctx.font = font(700, 44);
    ctx.fillText(`Note moyenne : ${formatNumber(recap.average, 1)} ★`, W / 2, Math.min(y, H - 190));
  }
  ctx.fillStyle = colors.muted; ctx.font = font(600, 30);
  ctx.fillText('MaCinéthèque', W / 2, H - 90);
  ctx.textAlign = 'left';

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Partage l'image (menu de partage de l'iPhone) ou la télécharge. */
export async function shareRecap(recap) {
  const blob = await renderShareImage(recap);
  const name = `macinetheque-recap-${recap.key}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Mon récap MaCinéthèque · ${recapName(recap)}` });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled'; // partage annulé par l'utilisateur
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
