/**
 * Вкладки зі свайпом.
 *
 * Два правила:
 *  • жодна функція не доступна ЛИШЕ свайпом — завжди є тап по вкладці;
 *  • свайп ігнорується всередині карти, інакше перетягування Leaflet
 *    сприймається як перехід між вкладками (B27).
 */

import { esc } from '../../lib/format.js';

const SWIPE_MIN_X = 60;
const SWIPE_MAX_Y = 45;

/**
 * @param {{key: string, label: string, icon: (s?: number) => string, badge?: number}[]} tabs
 * @param {string} activeKey
 */
export function renderTabs(tabs, activeKey) {
  return `<nav class="tabbar" role="tablist">${tabs
    .map((t) => {
      const badge = t.badge ? `<span class="tab__badge num">${esc(t.badge)}</span>` : '';
      return `<button class="tab" role="tab" aria-selected="${t.key === activeKey}"
                data-action="tab" data-tab="${esc(t.key)}">
        ${badge}${t.icon(21)}<span>${esc(t.label)}</span>
      </button>`;
    })
    .join('')}</nav>`;
}

/**
 * @param {HTMLElement} el
 * @param {(dir: 1|-1) => void} onSwipe
 */
export function attachSwipe(el, onSwipe) {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  el.addEventListener(
    'touchstart',
    (e) => {
      // Свайп не починається всередині карти — там жести належать їй
      if (e.target.closest('.map')) {
        tracking = false;
        return;
      }
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    },
    { passive: true }
  );

  el.addEventListener(
    'touchend',
    (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      // Вертикальний рух = скрол, не свайп
      if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dy) > SWIPE_MAX_Y) return;
      onSwipe(dx < 0 ? 1 : -1);
    },
    { passive: true }
  );
}
