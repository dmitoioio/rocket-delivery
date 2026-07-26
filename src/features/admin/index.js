/** Адмінка «Бос»: дашборд, курʼєри, готівка, аналітика, зарплата, фото, журнал. */

import * as db from '../../lib/db.js';
import { getState, setState } from '../../lib/store.js';
import { renderTabs } from '../shared/tabs.js';
import { toast } from '../shared/toast.js';
import {
  statusChip,
  statusLabel,
  emptyState,
  errorState,
  skeletonList,
  tile,
  section,
  esc,
  money,
  dateTime,
  elapsed,
} from '../shared/ui.js';

const TABS = [
  { key: 'dashboard', label: 'Дашборд', icon: '🗺' },
  { key: 'couriers', label: 'Курʼєри', icon: '🛵' },
  { key: 'cash', label: 'Готівка', icon: '💵' },
  { key: 'analytics', label: 'Аналітика', icon: '📈' },
  { key: 'payroll', label: 'Зарплата', icon: '🧾' },
  { key: 'photos', label: 'Фото', icon: '📷' },
  { key: 'journal', label: 'Журнал', icon: '📚' },
];

export const tabKeys = TABS.map((t) => t.key);

const TITLES = Object.fromEntries(TABS.map((t) => [t.key, t.label]));

export function title(tab) {
  return TITLES[tab] || 'Адмінка';
}

export function tabsBar(state, tab) {
  const pending = state.admin?.handoffs.filter((h) => h.status === 'declared').length || 0;
  const withBadge = TABS.map((t) => (t.key === 'cash' && pending ? { ...t, badge: pending } : t));
  return renderTabs(withBadge, tab);
}

export async function load() {
  setState({ status: 'loading', error: null });
  try {
    setState({ admin: await db.fetchAdminOverview(), status: 'ready' });
  } catch (error) {
    setState({ status: 'error', error });
  }
}

export function renderTab(state, tab) {
  if (!state.admin) {
    return state.status === 'error' ? errorState(state.error, 'reload') : skeletonList(3);
  }
  const a = state.admin;

  switch (tab) {
    case 'couriers':
      return couriers(a);
    case 'cash':
      return cash(a);
    case 'analytics':
      return analytics(a);
    case 'payroll':
      return payroll(a);
    case 'photos':
      return photos(a);
    case 'journal':
      return journal(a);
    default:
      return dashboard(a);
  }
}

/* ── Дашборд ────────────────────────────────────────────────────────────── */

function dashboard(a) {
  const { stats } = a;
  // «Курʼєрів онлайн: 0» при активних замовленнях — аварійний стан (B36)
  const alarm = stats.online === 0 && stats.active > 0;

  const activeOrders = a.orders.filter((o) =>
    ['ready', 'courier_assigned', 'picked_up', 'on_the_way'].includes(o.status)
  );

  return `
    <div class="tiles">
      ${tile(stats.active, 'Активних')}
      ${tile(stats.stale, 'Висять > 15 хв', stats.stale > 0)}
      ${tile(stats.online, 'Курʼєрів онлайн', alarm)}
      ${tile(stats.refunds, 'Чекають рефанду', stats.refunds > 0)}
    </div>

    ${
      alarm
        ? `<div class="notice notice--danger">Жоден курʼєр не онлайн, а замовлення чекають.
             Ніхто не зобовʼязаний виходити на зміну — потрібне ручне втручання.</div>`
        : ''
    }

    <div class="map map--lg" id="admin-map"><div class="map__placeholder">Карта замовлень</div></div>

    ${section(
      'Активні замовлення',
      activeOrders.length
        ? activeOrders.map(orderRow).join('')
        : emptyState({ icon: '✅', title: 'Активних замовлень немає' })
    )}`;
}

function orderRow(o) {
  const waiting =
    o.status === 'ready' && o.readyAt
      ? `<span class="bonus">чекає ${esc(elapsed(o.readyAt))}</span>`
      : '';
  return `<article class="card" data-action="open-order" data-id="${esc(o.id)}">
    <div class="card__top">
      <span class="card__code">${esc(o.code)}</span>${statusChip(o.status)}
    </div>
    <div class="card__row" style="margin-bottom:0">
      <span>${esc(o.destLocality)}</span>
      <span class="mono">${esc(money(o.total))}</span>
    </div>
    ${waiting}
  </article>`;
}

/* ── Курʼєри ────────────────────────────────────────────────────────────── */

function couriers(a) {
  return `
    <button class="btn btn--primary" data-action="open-create-courier" style="margin-bottom:16px">
      + СТВОРИТИ КУРʼЄРА
    </button>
    ${a.couriers
      .map(
        (c) => `<article class="card">
      <div class="card__top">
        <span class="card__code">${esc(c.fullName)}</span>
        <span class="chip ${c.status === 'online' ? 'chip--ready' : 'chip--cancelled'}">
          <span class="chip__dot"></span>${c.status === 'online' ? 'онлайн' : 'офлайн'}</span>
      </div>
      <div class="card__biz mono">${esc(c.login)}</div>
      <div class="line"><span class="line__label">Доставок</span>
        <span class="mono">${esc(c.completedDeliveries)}</span></div>
      <div class="line"><span class="line__label">Готівка на руках</span>
        <span class="mono">${esc(money(c.cashOnHand))}</span></div>
      <button class="btn btn--secondary btn--sm" data-action="toggle-courier"
              data-id="${esc(c.id)}" data-active="${c.isActive}" style="margin-top:12px">
        ${c.isActive ? 'Деактивувати' : 'Активувати'}
      </button>
    </article>`
      )
      .join('')}`;
}

/* ── Готівка ────────────────────────────────────────────────────────────── */

function cash(a) {
  const pending = a.handoffs.filter((h) => h.status === 'declared');
  const done = a.handoffs.filter((h) => h.status !== 'declared');
  const nameOf = (id) => a.couriers.find((c) => c.id === id)?.fullName || id;

  return `
    ${section(
      'Чекають підтвердження',
      pending.length
        ? pending
            .map(
              (h) => `<article class="card">
        <div class="card__top">
          <span class="card__code">${esc(nameOf(h.courierId))}</span>
          <span class="card__total mono">${esc(money(h.declaredAmount))}</span>
        </div>
        <div class="hint">Заявлено ${esc(dateTime(h.declaredAt))}</div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="amt-${esc(h.id)}">Скільки прийнято фактично</label>
          <input class="input mono" id="amt-${esc(h.id)}" inputmode="numeric"
                 value="${esc(h.declaredAmount)}">
        </div>
        <button class="btn btn--primary" data-action="confirm-handoff" data-id="${esc(h.id)}">
          ПІДТВЕРДИТИ
        </button>
      </article>`
            )
            .join('')
        : emptyState({ icon: '✅', title: 'Немає заявок на підтвердження' })
    )}

    ${section(
      'Історія здач',
      done.length
        ? done
            .map((h) => {
              const diff = (h.confirmedAmount ?? 0) - h.declaredAmount;
              return `<article class="card ${h.status === 'disputed' ? '' : ''}">
          <div class="card__top">
            <span>${esc(nameOf(h.courierId))}</span>
            ${
              h.status === 'disputed'
                ? `<span class="chip chip--cash"><span class="chip__dot"></span>розбіжність</span>`
                : `<span class="chip chip--done"><span class="chip__dot"></span>підтверджено</span>`
            }
          </div>
          <div class="line"><span class="line__label">Заявлено</span>
            <span class="mono">${esc(money(h.declaredAmount))}</span></div>
          <div class="line"><span class="line__label">Прийнято</span>
            <span class="mono">${esc(money(h.confirmedAmount ?? 0))}</span></div>
          ${
            diff !== 0
              ? `<div class="notice notice--danger" style="margin:12px 0 0">
                   Різниця ${esc(money(diff))} — зафіксований борг</div>`
              : ''
          }
        </article>`;
            })
            .join('')
        : emptyState({ icon: '🗂', title: 'Історія порожня' })
    )}`;
}

/* ── Аналітика ──────────────────────────────────────────────────────────── */

function analytics(a) {
  const delivered = a.orders.filter((o) => o.status === 'delivered');
  const revenue = delivered.reduce((s, o) => s + o.total, 0);
  const avg = delivered.length ? Math.round(revenue / delivered.length) : 0;

  // Головна метрика черрі-пікінгу: скільки замовлення чекало курʼєра (B35)
  const waits = a.orders
    .filter((o) => o.readyAt && o.courierAssignedAt)
    .map((o) => (o.courierAssignedAt - o.readyAt) / 60000);
  const avgWait = waits.length ? (waits.reduce((s, w) => s + w, 0) / waits.length).toFixed(1) : '—';

  // Точність прогнозу закладу (B9)
  const accuracy = a.orders
    .filter((o) => o.readyAt && o.estimatedReadyAt)
    .map((o) => Math.abs(o.readyAt - o.estimatedReadyAt) / 60000);
  const avgAccuracy = accuracy.length
    ? (accuracy.reduce((s, x) => s + x, 0) / accuracy.length).toFixed(1)
    : '—';

  return `
    <div class="tiles">
      ${tile(delivered.length, 'Доставлено')}
      ${tile(money(revenue), 'Оборот')}
      ${tile(money(avg), 'Середній чек')}
      ${tile(`${avgWait} хв`, 'Час до взяття')}
      ${tile(`±${avgAccuracy} хв`, 'Точність закладу')}
    </div>
    <div class="notice">
      «Час до взяття» — головний показник черрі-пікінгу. Якщо він росте по
      конкретних напрямках, туди перестали їздити.
    </div>`;
}

/* ── Зарплата ───────────────────────────────────────────────────────────── */

function payroll(a) {
  const byCourier = new Map();
  for (const e of a.earnings) {
    const cur = byCourier.get(e.courierId) || { count: 0, amount: 0 };
    byCourier.set(e.courierId, { count: cur.count + 1, amount: cur.amount + e.amount });
  }

  if (!byCourier.size) return emptyState({ icon: '🧾', title: 'Нарахувань поки немає' });

  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>Курʼєр</th><th>Доставок</th><th>До виплати</th></tr></thead>
    <tbody>${[...byCourier.entries()]
      .map(([id, v]) => {
        const c = a.couriers.find((x) => x.id === id);
        return `<tr><td>${esc(c?.fullName || id)}</td>
          <td class="mono">${esc(v.count)}</td>
          <td class="mono">${esc(money(v.amount))}</td></tr>`;
      })
      .join('')}</tbody>
  </table></div>
  <div class="notice" style="margin-top:16px">
    Ставка фіксується на момент доставки, не читається з поточного конфіга —
    зміна тарифу не перераховує історію.
  </div>`;
}

/* ── Фото ───────────────────────────────────────────────────────────────── */

function photos(a) {
  const withPhoto = a.orders.filter((o) => o.proofPhotoPath);
  if (!withPhoto.length) return emptyState({ icon: '📷', title: 'Фото поки немає' });

  return `
    <div class="notice">Фото зберігаються 90 днів, потім видаляються автоматично.
      Це персональні дані — доступ лише адміну й закладу-власнику.</div>
    ${withPhoto
      .map(
        (o) => `<article class="card">
      <div class="card__top">
        <span class="card__code">${esc(o.code)}</span>${statusChip(o.status)}
      </div>
      <div class="hint">${esc(dateTime(o.deliveredAt))}</div>
      ${o.pinBypassed ? `<div class="notice notice--warn" style="margin-top:12px">PIN не підтверджено — курʼєр скористався обходом</div>` : ''}
    </article>`
      )
      .join('')}`;
}

/* ── Журнал ─────────────────────────────────────────────────────────────── */

function journal(a) {
  if (!a.events.length) return emptyState({ icon: '📚', title: 'Журнал порожній' });

  const codeOf = (id) => a.orders.find((o) => o.id === id)?.code || id;

  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>Час</th><th>Замовлення</th><th>Перехід</th><th>Хто</th></tr></thead>
    <tbody>${[...a.events]
      .reverse()
      .map(
        (e) => `<tr data-action="open-order" data-id="${esc(e.orderId)}">
        <td class="mono">${esc(dateTime(e.createdAt))}</td>
        <td class="mono">${esc(codeOf(e.orderId))}</td>
        <td>${esc(statusLabel(e.fromStatus))} → ${esc(statusLabel(e.toStatus))}</td>
        <td>${esc(e.actorRole)}</td>
      </tr>`
      )
      .join('')}</tbody>
  </table></div>
  <div class="notice" style="margin-top:16px">
    Журнал append-only: рядки не редагуються й не видаляються ніким, включно з адміном.
  </div>`;
}

/* ── Шторки ─────────────────────────────────────────────────────────────── */

export function renderOverlay(state) {
  const sheet = state.sheet;
  if (!sheet) return '';

  if (sheet.type === 'create-courier') return createCourierSheet(sheet);
  if (sheet.type === 'order') return orderSheet(state, sheet.orderId);
  return '';
}

function createCourierSheet(sheet) {
  if (sheet.result) {
    return `<div class="sheet-backdrop" data-action="close-sheet">
      <div class="sheet" data-stop role="dialog" aria-modal="true">
        <h2 class="sheet__title">Курʼєра створено</h2>
        <div class="card">
          <div class="line"><span class="line__label">Логін</span>
            <strong class="mono">${esc(sheet.result.login)}</strong></div>
          <div class="line"><span class="line__label">Пароль</span>
            <strong class="mono">${esc(sheet.result.password)}</strong></div>
        </div>
        <div class="notice notice--warn">
          Пароль показується один раз — саме так система й працює.
          Ніде у відкритому вигляді він не зберігається. Передай його зараз.
        </div>
        <button class="btn btn--primary" data-action="close-sheet">ГОТОВО</button>
      </div></div>`;
  }

  return `<div class="sheet-backdrop" data-action="close-sheet">
    <div class="sheet" data-stop role="dialog" aria-modal="true">
      <h2 class="sheet__title">Новий курʼєр</h2>
      <div class="field">
        <label class="field__label" for="nc-name">Імʼя та прізвище</label>
        <input class="input" id="nc-name" autocomplete="off">
      </div>
      <div class="field">
        <label class="field__label" for="nc-phone">Телефон</label>
        <input class="input" id="nc-phone" inputmode="tel" autocomplete="off">
      </div>
      <button class="btn btn--primary" data-action="create-courier">СТВОРИТИ</button>
      <button class="btn btn--ghost" data-action="close-sheet" style="margin-top:8px">Назад</button>
    </div></div>`;
}

function orderSheet(state, orderId) {
  const o = state.admin?.orders.find((x) => x.id === orderId);
  if (!o) return '';
  const courier = state.admin.couriers.find((c) => c.id === o.courierId);

  return `<div class="sheet-backdrop" data-action="close-sheet">
    <div class="sheet" data-stop role="dialog" aria-modal="true">
      <h2 class="sheet__title">${esc(o.code)}</h2>
      ${statusChip(o.status)}
      <div class="card" style="margin-top:16px">
        <div class="line"><span class="line__label">Адреса</span><span>${esc(o.destAddressText)}</span></div>
        <div class="line"><span class="line__label">Орієнтир</span><span>${esc(o.destLandmark || '—')}</span></div>
        <div class="line"><span class="line__label">Клієнт</span><span>${esc(o.clientName)}</span></div>
        <div class="line"><span class="line__label">Оплата</span>
          <span>${o.paymentMethod === 'cash' ? 'готівка' : 'онлайн'}</span></div>
        <div class="line"><span class="line__label">Сума</span>
          <span class="mono">${esc(money(o.total))}</span></div>
        <div class="line"><span class="line__label">Курʼєр</span>
          <span>${esc(courier?.fullName || '—')}</span></div>
        ${
          o.paymentStatus === 'refund_needed'
            ? `<div class="notice notice--danger" style="margin-top:12px">
                 Потрібен рефанд — гроші клієнта досі не повернуті</div>`
            : ''
        }
      </div>
      <button class="btn btn--secondary" data-action="close-sheet">Закрити</button>
    </div></div>`;
}

/* ── Дії ────────────────────────────────────────────────────────────────── */

export async function handle(action, el) {
  switch (action) {
    case 'open-create-courier':
      setState({ sheet: { type: 'create-courier' } });
      return true;

    case 'create-courier': {
      const fullName = document.getElementById('nc-name')?.value || '';
      const phone = document.getElementById('nc-phone')?.value || '';
      try {
        const result = await db.createCourier({ fullName, phone });
        setState({ sheet: { type: 'create-courier', result } });
        await load();
      } catch (error) {
        toast(error.message, 'danger');
      }
      return true;
    }

    case 'toggle-courier':
      try {
        await db.setCourierActive(el.dataset.id, el.dataset.active !== 'true');
        await load();
      } catch (error) {
        toast(error.message, 'danger');
      }
      return true;

    case 'confirm-handoff': {
      const id = el.dataset.id;
      const amount = Number(document.getElementById(`amt-${id}`)?.value);
      if (!Number.isFinite(amount)) return (toast('Вкажи суму', 'danger'), true);
      try {
        const h = await db.confirmHandoff(id, amount);
        toast(
          h.status === 'disputed' ? 'Зафіксовано розбіжність' : 'Здачу підтверджено',
          h.status === 'disputed' ? 'danger' : 'ok'
        );
        await load();
      } catch (error) {
        toast(error.message, 'danger');
      }
      return true;
    }

    case 'open-order':
      setState({ sheet: { type: 'order', orderId: el.dataset.id } });
      return true;

    default:
      return false;
  }
}

export { getState };
