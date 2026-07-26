/**
 * Спільні UI-компоненти. Повертають HTML-рядки — рендер іде через
 * innerHTML + делегування подій, тож застарілих слухачів не лишається.
 *
 * ⚠️ Кожне значення з бази проходить через esc(): імена клієнтів,
 * орієнтири й коментарі вводять люди.
 */

import { esc, money, distance, countdown, time, dateTime, elapsed } from '../../lib/format.js';

/* ── Значки статусів ────────────────────────────────────────────────────── */

const STATUS_META = {
  preparing: { label: 'Готується', cls: 'preparing' },
  ready: { label: 'Готово', cls: 'ready' },
  courier_assigned: { label: 'Взято', cls: 'active' },
  picked_up: { label: 'Забрав', cls: 'active' },
  on_the_way: { label: 'В дорозі', cls: 'active' },
  delivered: { label: 'Доставлено', cls: 'done' },
  failed_delivery: { label: 'Не доставлено', cls: 'cancelled' },
  returned_to_queue: { label: 'Повернуто', cls: 'cancelled' },
  cancelled_by_client: { label: 'Скасував клієнт', cls: 'cancelled' },
  rejected_by_business: { label: 'Відхилив заклад', cls: 'cancelled' },
};

export function statusChip(status) {
  const meta = STATUS_META[status] || { label: status, cls: 'cancelled' };
  // Стан не кодується тільки кольором — є і крапка, і текст
  return `<span class="chip chip--${meta.cls}"><span class="chip__dot"></span>${esc(meta.label)}</span>`;
}

export function statusLabel(status) {
  return STATUS_META[status]?.label || status;
}

/* ── Степер із пунктирною трасою ────────────────────────────────────────── */

const STEPS = [
  { key: 'courier_assigned', label: 'Взято' },
  { key: 'picked_up', label: 'Забрав' },
  { key: 'on_the_way', label: 'В дорозі' },
  { key: 'delivered', label: 'Доставлено' },
];

export function stepper(status) {
  const current = STEPS.findIndex((s) => s.key === status);
  return `<div class="stepper">${STEPS.map((step, i) => {
    let cls = '';
    if (i < current) cls = 'step--done';
    else if (i === current) cls = 'step--current';
    return `<div class="step ${cls}"><span class="step__dot"></span><span>${esc(step.label)}</span></div>`;
  }).join('')}</div>`;
}

/* ── Картка черги ───────────────────────────────────────────────────────── */

/**
 * ⚠️ Свідомо НЕ показує спосіб оплати (B35) і точну адресу з телефоном (B15).
 * Показати платіжний метод у черзі — найпростіший спосіб зламати
 * економіку далеких доставок: готівкові замовлення не візьме ніхто.
 *
 * @param {object} order рядок VIEW courier_queue
 * @param {{disabled?: boolean, disabledReason?: string, taken?: boolean}} [opts]
 */
export function queueCard(order, opts = {}) {
  const isReady = order.status === 'ready';
  const left = countdown(order.estimatedReadyAt);
  const classes = ['card', opts.taken && 'card--taken', opts.disabled && 'card--disabled']
    .filter(Boolean)
    .join(' ');

  const bonus =
    order.waitingBonus > 0
      ? `<span class="bonus">+${money(order.waitingBonus)} очікування</span>`
      : '';

  const waiting =
    isReady && order.readyAt ? `<div class="hint">Чекає ${esc(elapsed(order.readyAt))}</div>` : '';

  let action;
  if (!isReady) {
    action = progressToReady(order, left);
  } else if (opts.disabled) {
    action = `<div class="notice notice--warn" style="margin:0">${esc(opts.disabledReason || 'Недоступно')}</div>`;
  } else {
    action = `<button class="btn btn--primary" data-action="accept" data-id="${esc(order.id)}">ВЗЯТИ</button>`;
  }

  return `
    <article class="${classes}" data-card="${esc(order.id)}">
      <div class="card__top">
        <span class="card__code">${esc(order.code)}</span>
        ${statusChip(order.status)}
      </div>
      <div class="card__biz">${esc(order.businessName)}</div>
      <div class="card__row">
        <span class="card__dest">📍 ${esc(order.destLocality)}</span>
        <span class="card__dist mono">${esc(distance(order.distanceKm))}</span>
      </div>
      <div class="card__row">
        <span class="card__total mono">${esc(money(order.total))}</span>
        ${bonus}
      </div>
      ${waiting}
      ${action}
    </article>`;
}

function progressToReady(order, left) {
  if (!left) {
    return `<div class="hint">Ось-ось буде готово</div>`;
  }
  const total = order.estimatedReadyAt - (order.placedAt || order.estimatedReadyAt - 900000);
  const done = Math.max(
    0,
    Math.min(100, 100 - ((order.estimatedReadyAt - Date.now()) / total) * 100)
  );
  return `
    <div class="line"><span class="line__label">Буде готово через</span>
      <strong class="mono" data-countdown="${esc(order.estimatedReadyAt)}">${esc(left)}</strong></div>
    <div class="bar"><div class="bar__fill" style="width:${done.toFixed(0)}%"></div></div>`;
}

/* ── Стани екрана ───────────────────────────────────────────────────────── */

/** Скелетон у формі майбутнього контенту, не спінер по центру. */
export function skeletonList(n = 3) {
  return Array.from({ length: n }, () => '<div class="skeleton"></div>').join('');
}

export function emptyState({ icon = '📭', title, text = '' }) {
  return `<div class="empty">
    <div class="empty__icon">${esc(icon)}</div>
    <div class="empty__title">${esc(title)}</div>
    ${text ? `<div>${esc(text)}</div>` : ''}
  </div>`;
}

/** Помилка завжди каже, що робити. Ніколи не сирий текст бекенду. */
export function errorState(error, retryAction = 'reload') {
  return `<div class="empty">
    <div class="empty__icon">⚠️</div>
    <div class="empty__title">${esc(error?.message || 'Щось пішло не так')}</div>
    <button class="btn btn--secondary btn--sm" data-action="${esc(retryAction)}"
            style="margin:16px auto 0">Спробувати ще</button>
  </div>`;
}

/* ── Дрібниці ───────────────────────────────────────────────────────────── */

export function line(label, value, mono = false) {
  return `<div class="line"><span class="line__label">${esc(label)}</span>
    <span class="${mono ? 'mono' : ''}">${esc(value)}</span></div>`;
}

export function tile(value, label, alarm = false) {
  return `<div class="tile ${alarm ? 'tile--alarm' : ''}">
    <div class="tile__value">${esc(value)}</div>
    <div class="tile__label">${esc(label)}</div>
  </div>`;
}

export function section(title, body) {
  return `<section class="section">
    <h2 class="section__title">${esc(title)}</h2>${body}</section>`;
}

export { esc, money, distance, time, dateTime, elapsed, countdown };
