/** Профіль: онлайн/офлайн, заробіток, готівка на руках. */

import { esc, money, deliveriesText } from './profile-utils.js';
import { errorState, skeletonList } from '../shared/ui.js';

export function render(state) {
  const c = state.courier;
  if (!c) return state.status === 'error' ? errorState(state.error, 'reload') : skeletonList(2);

  const online = c.status === 'online';
  const limit = c.cashLimit || 1;
  const pct = Math.min(100, Math.round((c.cashOnHand / limit) * 100));
  const barCls = pct >= 100 ? 'bar__fill--danger' : pct >= 75 ? 'bar__fill--warn' : '';

  return `
    <div class="card">
      <div class="card__top">
        <span class="chip ${online ? 'chip--ready' : 'chip--cancelled'}">
          <span class="chip__dot"></span>${online ? 'ОНЛАЙН' : 'ОФЛАЙН'}
        </span>
        <button class="btn btn--secondary btn--sm" data-action="toggle-online">
          ${online ? 'Вимкнути' : 'Увімкнути'}
        </button>
      </div>
      <div class="card__biz" style="margin:0">${esc(c.fullName)}</div>
    </div>

    ${!online ? `<div class="notice">Поки ти офлайн, замовлення з черги брати не можна.</div>` : ''}

    <div class="card">
      <div class="section__title">Сьогодні</div>
      <div class="card__row">
        <span>${esc(deliveriesText(c.todayCount))}</span>
        <strong class="mono">${esc(money(c.todayAmount))}</strong>
      </div>
      <div class="section__title" style="margin-top:16px">Цього тижня</div>
      <div class="card__row" style="margin-bottom:0">
        <span>${esc(deliveriesText(c.weekCount))}</span>
        <strong class="mono">${esc(money(c.weekAmount))}</strong>
      </div>
    </div>

    <div class="card">
      <div class="section__title">💵 Готівка на руках</div>
      <div class="card__row">
        <strong class="mono" style="font-size:20px">${esc(money(c.cashOnHand))}</strong>
        <span class="line__label mono">ліміт ${esc(money(limit))}</span>
      </div>
      <div class="bar"><div class="bar__fill ${barCls}" style="width:${pct}%"></div></div>
      ${
        pct >= 100
          ? `<div class="notice notice--danger" style="margin:12px 0 0">
               Ліміт вичерпано. Замовлення з оплатою готівкою недоступні, поки не здаси.
             </div>`
          : `<div class="hint">Ще ${esc(money(Math.max(0, limit - c.cashOnHand)))} до блокування</div>`
      }
      <button class="btn btn--primary" data-action="open-handoff" style="margin-top:16px"
              ${c.cashOnHand <= 0 ? 'disabled' : ''}>ЗДАТИ ГОТІВКУ</button>
    </div>

    <button class="btn btn--ghost" data-action="logout">Вийти</button>
  `;
}

/** Шторка здачі готівки. Двосторонній протокол — заклад підтверджує (ADR-0008). */
export function handoffSheet(courier) {
  return `<div class="sheet-backdrop" data-action="close-sheet">
    <div class="sheet" role="dialog" aria-modal="true" data-stop>
      <h2 class="sheet__title">Здача готівки</h2>
      <div class="field">
        <label class="field__label" for="handoff-amount">Скільки здаєш</label>
        <input class="input mono" id="handoff-amount" inputmode="numeric"
               value="${esc(courier.cashOnHand)}">
      </div>
      <div class="notice">
        Заклад має підтвердити суму. Якщо суми не збігаються — розбіжність
        фіксується в системі, а не залишається на словах.
      </div>
      <button class="btn btn--primary" data-action="declare-handoff">ЗДАВ</button>
      <button class="btn btn--ghost" data-action="close-sheet" style="margin-top:8px">Назад</button>
    </div>
  </div>`;
}

/** Пояснення перед системним запитом — браузер не покаже його вдруге (B22). */
export function geoGateSheet() {
  return `<div class="sheet-backdrop">
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="empty__icon" style="text-align:center">📍</div>
      <h2 class="sheet__title">Потрібен доступ до локації</h2>
      <p style="margin-bottom:20px">
        Клієнт і заклад бачать, де ти їдеш. Без цього замовлення брати не можна.
      </p>
      <button class="btn btn--primary" data-action="grant-geo">ДОЗВОЛИТИ</button>
      <button class="btn btn--ghost" data-action="close-sheet" style="margin-top:8px">Не зараз</button>
    </div>
  </div>`;
}

export function geoDeniedSheet() {
  return `<div class="sheet-backdrop" data-action="close-sheet">
    <div class="sheet" role="dialog" aria-modal="true" data-stop>
      <h2 class="sheet__title">Доступ до локації заблоковано</h2>
      <p style="margin-bottom:20px">
        Браузер більше не запитає дозвіл сам. Увімкни геолокацію для цього сайту
        в налаштуваннях браузера, потім спробуй ще раз.
      </p>
      <button class="btn btn--secondary" data-action="close-sheet">Зрозуміло</button>
    </div>
  </div>`;
}
