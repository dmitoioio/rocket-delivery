/**
 * Спільні UI-компоненти. Повертають HTML-рядки — рендер іде через
 * innerHTML + делегування подій, тож застарілих слухачів не лишається.
 *
 * ⚠️ Кожне значення з бази проходить через esc(): імена клієнтів,
 * орієнтири й коментарі вводять люди.
 */

import { esc, money, distance, countdown, time, dateTime, elapsed } from '../../lib/format.js';
import { icons, initials } from './icons.js';

/* ── Статуси ─────────────────────────────────────────────────────────────── */

/**
 * Шість спільних кольорів статусів. Однакові на всіх чотирьох поверхнях:
 * клієнт, заклад, кур'єр, адмін. «Доставлено» зелене скрізь.
 * Це спільна ДНК замість спільного вигляду — не перевизначати локально.
 */
const STATUS_META = {
  placed: { label: 'створено', cls: 'st-new' },
  accepted_by_business: { label: 'прийнято закладом', cls: 'st-cook' },
  preparing: { label: 'готується', cls: 'st-cook' },
  ready: { label: 'готово', cls: 'st-ready' },
  courier_assigned: { label: 'взято', cls: 'st-go' },
  picked_up: { label: 'забрав', cls: 'st-go' },
  on_the_way: { label: 'в дорозі', cls: 'st-go' },
  delivered: { label: 'доставлено', cls: 'st-done' },
  failed_delivery: { label: 'збій доставки', cls: 'st-bad' },
  returned_to_queue: { label: 'повернуто', cls: 'st-bad' },
  cancelled_by_client: { label: 'скасував клієнт', cls: 'st-bad' },
  rejected_by_business: { label: 'відхилив заклад', cls: 'st-bad' },
  overdue: { label: 'прострочено', cls: 'st-dim' },
};

export function statusChip(status, overrideLabel) {
  const meta = STATUS_META[status] || { label: status, cls: 'st-dim' };
  return `<span class="st ${meta.cls}">${esc(overrideLabel || meta.label)}</span>`;
}

export function statusLabel(status) {
  return STATUS_META[status]?.label || status;
}

/* ── Горизонтальний степер ──────────────────────────────────────────────── */

const STEPS = [
  { key: 'courier_assigned', label: 'Взяв' },
  { key: 'picked_up', label: 'Забрав' },
  { key: 'on_the_way', label: 'В дорозі' },
  { key: 'delivered', label: 'Доставив' },
];

/** Смуги, не крапки: на вузькому екрані читається краще. */
export function stepper(status) {
  const current = STEPS.findIndex((s) => s.key === status);
  const bars = STEPS.map((_, i) => `<div class="${i <= current ? 'on' : ''}"></div>`).join('');
  const labels = STEPS.map(
    (s, i) => `<span class="${i === current ? 'on' : ''}">${esc(s.label)}</span>`
  ).join('');
  return `<div class="hstep">${bars}</div><div class="hstep-lbl">${labels}</div>`;
}

/* ── Картка черги ───────────────────────────────────────────────────────── */

/**
 * ⚠️ Два свідомі відхилення від макета — і обидва не про вигляд, а про поведінку:
 *
 * 1. НЕ показуємо спосіб оплати. У макеті на картці стоїть «готівка 520 ₴».
 *    Це запрошення до черрі-пікінгу: за відкритої черги (ADR-0009) готівкові
 *    замовлення просто не братимуть, і вони висітимуть, поки клієнт не
 *    скасує. Замість цього показуємо ЗАРОБІТОК кур'єра — макет має рацію,
 *    що це головне число для нього, але воно не мусить розкривати спосіб оплати.
 *
 * 2. НЕ показуємо точну адресу, телефон та ім'я до взяття (B15).
 *    Тільки населений пункт і відстань — цього досить для «беру / не беру».
 *
 * @param {object} order рядок VIEW courier_queue
 * @param {{disabled?: boolean, disabledReason?: string, taken?: boolean, hot?: boolean}} [opts]
 */
export function queueCard(order, opts = {}) {
  const classes = [
    'card',
    opts.hot && 'card--hot',
    opts.taken && 'card--taken',
    opts.disabled && 'card--muted',
  ]
    .filter(Boolean)
    .join(' ');

  return `
    <article class="${classes}" data-card="${esc(order.id)}">
      <div class="row">
        <span class="num tiny">${esc(order.code)}</span>
        ${queueStatus(order)}
      </div>
      <div class="strong" style="margin-top:9px">${esc(order.businessName)}</div>
      <div class="mut" style="margin-top:3px">→ ${esc(order.destLocality)} · <span class="num">${esc(distance(order.distanceKm))}</span></div>
      ${earningsRow(order)}
      <div style="margin-top:12px">${queueAction(order, opts)}</div>
    </article>`;
}

/** Час очікування замість нейтрального «готово» — це сигнал і кур'єру, і адміну. */
function queueStatus(order) {
  if (order.status !== 'ready' || !order.readyAt) return statusChip(order.status);
  const mins = Math.floor((Date.now() - order.readyAt) / 60000);
  if (mins >= 10) return statusChip('failed_delivery', `чекає ${mins} хв`);
  return statusChip('ready', mins < 1 ? 'готово щойно' : `готово ${mins} хв тому`);
}

/**
 * Заробіток кур'єра — головне число дня, тому воно акцентне й найбільше.
 * Сума чека тут не показується взагалі: кур'єру важливо, скільки заробить
 * ВІН, а не скільки коштує замовлення.
 */
function earningsRow(order) {
  const base = order.courierEarnings ?? 0;
  const bonus = order.waitingBonus ?? 0;
  return `<div class="row" style="margin-top:13px">
    <div>
      <span class="mid num accent">+${esc(money(base))}</span>
      ${bonus > 0 ? `<span class="tiny" style="margin-left:6px">із них +${esc(money(bonus))} за очікування</span>` : ''}
    </div>
  </div>`;
}

function queueAction(order, opts) {
  if (order.status !== 'ready') {
    const left = countdown(order.estimatedReadyAt);
    if (!left) return `<div class="tiny">Ось-ось буде готово</div>`;
    return `<div class="row">
        <span class="mut">Буде готово через</span>
        <strong class="num mid" data-countdown="${esc(order.estimatedReadyAt)}">${esc(left)}</strong>
      </div>`;
  }
  if (opts.disabled) {
    return `<button class="btn btn-ghost" disabled>${esc(opts.disabledReason || 'Недоступно')}</button>`;
  }
  return `<button class="btn btn-rocket" data-action="accept" data-id="${esc(order.id)}">Взяти замовлення</button>`;
}

/* ── Стани екрана ───────────────────────────────────────────────────────── */

export function skeletonList(n = 3) {
  return Array.from({ length: n }, () => '<div class="skeleton"></div>').join('');
}

export function emptyState({ icon = 'queue', title, text = '' }) {
  const glyph = typeof icons[icon] === 'function' ? icons[icon](24) : esc(icon);
  return `<div class="empty">
    <div class="empty__icon" style="color:var(--ink-3)">${glyph}</div>
    <div class="empty__title">${esc(title)}</div>
    ${text ? `<p>${esc(text)}</p>` : ''}
  </div>`;
}

/** Помилка завжди каже, що робити. Ніколи не сирий текст бекенду. */
export function errorState(error, retryAction = 'reload') {
  return `<div class="empty">
    <div class="empty__icon" style="color:var(--s-bad)">${icons.offline(24)}</div>
    <div class="empty__title">${esc(error?.message || 'Щось пішло не так')}</div>
    <button class="btn btn-ghost btn-sm" data-action="${esc(retryAction)}"
            style="margin:14px auto 0">Спробувати ще</button>
  </div>`;
}

/* ── Дрібниці ───────────────────────────────────────────────────────────── */

export function row(label, value, opts = {}) {
  const cls = ['num', opts.strong && 'mid', opts.accent && 'accent'].filter(Boolean).join(' ');
  return `<div class="row"><span class="mut">${esc(label)}</span>
    <span class="${cls}">${esc(value)}</span></div>`;
}

export function kpi(value, label, { sub = '', tone = '' } = {}) {
  return `<div class="kpi">
    <div class="kpi__l">${esc(label)}</div>
    <div class="kpi__v num ${tone}">${esc(value)}</div>
    ${sub ? `<div class="kpi__s">${esc(sub)}</div>` : ''}
  </div>`;
}

export function panel(title, sub, body, aside = '') {
  return `<section class="panel">
    <div class="panel__head">
      <div><h3>${esc(title)}</h3>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
      ${aside}
    </div>
    ${body}
  </section>`;
}

export function avatar(fullName, small = false) {
  return `<div class="av ${small ? 'av--sm' : ''}">${esc(initials(fullName))}</div>`;
}

export { esc, money, distance, time, dateTime, elapsed, countdown, icons, initials };
