/**
 * Схематична карта з РЕАЛЬНОЮ геометрією.
 *
 * Тайлів немає свідомо: реальна карта потребує ключа провайдера й
 * рішення власника (B20, ADR-0007). Але схема, у якій точки стоять на
 * захардкоджених `left: 14%`, — це не спрощення, а брехня: вона показує
 * той самий малюнок для сусідньої вулиці й для села за 12 км.
 *
 * Тут точки проєктуються з координат. Взаємне розташування, напрямок
 * і пропорції відстаней — справжні. Немає лише підкладки.
 */

import { esc } from '../../lib/format.js';

/** Поля навколо точок, щоб пін не прилипав до краю. */
const PAD = 0.16;

/** Мінімальний розмах у градусах: інакше дві близькі точки розлітаються по кутах. */
const MIN_SPAN = 0.004;

/**
 * Проєкція географічних координат у відсотки всередині контейнера.
 *
 * Довгота стискається на cos(широти) — на 50-й паралелі градус довготи
 * майже вдвічі коротший за градус широти. Без цієї поправки схема
 * розтягнута по горизонталі, і «прямо на північ» виглядає як «навскіс».
 *
 * @param {{lat:number,lng:number}[]} points
 * @param {number} aspect ширина/висота контейнера
 */
export function project(points, aspect = 2.4) {
  const usable = points.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
  if (!usable.length) return [];

  const midLat = usable.reduce((s, p) => s + p.lat, 0) / usable.length;
  const kx = Math.cos((midLat * Math.PI) / 180);

  const xs = usable.map((p) => p.lng * kx);
  const ys = usable.map((p) => p.lat);

  let cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  let cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  let spanX = Math.max(Math.max(...xs) - Math.min(...xs), MIN_SPAN * kx);
  let spanY = Math.max(Math.max(...ys) - Math.min(...ys), MIN_SPAN);

  // Підганяємо bbox під пропорції контейнера, розширюючи — не стискаючи.
  // Стиснення зіпсувало б масштаб по одній з осей, і схема знову почала б
  // показувати не те, що є.
  if (spanX / spanY > aspect) spanY = spanX / aspect;
  else spanX = spanY * aspect;

  spanX *= 1 + PAD * 2;
  spanY *= 1 + PAD * 2;

  return points.map((p) => {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) return null;
    return {
      ...p,
      x: ((p.lng * kx - cx) / spanX + 0.5) * 100,
      // Північ угорі: вісь Y екрана спрямована вниз
      y: (0.5 - (p.lat - cy) / spanY) * 100,
    };
  });
}

/**
 * @param {object} o
 * @param {{lat:number,lng:number}} [o.from] заклад
 * @param {{lat:number,lng:number}} [o.to] клієнт
 * @param {{lat:number,lng:number,at:number}} [o.courier] остання позиція курʼєра
 * @param {string} [o.badge] підпис у кутку
 * @param {boolean} [o.large]
 */
export function geoMap({ from, to, courier, badge = '', large = false }) {
  const aspect = large ? 1.2 : 2.4;
  const [a, b, c] = project([from, to, courier], aspect);

  // Без жодної координати падати назад нема куди — показуємо порожню
  // сітку без пінів замість фальшивих позицій
  if (!a && !b && !c) {
    return `<div class="map${large ? ' map--lg' : ''}">
      ${badge ? `<div class="map__badge num">${esc(badge)}</div>` : ''}
    </div>`;
  }

  return `<div class="map${large ? ' map--lg' : ''}">
    ${a && b ? route(a, b) : ''}
    ${a ? pin(a, 'from', 'Заклад') : ''}
    ${b ? pin(b, 'to', 'Клієнт') : ''}
    ${c ? pin(c, 'courier', 'Курʼєр') : ''}
    ${badge ? `<div class="map__badge num">${esc(badge)}</div>` : ''}
  </div>`;
}

function pin(p, kind, label) {
  return `<div class="pin pin--${kind}" style="left:${fmt(p.x)}%;top:${fmt(p.y)}%"
    role="img" aria-label="${esc(label)}"></div>`;
}

/** SVG, а не повернутий div: кут між точками справжній, рахувати його вручну ні до чого. */
function route(a, b) {
  return `<svg class="map__route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <line x1="${fmt(a.x)}" y1="${fmt(a.y)}" x2="${fmt(b.x)}" y2="${fmt(b.y)}"
          vector-effect="non-scaling-stroke" />
  </svg>`;
}

function fmt(n) {
  return Math.round(n * 10) / 10;
}
