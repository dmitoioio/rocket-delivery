/**
 * Історія.
 *
 * ⚠️ Курʼєр бачить код, суму й дату — НЕ телефон і НЕ адресу.
 * Виконана доставка не дає довічного доступу до контактів клієнта (B15).
 */

import {
  statusChip,
  emptyState,
  errorState,
  skeletonList,
  esc,
  money,
  dateTime,
} from '../shared/ui.js';

export function render(state) {
  const { status, error, history } = state;

  if (status === 'loading' && !history.length) return skeletonList(2);
  if (status === 'error' && !history.length) return errorState(error, 'reload');

  if (!history.length) {
    return emptyState({
      icon: '📋',
      title: 'Історія порожня',
      text: 'Тут зʼявляться виконані доставки.',
    });
  }

  return history
    .map(
      (o) => `<article class="card">
        <div class="card__top">
          <span class="card__code">${esc(o.code)}</span>
          ${statusChip(o.status)}
        </div>
        <div class="card__row" style="margin-bottom:0">
          <span class="card__dest">${esc(o.destLocality)}</span>
          <span class="mono">${esc(money(o.total))}</span>
        </div>
        <div class="hint">${esc(dateTime(o.deliveredAt || o.cancelledAt || o.placedAt))}</div>
      </article>`
    )
    .join('');
}
