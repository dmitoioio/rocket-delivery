/**
 * Завершення доставки — один екран, усі кроки видно одразу.
 *
 * Макет має рацію: не майстер із трьох модалок, а список кроків і ОДНА
 * кнопка внизу, сіра доти, доки не виконано обовʼязкове. Кур'єр бачить,
 * скільки лишилось, і не втрачає контекст між екранами.
 */

import { stepper, statusChip, esc, money, icons } from '../shared/ui.js';

/** @returns {{ok: boolean, missing: string}} */
export function readiness(flow, order) {
  if (!flow.photo) return { ok: false, missing: 'Спершу додай фото' };
  if (!flow.pinBypassed && (flow.pin || '').length !== 4) {
    return { ok: false, missing: 'Введи код клієнта або познач, що він його не памʼятає' };
  }
  if (order?.paymentMethod === 'cash' && !flow.cashTaken) {
    return { ok: false, missing: 'Підтверди, що отримав готівку' };
  }
  return { ok: true, missing: '' };
}

export function sheet(state) {
  const flow = state.complete;
  if (!flow) return '';
  if (flow.result) return successSheet(flow.result);

  const order = state.active.find((o) => o.id === flow.orderId);
  if (!order) return '';

  const isCash = order.paymentMethod === 'cash';
  const { ok, missing } = readiness(flow, order);

  return `<div class="sheet-backdrop">
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="row" style="margin-bottom:14px">
        <span class="num tiny">${esc(order.code)}</span>
        ${statusChip('on_the_way', 'на місці')}
      </div>

      ${stepper('on_the_way')}

      <div class="h-sec">Крок 1 · Фото передачі</div>
      ${photoBlock(flow)}

      <div class="h-sec">Крок 2 · Код від клієнта</div>
      ${pinBlock(flow)}

      ${isCash ? `<div class="h-sec">Крок 3 · Готівка</div>${cashBlock(order, flow)}` : ''}

      <div style="margin-top:18px">
        <button class="btn btn-ok" data-action="finish-delivery" ${ok ? '' : 'disabled'}>
          Замовлення доставлено
        </button>
        ${
          missing
            ? `<div class="tiny" style="text-align:center;margin-top:9px">${esc(missing)}</div>`
            : ''
        }
        <button class="btn btn-quiet" data-action="close-complete" style="margin-top:4px">
          Назад до доставки
        </button>
      </div>
    </div>
  </div>`;
}

/** Без фото кнопка сіра. Це єдиний доказ у спорі «а мені нічого не привезли». */
function photoBlock(flow) {
  if (flow.photo) {
    return `<div class="photo photo--done">
      <img class="photo__preview" src="${esc(flow.photo.preview)}" alt="Фото підтвердження доставки">
      <div class="row">
        <span class="tiny">${esc(Math.round(flow.photo.bytes / 1024))} КБ · готово</span>
        <button class="btn btn-ghost btn-sm" data-action="take-photo">Перезняти</button>
      </div>
    </div>`;
  }

  return `<div class="photo">
    <div class="photo__icon" style="color:var(--rocket)">${icons.photo(22)}</div>
    <div style="font-size:14.5px;font-weight:600;margin-bottom:5px">
      Сфотографуй замовлення в руках клієнта
    </div>
    <div class="tiny">Без фото завершити не вийде — це захист і для тебе, і для клієнта</div>
    <div style="margin-top:14px">
      <button class="btn btn-rocket btn-sm" style="width:100%" data-action="take-photo">
        Зробити фото
      </button>
    </div>
  </div>`;
}

/**
 * Обхід коду існує обовʼязково: клієнт забуде, і без обходу кур'єр
 * застрягне під дверима з їжею. Обхід фіксується в журналі —
 * це не дірка, а керований виняток (B12).
 */
function pinBlock(flow) {
  if (flow.pinBypassed) {
    return `<div class="card card--accent">
      <div class="row">
        <span class="mut" style="color:var(--s-cook);font-weight:600">Клієнт не памʼятає код</span>
        <button class="btn btn-ghost btn-sm" data-action="pin-restore">Ввести код</button>
      </div>
      <div class="tiny" style="margin-top:5px;color:var(--ink-2)">
        Це буде видно адміну в журналі доставки.
      </div>
    </div>`;
  }

  return `<div class="card">
    <input class="input input--pin num" id="pin-input" inputmode="numeric" pattern="[0-9]*"
           maxlength="4" autocomplete="off" placeholder="••••"
           value="${esc(flow.pin || '')}" aria-label="Код від клієнта">
    ${
      flow.pinError
        ? `<div class="tiny" style="color:var(--s-bad);margin-top:8px;text-align:center">${esc(flow.pinError)}</div>`
        : ''
    }
    <button class="btn btn-quiet" data-action="pin-bypass" style="margin-top:6px">
      Клієнт не памʼятає код
    </button>
  </div>`;
}

function cashBlock(order, flow) {
  return `<div class="card ${flow.cashTaken ? '' : ''}">
    <div class="row">
      <span class="mut">Взяти з клієнта</span>
      <span class="mid num">${esc(money(order.total))}</span>
    </div>
    <div class="tiny" style="margin-top:5px">Гроші закладу — здаси в кінці зміни</div>
    <button class="btn ${flow.cashTaken ? 'btn-ok' : 'btn-ghost'}" data-action="cash-taken"
            style="margin-top:12px">
      ${flow.cashTaken ? 'Отримано ✓' : 'Отримав готівку'}
    </button>
  </div>`;
}

export function successSheet(result) {
  return `<div class="sheet-backdrop" data-action="close-complete">
    <div class="sheet" role="dialog" aria-modal="true" data-stop style="text-align:center">
      <div class="empty__icon" style="background:var(--s-done-soft);color:var(--s-done)">
        ${icons.check(26)}
      </div>
      <h2 class="sheet__title">Доставлено</h2>

      <div class="card" style="text-align:left">
        <div class="row">
          <span class="mut">Заробіток за доставку</span>
          <strong class="mid num accent">+${esc(money(result.earned))}</strong>
        </div>
        ${
          result.cashOnHand
            ? `<div class="row">
                 <span class="mut">Готівки на руках</span>
                 <strong class="num">${esc(money(result.cashOnHand))}</strong>
               </div>`
            : ''
        }
      </div>

      <button class="btn btn-rocket" data-action="close-complete" style="margin-top:16px">
        Далі
      </button>
    </div>
  </div>`;
}
