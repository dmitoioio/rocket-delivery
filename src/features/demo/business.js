/**
 * Поверхня закладу — СИМУЛЯЦІЯ cstllife у демо.
 *
 * ⚠️ Не потрапляє у продакшн-збірку. За ADR-0001 кабінет закладу живе
 * на боці cstllife, не в Rocket Delivery. Тут він існує лише щоб
 * ланцюжок можна було пройти цілком: без цієї поверхні готовність
 * замовлення — фікція на таймері, і курʼєр приїздить до неготової кухні.
 */

import * as adapter from '#adapter';
import { getState, setState } from '../../lib/store.js';
import { renderTabs } from '../shared/tabs.js';
import { toast } from '../shared/toast.js';
import { icons } from '../shared/icons.js';
import { statusChip, emptyState, skeletonList, panel, esc, money, elapsed } from '../shared/ui.js';

const TABS = [
  { key: 'kitchen', label: 'Кухня', icon: icons.queue },
  { key: 'cash', label: 'Готівка', icon: icons.cash },
];

export const tabKeys = TABS.map((t) => t.key);

export function title(tab) {
  return tab === 'cash' ? 'Здача готівки' : 'Кухня';
}

export function subtitle(state) {
  const n = state.business?.orders.filter((o) =>
    ['placed', 'accepted_by_business', 'preparing'].includes(o.status)
  ).length;
  return n ? `${n} у роботі` : 'Суші Мар · симуляція cstllife';
}

export function tabsBar(state, tab) {
  const pending = state.business?.orders.filter((o) => o.status === 'placed').length || 0;
  const cash = state.business?.handoffs.filter((h) => h.status === 'declared').length || 0;
  return renderTabs(
    TABS.map((t) =>
      t.key === 'kitchen' && pending
        ? { ...t, badge: pending }
        : t.key === 'cash' && cash
          ? { ...t, badge: cash }
          : t
    ),
    tab
  );
}

export async function load() {
  setState({ status: 'loading', error: null });
  try {
    const overview = await adapter.fetchAdminOverview();
    setState({
      business: {
        orders: overview.orders,
        handoffs: overview.handoffs,
        couriers: overview.couriers,
      },
      status: 'ready',
    });
  } catch (error) {
    setState({ status: 'error', error });
  }
}

export function renderTab(state, tab) {
  if (!state.business) return skeletonList(2);
  return tab === 'cash' ? cashScreen(state.business) : kitchen(state.business);
}

/* ── Кухня ──────────────────────────────────────────────────────────────── */

function kitchen(b) {
  const nnew = b.orders.filter((o) => o.status === 'placed');
  const cooking = b.orders.filter((o) => ['accepted_by_business', 'preparing'].includes(o.status));
  const ready = b.orders.filter((o) => o.status === 'ready' && !o.courierId);
  const taken = b.orders.filter((o) =>
    ['courier_assigned', 'picked_up', 'on_the_way'].includes(o.status)
  );

  if (!nnew.length && !cooking.length && !ready.length && !taken.length) {
    return emptyState({
      icon: 'clock',
      title: 'Замовлень немає',
      text: 'Оформи замовлення з поверхні клієнта — воно зʼявиться тут.',
    });
  }

  return [
    nnew.length
      ? `<div class="h-sec">Нові · ${nnew.length}</div>` + nnew.map(newCard).join('')
      : '',
    cooking.length
      ? `<div class="h-sec">Готуються · ${cooking.length}</div>` + cooking.map(cookingCard).join('')
      : '',
    ready.length
      ? `<div class="h-sec">Готові, чекають курʼєра · ${ready.length}</div>` +
        ready.map(readyCard).join('')
      : '',
    taken.length
      ? `<div class="h-sec">У курʼєра · ${taken.length}</div>` +
        taken.map((o) => takenCard(o, b)).join('')
      : '',
  ].join('');
}

function head(o) {
  return `<div class="row">
    <span class="num tiny">${esc(o.code)}</span>
    ${statusChip(o.status)}
  </div>
  <div class="strong" style="margin-top:9px">${esc(o.destLocality)} · ${esc(money(o.total))}</div>
  <div class="tiny">${esc(o.paymentMethod === 'cash' ? 'готівка' : 'оплачено онлайн')}</div>`;
}

/**
 * Заклад підтверджує і САМ ставить час готовності. Саме звідси
 * рахується все інше — і саме цього не було в прототипі.
 */
function newCard(o) {
  return `<article class="card card--hot">
    ${head(o)}
    <div class="h-sec" style="margin:14px 0 8px">Буде готово через</div>
    <div class="row" style="gap:8px">
      ${[10, 20, 30, 45]
        .map(
          (m) => `<button class="btn btn-ghost btn-sm" style="flex:1"
            data-action="accept-order" data-id="${esc(o.id)}" data-mins="${m}">${m} хв</button>`
        )
        .join('')}
    </div>
    <button class="btn btn-danger" data-action="reject-order" data-id="${esc(o.id)}"
            style="margin-top:10px">Не можемо виконати</button>
  </article>`;
}

function cookingCard(o) {
  const left = o.estimatedReadyAt ? Math.round((o.estimatedReadyAt - Date.now()) / 60000) : null;
  return `<article class="card">
    ${head(o)}
    <div class="row" style="margin-top:12px">
      <span class="mut">${left > 0 ? `Лишилось ${left} хв` : 'Час вийшов'}</span>
    </div>
    <button class="btn btn-rocket" data-action="mark-ready" data-id="${esc(o.id)}"
            style="margin-top:10px">Готово до забору</button>
  </article>`;
}

function readyCard(o) {
  const waiting = o.readyAt ? elapsed(o.readyAt) : '';
  return `<article class="card">
    ${head(o)}
    <div class="tiny" style="margin-top:10px">Чекає курʼєра ${esc(waiting)}</div>
    ${
      o.watchdog?.includes('unclaimed')
        ? `<div class="callout callout--warn" style="margin-top:10px">
             Ніхто не взяв понад 15 хвилин. Адмін це бачить.
           </div>`
        : ''
    }
  </article>`;
}

function takenCard(o, b) {
  const courier = b.couriers.find((c) => c.id === o.courierId);
  return `<article class="card">
    ${head(o)}
    <div class="row" style="margin-top:10px">
      <span class="mut">Курʼєр</span><span>${esc(courier?.fullName || '—')}</span>
    </div>
  </article>`;
}

/* ── Готівка: другий бік двостороннього підтвердження ───────────────────── */

function cashScreen(b) {
  const pending = b.handoffs.filter((h) => h.status === 'declared');
  const done = b.handoffs.filter((h) => h.status !== 'declared');
  const nameOf = (id) => b.couriers.find((c) => c.id === id)?.fullName || id;

  return (
    panel(
      'Курʼєри здають готівку',
      pending.length ? `${pending.length} на підтвердження` : 'Нових заявок немає',
      pending.length
        ? `<div class="panel__body">${pending
            .map(
              (h) => `<div class="card" style="margin-bottom:12px">
        <div class="row">
          <strong>${esc(nameOf(h.courierId))}</strong>
          <span class="mid num">${esc(money(h.declaredAmount))}</span>
        </div>
        <div class="tiny" style="margin-top:4px">
          за ${esc(h.orderIds?.length || 0)} замовлень${
            h.expectedAmount ? ` · за нашими даними ${esc(money(h.expectedAmount))}` : ''
          }
        </div>
        <div class="field" style="margin:12px 0 0">
          <label class="field__label" for="bz-${esc(h.id)}">Скільки прийняли фактично</label>
          <input class="input num" id="bz-${esc(h.id)}" inputmode="numeric"
                 value="${esc(h.declaredAmount)}">
        </div>
        <button class="btn btn-dark" data-action="confirm-cash" data-id="${esc(h.id)}"
                style="margin-top:12px">Підтвердити</button>
      </div>`
            )
            .join('')}</div>`
        : `<div class="panel__body">${emptyState({ icon: 'check', title: 'Усе звірено' })}</div>`
    ) +
    (done.length
      ? panel(
          'Історія',
          `${done.length} здач`,
          `<div class="panel__body">${done
            .map(
              (h) => `<div class="card">
          <div class="row">
            <span>${esc(nameOf(h.courierId))}</span>
            ${
              h.status === 'disputed'
                ? statusChip('failed_delivery', `розбіжність ${money(h.discrepancy || 0)}`)
                : statusChip('delivered', 'звірено')
            }
          </div>
          <div class="tiny" style="margin-top:4px">
            заявлено ${esc(money(h.declaredAmount))} · прийнято ${esc(money(h.confirmedAmount ?? 0))}
          </div>
        </div>`
            )
            .join('')}</div>`
        )
      : '')
  );
}

/* ── Дії ────────────────────────────────────────────────────────────────── */

export async function handle(action, el) {
  switch (action) {
    case 'accept-order':
      try {
        await adapter.businessAcceptOrder(el.dataset.id, Number(el.dataset.mins));
        toast(`Прийнято, готово через ${el.dataset.mins} хв`, 'ok');
        await load();
      } catch (error) {
        toast(error.message, 'danger');
      }
      return true;

    case 'mark-ready':
      try {
        await adapter.businessMarkReady(el.dataset.id);
        toast('Замовлення в черзі курʼєрів', 'ok');
        await load();
      } catch (error) {
        toast(error.message, 'danger');
      }
      return true;

    case 'reject-order':
      try {
        await adapter.businessRejectOrder(el.dataset.id, 'out_of_stock');
        toast('Відхилено. Клієнту потрібен рефанд, якщо оплата була онлайн', 'danger', 3600);
        await load();
      } catch (error) {
        toast(error.message, 'danger');
      }
      return true;

    case 'confirm-cash': {
      const id = el.dataset.id;
      const amount = Number(document.getElementById(`bz-${id}`)?.value);
      if (!Number.isFinite(amount)) {
        toast('Вкажи суму', 'danger');
        return true;
      }
      try {
        const h = await adapter.confirmHandoff(id, amount);
        toast(
          h.status === 'disputed' ? 'Зафіксовано розбіжність' : 'Підтверджено',
          h.status === 'disputed' ? 'danger' : 'ok'
        );
        await load();
      } catch (error) {
        toast(error.message, 'danger');
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
