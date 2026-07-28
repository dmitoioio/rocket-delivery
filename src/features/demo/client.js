/**
 * Поверхня клієнта — СИМУЛЯЦІЯ cstllife у демо.
 *
 * ⚠️ Не потрапляє у продакшн-збірку. За ADR-0001 чекаут і сторінка
 * замовлення живуть на боці cstllife.
 *
 * Тут вона існує з однієї конкретної причини: **код підтвердження було
 * нікому показати**. Курʼєр його не знає й знати не може (B41), сервер
 * його не віддає — а поверхні, де клієнт свій код бачить, не існувало.
 * Без неї верифікація отримувача була недоробленою з обох боків.
 */

import * as adapter from '#adapter';
import { getState, setState } from '../../lib/store.js';
import { renderTabs } from '../shared/tabs.js';
import { toast } from '../shared/toast.js';
import { icons } from '../shared/icons.js';
import { statusChip, emptyState, skeletonList, esc, money, time, dateTime } from '../shared/ui.js';

/** Один «браузер клієнта» на демо — цього досить, щоб пройти ланцюжок. */
const CLIENT_KEY = 'demo-client';

const TABS = [
  { key: 'order', label: 'Замовити', icon: icons.cash },
  { key: 'mine', label: 'Мої замовлення', icon: icons.history },
];

export const tabKeys = TABS.map((t) => t.key);

export function title(tab) {
  return tab === 'mine' ? 'Мої замовлення' : 'Суші Мар';
}

export function subtitle() {
  return 'симуляція cstllife';
}

export function tabsBar(state, tab) {
  const active = state.client?.orders.filter(
    (o) => !['delivered', 'failed_delivery', 'rejected_by_business'].includes(o.status)
  ).length;
  return renderTabs(
    TABS.map((t) => (t.key === 'mine' && active ? { ...t, badge: active } : t)),
    tab
  );
}

export async function load() {
  setState({ status: 'loading', error: null });
  try {
    setState({ client: { orders: await adapter.fetchClientOrders(CLIENT_KEY) }, status: 'ready' });
  } catch (error) {
    setState({ status: 'error', error });
  }
}

export function renderTab(state, tab) {
  if (!state.client) return skeletonList(2);
  return tab === 'mine' ? myOrders(state.client.orders) : checkout(state);
}

/* ── Чекаут ─────────────────────────────────────────────────────────────── */

const MENU = [
  { name: 'Філадельфія', price: 320 },
  { name: 'Каліфорнія', price: 280 },
  { name: 'Сет «Дракон»', price: 640 },
  { name: 'Темпура рол', price: 210 },
];

function checkout(state) {
  const picked = state.clientCart || {};
  const total = MENU.reduce((s, item) => s + (picked[item.name] || 0) * item.price, 0);

  return `
    <div class="card">
      <div class="strong">Суші Мар</div>
      <div class="tiny">с. Дідичі · доставка ${esc(money(adapter.config.deliveryFee))}</div>
    </div>

    <div class="h-sec">Меню</div>
    ${MENU.map(
      (item) => `<div class="card">
      <div class="row">
        <div>
          <div class="strong">${esc(item.name)}</div>
          <div class="tiny num">${esc(money(item.price))}</div>
        </div>
        <div class="row" style="gap:8px">
          <button class="btn btn-ghost btn-sm" data-action="cart-less" data-name="${esc(item.name)}">−</button>
          <span class="num" style="min-width:20px;text-align:center">${esc(picked[item.name] || 0)}</span>
          <button class="btn btn-ghost btn-sm" data-action="cart-more" data-name="${esc(item.name)}">+</button>
        </div>
      </div>
    </div>`
    ).join('')}

    <div class="h-sec">Куди везти</div>
    <div class="card">
      <div class="field" style="margin-bottom:0">
        <select class="input" id="dest-select">
          ${adapter.DEMO_DESTINATIONS.map(
            (d) =>
              `<option value="${esc(d.locality)}">${esc(d.locality)}, ${esc(d.address)}</option>`
          ).join('')}
        </select>
      </div>
      <div class="tiny" style="margin-top:8px">
        Луцьк у списку навмисно: він за межами радіуса, і замовлення туди
        не створиться. Правило видно в дії, а не лише в коді.
      </div>
    </div>

    <div class="h-sec">Оплата</div>
    <div class="seg" id="pay-seg">
      <button data-action="pay-method" data-value="cash"
        aria-selected="${(state.clientPay || 'cash') === 'cash'}">Готівкою курʼєру</button>
      <button data-action="pay-method" data-value="online"
        aria-selected="${state.clientPay === 'online'}">Карткою онлайн</button>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="row"><span class="mut">Товар</span><span class="num">${esc(money(total))}</span></div>
      <div class="row"><span class="mut">Доставка</span>
        <span class="num">${esc(money(adapter.config.deliveryFee))}</span></div>
      <div class="row" style="border-top:1px solid var(--line);padding-top:9px;margin-top:9px">
        <strong>Разом</strong>
        <strong class="mid num">${esc(money(total + adapter.config.deliveryFee))}</strong>
      </div>
    </div>

    <button class="btn btn-cstl" data-action="place-order" style="margin-top:16px"
            ${total ? '' : 'disabled'}>
      ${total ? 'Замовити' : 'Обери щось із меню'}
    </button>`;
}

/* ── Мої замовлення ─────────────────────────────────────────────────────── */

const STEPS = [
  { key: 'placed', label: 'Оформлено' },
  { key: 'preparing', label: 'Готується' },
  { key: 'ready', label: 'Готово' },
  { key: 'on_the_way', label: 'В дорозі' },
  { key: 'delivered', label: 'Доставлено' },
];

function myOrders(orders) {
  if (!orders.length) {
    return emptyState({
      icon: 'history',
      title: 'Замовлень ще немає',
      text: 'Оформи замовлення — тут зʼявиться його статус і код підтвердження.',
    });
  }
  return orders.map(orderCard).join('');
}

function orderCard(o) {
  const done = ['delivered', 'failed_delivery', 'rejected_by_business'].includes(o.status);
  const idx = stepIndex(o.status);

  return `<article class="card">
    <div class="row">
      <span class="num tiny">${esc(o.code)}</span>
      ${statusChip(o.status)}
    </div>
    <div class="strong" style="margin-top:9px">${esc(money(o.total))} · ${esc(o.destLocality)}</div>
    <div class="tiny">${esc(dateTime(o.placedAt))}</div>

    ${done ? '' : tracker(idx)}
    ${o.estimatedReadyAt && !o.readyAt ? `<div class="tiny" style="margin-top:8px">Буде готово о ${esc(time(o.estimatedReadyAt))}</div>` : ''}

    ${pinBlock(o)}
    ${
      o.paymentStatus === 'refund_needed'
        ? `<div class="callout callout--warn" style="margin-top:12px">
             Замовлення скасоване, а оплата була онлайн. Гроші мають повернутись —
             процес поки ручний, це відкрите питання Q6.
           </div>`
        : ''
    }
  </article>`;
}

function stepIndex(status) {
  if (status === 'delivered') return 4;
  if (['on_the_way', 'picked_up', 'courier_assigned'].includes(status)) return 3;
  if (status === 'ready') return 2;
  if (['preparing', 'accepted_by_business'].includes(status)) return 1;
  return 0;
}

function tracker(idx) {
  return `<div class="hstep" style="margin-top:14px">
      ${STEPS.map((_, i) => `<div class="${i <= idx ? 'on' : ''}"></div>`).join('')}
    </div>
    <div class="hstep-lbl">
      ${STEPS.map((s, i) => `<span class="${i === idx ? 'on' : ''}">${esc(s.label)}</span>`).join('')}
    </div>`;
}

/**
 * Код підтвердження — те, заради чого ця поверхня й існує.
 * Показується, поки замовлення в дорозі: курʼєр попросить його назвати.
 */
function pinBlock(o) {
  if (!o.deliveryPin) return '';
  if (['delivered', 'failed_delivery', 'rejected_by_business'].includes(o.status)) return '';

  return `<div class="card card--hot" style="margin-top:14px;text-align:center">
    <div class="lbl">Код для курʼєра</div>
    <div class="huge num" style="letter-spacing:.15em;margin:4px 0">${esc(o.deliveryPin)}</div>
    <div class="tiny">Назви ці цифри, коли курʼєр передаватиме замовлення</div>
  </div>`;
}

/* ── Дії ────────────────────────────────────────────────────────────────── */

export async function handle(action, el) {
  const state = getState();
  const cart = { ...(state.clientCart || {}) };

  switch (action) {
    case 'cart-more':
      cart[el.dataset.name] = (cart[el.dataset.name] || 0) + 1;
      setState({ clientCart: cart });
      return true;

    case 'cart-less':
      cart[el.dataset.name] = Math.max(0, (cart[el.dataset.name] || 0) - 1);
      setState({ clientCart: cart });
      return true;

    case 'pay-method':
      setState({ clientPay: el.dataset.value });
      return true;

    case 'place-order': {
      const itemsTotal = MENU.reduce((s, i) => s + (cart[i.name] || 0) * i.price, 0);
      const destination = document.getElementById('dest-select')?.value;
      try {
        const order = await adapter.createOrder({
          destination,
          itemsTotal,
          paymentMethod: state.clientPay || 'cash',
          clientKey: CLIENT_KEY,
        });
        setState({ clientCart: {}, route: 'client/mine' });
        toast(`Замовлення ${order.code} оформлено`, 'ok', 3200);
        await load();
      } catch (error) {
        toast(error.message, 'danger', 4000);
      }
      return true;
    }

    default:
      return false;
  }
}

export function renderOverlay() {
  return '';
}

export { getState };
