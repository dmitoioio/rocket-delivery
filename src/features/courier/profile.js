/**
 * Профіль і здача готівки.
 *
 * Здача готівки — найважливіший екран, якого в прототипі не було зовсім.
 * Поки готівка не здана — зміна не закрита.
 */

import { errorState, skeletonList, esc, money, avatar, icons } from '../shared/ui.js';
import { deliveries } from '../../lib/format.js';

export function render(state) {
  const c = state.courier;
  if (!c) return state.status === 'error' ? errorState(state.error, 'reload') : skeletonList(2);

  const online = c.status === 'online';
  const limit = c.cashLimit || 1;
  const pct = Math.min(100, Math.round((c.cashOnHand / limit) * 100));
  const barCls = pct >= 100 ? 'bar__fill--danger' : pct >= 75 ? 'bar__fill--warn' : '';

  return `
    <div class="card">
      <div class="row">
        <div style="display:flex;align-items:center;gap:12px">
          ${avatar(c.fullName)}
          <div>
            <div class="strong">${esc(c.fullName)}</div>
            <div class="tiny num">${esc(c.login)}</div>
          </div>
        </div>
        <button class="sw" role="switch" aria-checked="${online}" data-action="toggle-online"
                aria-label="${online ? 'Вийти з лінії' : 'Вийти на лінію'}"></button>
      </div>
      <div class="tiny" style="margin-top:10px">
        ${online ? 'Ти на лінії — замовлення з черги доступні.' : 'Поки ти офлайн, замовлення брати не можна.'}
      </div>
    </div>

    <div class="h-sec">Заробіток</div>
    <div class="card trio">
      <div>
        <div class="mid num">${esc(c.todayCount)}</div>
        <div class="tiny">сьогодні</div>
      </div>
      <div>
        <div class="mid num accent">${esc(money(c.weekAmount))}</div>
        <div class="tiny">за тиждень</div>
      </div>
    </div>
    <div class="tiny" style="margin-top:8px">
      ${esc(deliveries(c.weekCount))} цього тижня · виплата в пʼятницю
    </div>

    <div class="h-sec">Готівка на руках</div>
    <div class="card ${pct >= 100 ? 'card--hot' : ''}">
      <div class="row">
        <span class="big num">${esc(money(c.cashOnHand))}</span>
        <span class="lbl num">ліміт ${esc(money(limit))}</span>
      </div>
      <div class="bar" style="margin-top:12px">
        <div class="bar__fill ${barCls}" style="width:${pct}%"></div>
      </div>
      <div class="tiny" style="margin-top:8px">
        ${
          pct >= 100
            ? 'Ліміт вичерпано. Замовлення з оплатою готівкою недоступні, поки не здаси.'
            : `Ще ${esc(money(Math.max(0, limit - c.cashOnHand)))} до блокування нових замовлень готівкою`
        }
      </div>
      <button class="btn btn-dark" data-action="open-handoff" style="margin-top:14px"
              ${c.cashOnHand <= 0 ? 'disabled' : ''}>
        Здати готівку в заклад
      </button>
    </div>

    <button class="btn btn-quiet" data-action="logout" style="margin-top:20px">Вийти</button>
  `;
}

/**
 * Здача готівки. Двосторонній протокол: кур'єр заявляє — заклад підтверджує.
 * Розбіжність стає зафіксованим боргом, а не усною суперечкою (ADR-0008).
 */
export function handoffSheet(courier, orders = []) {
  return `<div class="sheet-backdrop" data-action="close-sheet">
    <div class="sheet" role="dialog" aria-modal="true" data-stop>
      <h2 class="sheet__title">Здача готівки</h2>

      <div class="card card--hot" style="text-align:center;padding:20px 15px">
        <div class="lbl">Маєш здати в «Суші Мар»</div>
        <div class="huge num" style="margin:5px 0 4px">${esc(money(courier.cashOnHand))}</div>
        <div class="tiny">за ${esc(deliveries(orders.length || 0))} готівкою</div>
      </div>

      ${
        orders.length
          ? `<div class="h-sec">Із чого складається</div>
             <div class="card">
               ${orders
                 .map(
                   (o) => `<div class="row">
                     <span class="tiny num">${esc(o.code)}</span>
                     <span class="num" style="font-weight:600">${esc(money(o.total))}</span>
                   </div>`
                 )
                 .join('')}
             </div>`
          : ''
      }

      <div class="field" style="margin-top:14px">
        <label class="field__label" for="handoff-amount">Скільки здаєш фактично</label>
        <input class="input num" id="handoff-amount" inputmode="numeric"
               value="${esc(courier.cashOnHand)}">
      </div>

      <button class="btn btn-dark" data-action="declare-handoff">
        Здав ${esc(money(courier.cashOnHand))} у заклад
      </button>
      <div class="tiny" style="text-align:center;margin-top:9px">
        Заклад підтвердить суму зі свого боку. Після підтвердження зміна закриється.
      </div>
      <button class="btn btn-quiet" data-action="close-sheet" style="margin-top:4px">Назад</button>
    </div>
  </div>`;
}

/** Пояснення ПЕРЕД системним запитом — браузер не покаже його вдруге (B22). */
export function geoGateSheet() {
  return `<div class="sheet-backdrop">
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="empty__icon" style="background:var(--s-go-soft);color:var(--s-go)">
        ${icons.active(24)}
      </div>
      <h2 class="sheet__title">Потрібен доступ до локації</h2>
      <p class="mut" style="margin-bottom:20px">
        Заклад і адмін бачать, де ти їдеш, поки триває доставка. Після
        завершення трекінг вимикається. Без дозволу вийти на лінію не можна.
      </p>
      <button class="btn btn-rocket" data-action="grant-geo">Дозволити</button>
      <button class="btn btn-quiet" data-action="close-sheet" style="margin-top:4px">Не зараз</button>
    </div>
  </div>`;
}

export function geoDeniedSheet() {
  return `<div class="sheet-backdrop" data-action="close-sheet">
    <div class="sheet" role="dialog" aria-modal="true" data-stop>
      <h2 class="sheet__title">Доступ до локації заблоковано</h2>
      <p class="mut" style="margin-bottom:20px">
        Браузер більше не запитає дозвіл сам. Увімкни геолокацію для цього
        сайту в налаштуваннях браузера, потім спробуй ще раз.
      </p>
      <button class="btn btn-ghost" data-action="close-sheet">Зрозуміло</button>
    </div>
  </div>`;
}
