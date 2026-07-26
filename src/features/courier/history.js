/**
 * Історія та заробіток.
 *
 * Кур'єр має бачити свої гроші щодня, а не дізнаватись суму в п'ятницю.
 *
 * ⚠️ Показуємо код, суму й час — НЕ телефон і НЕ адресу. Виконана доставка
 * не дає довічного доступу до контактів клієнта (B15).
 */

import {
  statusChip,
  emptyState,
  errorState,
  skeletonList,
  esc,
  money,
  time,
} from '../shared/ui.js';
import { deliveries } from '../../lib/format.js';

export function render(state) {
  const { status, error, history, courier } = state;

  if (status === 'loading' && !history.length) return skeletonList(2);
  if (status === 'error' && !history.length) return errorState(error, 'reload');

  const delivered = history.filter((o) => o.status === 'delivered');
  const rate = history.length ? Math.round((delivered.length / history.length) * 100) : 100;
  const avg = averageMinutes(delivered);

  return `
    <div class="card" style="text-align:center;padding:20px 15px">
      <div class="lbl">Нараховано цього тижня</div>
      <div class="huge num accent" style="margin:5px 0 4px">${esc(money(courier?.weekAmount ?? 0))}</div>
      <div class="tiny">${esc(deliveries(courier?.weekCount ?? 0))} · виплата в пʼятницю</div>
    </div>

    <div class="card trio">
      <div>
        <div class="mid num">${esc(avg)}</div>
        <div class="tiny">середній час</div>
      </div>
      <div>
        <div class="mid num" style="color:var(--s-done)">${esc(rate)}%</div>
        <div class="tiny">доставлено</div>
      </div>
    </div>

    ${
      history.length
        ? `<div class="h-sec">Останні · ${history.length}</div>` + history.map(item).join('')
        : emptyState({
            icon: 'history',
            title: 'Історія порожня',
            text: 'Тут зʼявляться виконані доставки та заробіток за кожну.',
          })
    }`;
}

function item(o) {
  const span =
    o.pickedUpAt && o.deliveredAt
      ? `${time(o.pickedUpAt)} → ${time(o.deliveredAt)} · ${Math.round((o.deliveredAt - o.pickedUpAt) / 60000)} хв`
      : time(o.deliveredAt || o.cancelledAt || o.placedAt);

  const earned = o.status === 'delivered' ? o.courierEarnings : null;

  return `<article class="card">
    <div class="row">
      <span class="num tiny">${esc(o.code)}</span>
      ${statusChip(o.status)}
    </div>
    <div class="row" style="margin-top:7px">
      <span class="tiny">${esc(span)}</span>
      ${earned ? `<span class="num" style="font-weight:650">+${esc(money(earned))}</span>` : ''}
    </div>
  </article>`;
}

function averageMinutes(delivered) {
  const spans = delivered
    .filter((o) => o.pickedUpAt && o.deliveredAt)
    .map((o) => (o.deliveredAt - o.pickedUpAt) / 60000);
  if (!spans.length) return '—';
  return `${Math.round(spans.reduce((s, x) => s + x, 0) / spans.length)} хв`;
}
