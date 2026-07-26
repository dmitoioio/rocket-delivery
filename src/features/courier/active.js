/** Активне замовлення: степер, карта, контакт, головна дія. */

import { stepper, emptyState, esc, money, distance } from '../shared/ui.js';

const NEXT = {
  courier_assigned: { to: 'picked_up', label: 'ЗАБРАВ У ЗАКЛАДІ' },
  picked_up: { to: 'on_the_way', label: 'ВИЇХАВ ДО КЛІЄНТА' },
  on_the_way: { to: 'delivered', label: 'ДОСТАВЛЕНО' },
};

export function render(state) {
  const order = state.active[0];

  if (!order) {
    return emptyState({
      icon: '🛵',
      title: 'Немає активного замовлення',
      text: 'Візьми замовлення з черги, щоб почати доставку.',
    });
  }

  const contact = state.contact?.orderId === order.id ? state.contact : null;
  const next = NEXT[order.status];
  const isCash = order.paymentMethod === 'cash';
  const pendingAction = state.pending.includes(order.id);

  return `
    <div class="card">
      <div class="card__top">
        <span class="card__code">${esc(order.code)}</span>
        <span class="card__total mono">${esc(money(order.total))}</span>
      </div>
      ${
        isCash
          ? `<span class="chip chip--cash"><span class="chip__dot"></span>ГОТІВКА ${esc(money(order.total))}</span>`
          : `<span class="chip chip--online"><span class="chip__dot"></span>Оплачено онлайн</span>`
      }
    </div>

    <div class="card">${stepper(order.status)}</div>

    <div class="map" id="active-map">
      <div class="map__placeholder">Карта маршруту</div>
    </div>

    ${addressBlock(order, contact)}

    <div class="card">
      <div class="card__biz">Заклад</div>
      <div class="addr"><span>🏪</span><span>${esc(order.businessName || 'Суші Мар')}</span></div>
      <div class="card__row" style="margin:0">
        <span class="line__label">Відстань</span>
        <span class="mono">${esc(distance(order.distanceKm))}</span>
      </div>
    </div>

    ${
      next
        ? `<button class="btn btn--primary" data-action="advance"
             data-id="${esc(order.id)}" data-to="${esc(next.to)}" ${pendingAction ? 'disabled' : ''}>
             ${pendingAction ? 'Відправляється...' : esc(next.label)}
           </button>`
        : ''
    }
    <button class="btn btn--ghost" data-action="open-cancel" data-id="${esc(order.id)}"
            style="margin-top:8px">Скасувати замовлення</button>
  `;
}

/**
 * Адреса й контакт зʼявляються ТІЛЬКИ після взяття і тільки поки
 * замовлення активне — вони приходять окремим RPC (B15).
 *
 * Орієнтир показується нарівні з адресою, а не дрібним шрифтом під нею:
 * у селах без нумерації «зелені ворота, за магазином» і Є адресою.
 */
function addressBlock(order, contact) {
  if (!contact) {
    return `<div class="card"><div class="hint">Завантажуємо адресу…</div></div>`;
  }

  const tel = String(contact.clientPhone || '').replace(/[^\d+]/g, '');

  return `<div class="card">
    <div class="addr"><span>📍</span><span>${esc(contact.destAddressText)}</span></div>
    ${
      contact.destLandmark
        ? `<div class="addr addr--landmark"><span>🚩</span><span>${esc(contact.destLandmark)}</span></div>`
        : ''
    }
    <div class="card__row" style="margin-top:12px;margin-bottom:0">
      <span>👤 ${esc(contact.clientName)}</span>
      ${tel ? `<a class="btn btn--secondary btn--sm" href="tel:${esc(tel)}">Подзвонити</a>` : ''}
    </div>
  </div>`;
}

/** Причини скасування — кнопки з іконками: курʼєр обирає в поспіху. */
export const CANCEL_REASONS = [
  { code: 'client_no_answer_door', icon: '🚪', label: 'Клієнт не відкриває' },
  { code: 'client_unreachable', icon: '📵', label: 'Клієнт не відповідає' },
  { code: 'vehicle_problem', icon: '🛵', label: 'Проблема зі скутером' },
  { code: 'return_to_queue', icon: '↩️', label: 'Повернути в чергу' },
  { code: 'other', icon: '✏️', label: 'Інше' },
];

export function cancelSheet(orderId) {
  return `<div class="sheet-backdrop" data-action="close-sheet">
    <div class="sheet" role="dialog" aria-modal="true" data-stop>
      <h2 class="sheet__title">Чому скасовуєш?</h2>
      ${CANCEL_REASONS.map(
        (r) => `<button class="reason" data-action="cancel-order"
                  data-id="${esc(orderId)}" data-reason="${esc(r.code)}">
          <span class="reason__icon" aria-hidden="true">${esc(r.icon)}</span>
          <span>${esc(r.label)}</span></button>`
      ).join('')}
      <button class="btn btn--ghost" data-action="close-sheet" style="margin-top:8px">Назад</button>
    </div>
  </div>`;
}
