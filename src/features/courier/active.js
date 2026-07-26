/** Активна доставка: степер, карта, адреса з орієнтиром, одна головна дія. */

import { stepper, statusChip, emptyState, esc, money, distance, icons } from '../shared/ui.js';

const NEXT = {
  courier_assigned: { to: 'picked_up', label: 'Забрав у закладі' },
  picked_up: { to: 'on_the_way', label: 'Я в дорозі' },
  on_the_way: { to: 'delivered', label: 'Я на місці' },
};

export function render(state) {
  const order = state.active[0];

  if (!order) {
    return emptyState({
      icon: 'active',
      title: 'Немає активної доставки',
      text: 'Візьми замовлення з черги, щоб почати.',
    });
  }

  const contact = state.contact?.orderId === order.id ? state.contact : null;
  const next = NEXT[order.status];
  const isCash = order.paymentMethod === 'cash';
  const busy = state.pending.includes(order.id);

  return `
    <div class="row" style="padding:2px 0 14px">
      <span class="num tiny">${esc(order.code)}</span>
      ${statusChip(order.status)}
    </div>

    ${stepper(order.status)}

    <div class="map">
      <div class="map__route"></div>
      <div class="pin pin--from"></div>
      <div class="pin pin--to"></div>
      <div class="map__badge num">${esc(distance(order.distanceKm))} · ~${esc(eta(order.distanceKm))}</div>
    </div>

    ${address(contact)}
    ${client(contact)}
    ${cash(order, isCash)}

    <div style="margin-top:16px">
      ${
        next
          ? `<button class="btn btn-rocket" data-action="advance"
               data-id="${esc(order.id)}" data-to="${esc(next.to)}" ${busy ? 'disabled' : ''}>
               ${busy ? 'Відправляється…' : esc(next.label)}
             </button>`
          : ''
      }
      <button class="btn btn-danger" data-action="open-cancel" data-id="${esc(order.id)}">
        Не можу доставити
      </button>
    </div>`;
}

/** Груба оцінка на електроскутері ~18 км/год по селу. */
function eta(km) {
  return `${Math.max(2, Math.round(((km || 0) / 18) * 60))} хв`;
}

/**
 * Орієнтир написаний великим і виділений блоком — у селі він важливіший
 * за номер будинку. Адреса й контакт приходять окремим RPC і тільки поки
 * замовлення активне (B15).
 */
function address(contact) {
  if (!contact) {
    return `<div class="card" style="margin-top:11px"><div class="tiny">Завантажуємо адресу…</div></div>`;
  }
  return `<div class="card" style="margin-top:11px">
    <div class="lbl">Адреса доставки</div>
    <div class="addr-line">${esc(contact.destAddressText)}</div>
    ${contact.destLandmark ? `<div class="landmark">${esc(contact.destLandmark)}</div>` : ''}
  </div>`;
}

/** Телефон клієнта — одним тапом, зелений круг, 46px. */
function client(contact) {
  if (!contact) return '';
  const tel = String(contact.clientPhone || '').replace(/[^\d+]/g, '');
  return `<div class="card">
    <div class="row">
      <div>
        <div class="lbl">${esc(contact.clientName)}</div>
        <div class="num" style="font-size:16px;font-weight:650;margin-top:2px">${esc(contact.clientPhone)}</div>
      </div>
      ${tel ? `<a class="call" href="tel:${esc(tel)}" aria-label="Подзвонити клієнту" style="color:#fff">${icons.phone()}</a>` : ''}
    </div>
  </div>`;
}

/** Скільки взяти з клієнта — окремою карткою, щоб не забув біля дверей. */
function cash(order, isCash) {
  return `<div class="card">
    <div class="row">
      <span class="mut">Взяти з клієнта</span>
      <span class="mid num" style="color:${isCash ? 'var(--ink)' : 'var(--s-done)'}">
        ${esc(money(isCash ? order.total : 0))}
      </span>
    </div>
    <div class="tiny" style="margin-top:5px">
      ${isCash ? 'Готівка — гроші закладу, здаси в кінці зміни' : 'Оплачено онлайн — грошей не беремо'}
    </div>
  </div>`;
}

/**
 * Кур'єр не вирішує сам і не «губить» замовлення — він піднімає прапорець,
 * далі вирішує адмін. Замовлення завмирає, а не зникає.
 */
export const CANCEL_REASONS = [
  { code: 'client_unreachable', label: 'Клієнт не відповідає' },
  { code: 'address_not_found', label: 'Не можу знайти адресу' },
  { code: 'client_refused', label: 'Клієнт відмовився від замовлення' },
  { code: 'vehicle_problem', label: 'Проблема зі скутером' },
  { code: 'return_to_queue', label: 'Повернути замовлення в чергу' },
];

export function cancelSheet(orderId) {
  return `<div class="sheet-backdrop" data-action="close-sheet">
    <div class="sheet" role="dialog" aria-modal="true" data-stop>
      <h2 class="sheet__title">Що сталось?</h2>
      ${CANCEL_REASONS.map(
        (r) => `<button class="reason" data-action="cancel-order"
                  data-id="${esc(orderId)}" data-reason="${esc(r.code)}">
          <span>${esc(r.label)}</span>
          <span style="color:var(--ink-3)">${icons.chevron()}</span>
        </button>`
      ).join('')}

      <div class="card card--accent" style="margin-top:18px">
        <div style="font-size:14px;font-weight:600;color:var(--s-cook);margin-bottom:5px">
          Що буде далі
        </div>
        <div class="tiny" style="color:var(--ink-2)">
          Адмін одразу побачить це в дашборді й подзвонить клієнту. Замовлення
          не закривається і не зникає — воно чекає рішення. Твій заробіток за
          цю поїздку зберігається.
        </div>
      </div>

      <button class="btn btn-ghost" data-action="close-sheet" style="margin-top:18px">
        Повернутись до доставки
      </button>
    </div>
  </div>`;
}
