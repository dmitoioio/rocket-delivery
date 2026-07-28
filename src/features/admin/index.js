/**
 * Адмінка «Бос».
 *
 * Головне, що тут має бути видно: маржа платформи, середній час доставки
 * і непідтверджена готівка. Без цих трьох чисел адмінка гарна, але не
 * відповідає на питання «чи ми заробляємо і чи не псується сервіс».
 */

import * as db from '../../lib/db.js';
import { getState, setState } from '../../lib/store.js';
import { renderTabs } from '../shared/tabs.js';
import { toast } from '../shared/toast.js';
import { icons } from '../shared/icons.js';
import {
  statusChip,
  statusLabel,
  emptyState,
  errorState,
  skeletonList,
  kpi,
  panel,
  avatar,
  esc,
  money,
  dateTime,
  elapsed,
} from '../shared/ui.js';
import { geoMap } from '../shared/map.js';

const TABS = [
  { key: 'dashboard', label: 'Дашборд', icon: icons.dashboard },
  { key: 'attention', label: 'Увага', icon: icons.active },
  { key: 'cash', label: 'Готівка', icon: icons.cash },
  { key: 'economy', label: 'Економіка', icon: icons.chart },
  { key: 'couriers', label: 'Курʼєри', icon: icons.couriers },
  { key: 'photos', label: 'Фото', icon: icons.photo },
  { key: 'journal', label: 'Журнал', icon: icons.journal },
];

export const tabKeys = TABS.map((t) => t.key);
const TITLES = Object.fromEntries(TABS.map((t) => [t.key, t.label]));

export function title(tab) {
  return TITLES[tab] || 'Адмінка';
}

export function subtitle(state) {
  const s = state.admin?.stats;
  return s ? `${s.online} ${s.online === 1 ? 'курʼєр' : 'курʼєрів'} на лінії` : '';
}

export function tabsBar(state, tab) {
  const a = state.admin;
  const pendingCash = a?.handoffs.filter((h) => h.status === 'declared').length || 0;
  const attention = a ? (a.stats.stale || 0) + (a.stats.failed || 0) + (a.stats.refunds || 0) : 0;

  const withBadge = TABS.map((t) => {
    if (t.key === 'cash' && pendingCash) return { ...t, badge: pendingCash };
    if (t.key === 'attention' && attention) return { ...t, badge: attention };
    return t;
  });
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
    case 'attention':
      return attention(a);
    case 'cash':
      return cash(a);
    case 'economy':
      return economy(a);
    case 'couriers':
      return couriers(a);
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
  const s = a.stats;
  // Жоден курʼєр не онлайн при активних замовленнях — аварійний стан:
  // за Glovo-моделі ніхто не зобовʼязаний виходити на зміну (B36)
  const alarm = s.online === 0 && s.active > 0;

  const active = a.orders.filter((o) =>
    ['ready', 'courier_assigned', 'picked_up', 'on_the_way'].includes(o.status)
  );

  return `
    ${panel(
      'Дашборд дня',
      new Date().toLocaleDateString('uk-UA', { weekday: 'long', day: '2-digit', month: '2-digit' }),
      `<div class="kpis">
        ${kpi(s.delivered, 'Доставлено', { sub: `з ${s.total} замовлень` })}
        ${kpi(s.avgMinutes ? `${s.avgMinutes} хв` : '—', 'Середній час', { sub: 'від «готово» до клієнта' })}
        ${kpi(s.overdue, 'Прострочено', { sub: 'більш ніж +15 хв', tone: s.overdue ? 'bad' : '' })}
        ${kpi(money(s.unconfirmedCash), 'Готівка не підтверджена', { tone: s.unconfirmedCash ? 'bad' : 'good' })}
        ${kpi(money(s.platformEarnings), 'Заробіток платформи', { sub: `${s.delivered} × ${money(db.config.platformPerDelivery ?? 15)}`, tone: 'good' })}
      </div>`,
      statusChip(alarm ? 'failed_delivery' : 'delivered', `${s.online} на лінії`)
    )}

    ${
      alarm
        ? `<div class="callout callout--warn" style="margin-bottom:24px">
             <strong>Жоден курʼєр не на лінії, а замовлення чекають.</strong>
             За підрядної моделі ніхто не зобовʼязаний виходити на зміну —
             потрібне ручне втручання.
           </div>`
        : ''
    }

    ${panel(
      'Активні замовлення',
      `${active.length} у роботі`,
      active.length
        ? `<div class="tbl-scroll"><table>
            <thead><tr><th>Замовлення</th><th>Статус</th><th>Куди</th><th>Курʼєр</th><th>Сума</th></tr></thead>
            <tbody>${active.map((o) => orderRow(o, a)).join('')}</tbody>
          </table></div>`
        : `<div class="panel__body">${emptyState({ icon: 'check', title: 'Активних замовлень немає' })}</div>`
    )}`;
}

function orderRow(o, a) {
  const courier = a.couriers.find((c) => c.id === o.courierId);
  const waiting =
    o.status === 'ready' && o.readyAt
      ? `<div class="tiny">чекає ${esc(elapsed(o.readyAt))}</div>`
      : '';
  return `<tr data-action="open-order" data-id="${esc(o.id)}">
    <td class="num">${esc(o.code)}</td>
    <td>${statusChip(o.status)}${waiting}</td>
    <td>${esc(o.destLocality)}</td>
    <td>${courier ? `<div class="cell-name">${avatar(courier.fullName, true)}${esc(courier.fullName)}</div>` : '<span class="mut">—</span>'}</td>
    <td class="num">${esc(money(o.total))}</td>
  </tr>`;
}

/* ── Потребує уваги ─────────────────────────────────────────────────────── */

/** Те, що система не змогла вирішити сама. */
function attention(a) {
  const rows = [];

  for (const o of a.orders) {
    if (o.status === 'failed_delivery') {
      rows.push({
        code: o.code,
        what: statusChip('failed_delivery', reasonLabel(o.cancelReason?.reasonCode)),
        who: a.couriers.find((c) => c.id === o.courierId)?.fullName || '—',
        since: o.cancelledAt,
        id: o.id,
      });
    } else if (
      o.status === 'ready' &&
      !o.courierId &&
      o.readyAt &&
      Date.now() - o.readyAt > 600000
    ) {
      rows.push({
        code: o.code,
        what: statusChip('preparing', 'ніхто не взяв'),
        who: '—',
        since: o.readyAt,
        id: o.id,
      });
    } else if (o.paymentStatus === 'refund_needed') {
      rows.push({
        code: o.code,
        what: statusChip('failed_delivery', 'потрібен рефанд'),
        who: '—',
        since: o.cancelledAt,
        id: o.id,
      });
    }
  }

  if (!rows.length) {
    return panel(
      'Потребує уваги',
      'Те, що система не змогла вирішити сама',
      `<div class="panel__body">${emptyState({
        icon: 'check',
        title: 'Усе під контролем',
        text: 'Замовлень, що зависли або збились, немає.',
      })}</div>`
    );
  }

  return panel(
    'Потребує уваги',
    `${rows.length} ${rows.length === 1 ? 'ситуація' : 'ситуацій'}`,
    `<div class="tbl-scroll"><table>
      <thead><tr><th>Замовлення</th><th>Що сталось</th><th>Курʼєр</th><th>Скільки висить</th></tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr data-action="open-order" data-id="${esc(r.id)}">
        <td class="num">${esc(r.code)}</td>
        <td>${r.what}</td>
        <td>${esc(r.who)}</td>
        <td class="num">${esc(r.since ? elapsed(r.since) : '—')}</td>
      </tr>`
        )
        .join('')}</tbody>
    </table></div>`
  );
}

function reasonLabel(code) {
  return (
    {
      client_unreachable: 'клієнт не відповідає',
      address_not_found: 'не знайшов адресу',
      client_refused: 'клієнт відмовився',
      vehicle_problem: 'проблема зі скутером',
    }[code] || 'збій доставки'
  );
}

/* ── Готівка та звірка ──────────────────────────────────────────────────── */

function cash(a) {
  const pending = a.handoffs.filter((h) => h.status === 'declared');
  const nameOf = (id) => a.couriers.find((c) => c.id === id)?.fullName || id;

  const reconciliation = `<div class="tbl-scroll"><table>
    <thead><tr><th>Курʼєр</th><th>На руках</th><th>Заявлено</th><th>Підтверджено</th><th>Різниця</th><th>Статус</th></tr></thead>
    <tbody>${a.couriers
      .map((c) => {
        const hs = a.handoffs.filter((h) => h.courierId === c.id);
        const declared = hs.reduce((s, h) => s + h.declaredAmount, 0);
        const confirmed = hs.reduce((s, h) => s + (h.confirmedAmount ?? 0), 0);
        const diff = confirmed - declared;
        const disputed = hs.some((h) => h.status === 'disputed');
        const waiting = hs.some((h) => h.status === 'declared');
        return `<tr>
          <td><div class="cell-name">${avatar(c.fullName, true)}${esc(c.fullName)}</div></td>
          <td class="num">${esc(money(c.cashOnHand))}</td>
          <td class="num">${esc(money(declared))}</td>
          <td class="num">${confirmed ? esc(money(confirmed)) : '<span class="mut">—</span>'}</td>
          <td class="num" style="font-weight:650;color:${diff === 0 ? 'var(--s-done)' : 'var(--s-bad)'}">
            ${esc(money(diff))}
          </td>
          <td>${
            disputed
              ? statusChip('failed_delivery', 'розбіжність')
              : waiting
                ? statusChip('preparing', 'чекає підтвердження')
                : statusChip('delivered', 'звірено')
          }</td>
        </tr>`;
      })
      .join('')}</tbody>
  </table></div>`;

  return `
    ${panel(
      'Чекають підтвердження',
      pending.length ? `${pending.length} на розгляді` : 'Нових заявок немає',
      pending.length
        ? `<div class="panel__body">${pending
            .map(
              (h) => `<div class="card" style="margin-bottom:12px">
        <div class="row">
          <div class="cell-name">${avatar(nameOf(h.courierId), true)}${esc(nameOf(h.courierId))}</div>
          <span class="mid num">${esc(money(h.declaredAmount))}</span>
        </div>
        <div class="tiny" style="margin-top:6px">Заявлено ${esc(dateTime(h.declaredAt))}</div>
        <div class="field" style="margin:12px 0 0">
          <label class="field__label" for="amt-${esc(h.id)}">Скільки прийнято фактично</label>
          <input class="input num" id="amt-${esc(h.id)}" inputmode="numeric" value="${esc(h.declaredAmount)}">
        </div>
        <button class="btn btn-dark" data-action="confirm-handoff" data-id="${esc(h.id)}"
                style="margin-top:12px">Підтвердити</button>
      </div>`
            )
            .join('')}</div>`
        : `<div class="panel__body">${emptyState({ icon: 'check', title: 'Усе підтверджено' })}</div>`
    )}

    ${panel('Готівка та звірка', 'Хто скільки взяв, скільки здав і скільки винен', reconciliation)}

    <div class="callout callout--info">
      Готівка клієнтів — гроші закладу. Розбіжність фіксується як борг
      автоматично й потрапляє в утримання із заробітку, а не залишається
      усною суперечкою.
    </div>`;
}

/* ── Економіка ──────────────────────────────────────────────────────────── */

function economy(a) {
  const s = a.stats;
  const margin = s.collectedDelivery - s.courierPayout;

  return `
    ${panel(
      'Економіка',
      'Поточний період · усі заклади',
      `<div class="kpis">
        ${kpi(s.delivered, 'Доставлено')}
        ${kpi(money(s.collectedDelivery), 'Зібрано за доставку', { sub: `${s.delivered} × ${money(db.config.deliveryFee)}` })}
        ${kpi(`−${money(s.courierPayout)}`, 'Виплатимо курʼєрам')}
        ${kpi(money(margin), 'Лишається платформі', {
          sub: 'до витрат на скутери й сервіси',
          tone: margin > 0 ? 'good' : 'bad',
        })}
      </div>`,
      statusChip('overdue', `комісія ${money(db.config.platformPerDelivery ?? 15)} з доставки`)
    )}

    <div class="callout callout--warn">
      <strong>Ці числа поки заглушка.</strong> Розподіл 35 ₴ курʼєру / 15 ₴
      платформі взято з макета для прикладу. Реальний розподіл — рішення
      власника, воно відкладене (питання Q2 і Q3). Головне, що поле існує,
      рахується й маржа платформи ненульова: у першій версії брифу вона
      дорівнювала нулю, і цього ніхто не помічав.
    </div>`;
}

/* ── Курʼєри ────────────────────────────────────────────────────────────── */

function couriers(a) {
  // Нараховане, за що ще не виплачено: саме воно піде у відомість
  const pendingOf = (id) =>
    a.earnings.filter((e) => e.courierId === id && !e.payrollId).reduce((s, e) => s + e.amount, 0);
  const countOf = (id) =>
    a.earnings.filter((e) => e.courierId === id && e.reason === 'delivery').length;

  const table = `<div class="tbl-scroll"><table>
      <thead><tr><th>Курʼєр</th><th>Доставок</th><th>Готівка</th><th>Борг</th><th>До виплати</th><th></th></tr></thead>
      <tbody>${a.couriers
        .map((c) => {
          const pending = pendingOf(c.id);
          return `<tr>
        <td><div class="cell-name">${avatar(c.fullName, true)}${esc(c.fullName)}</div>
          <div class="tiny num">${esc(c.login)}</div>
          ${c.isActive ? '' : '<div class="tiny">деактивований</div>'}</td>
        <td class="num">${esc(countOf(c.id))}</td>
        <td class="num">${esc(money(c.cashOnHand))}</td>
        <td class="num" style="color:${c.debt ? 'var(--s-bad)' : 'var(--ink-3)'};font-weight:${c.debt ? 650 : 400}">
          ${esc(money(c.debt || 0))}</td>
        <td class="num" style="font-weight:650">${esc(money(pending))}</td>
        <td>
          ${
            pending
              ? `<button class="btn btn-dark btn-sm" data-action="create-payroll" data-id="${esc(c.id)}">
                   Сформувати</button>`
              : '<span class="mut tiny">немає нарахувань</span>'
          }
          <button class="btn btn-ghost btn-sm" data-action="toggle-courier"
              data-id="${esc(c.id)}" data-active="${c.isActive}" style="margin-left:6px">
              ${c.isActive ? 'Деактивувати' : 'Активувати'}</button>
        </td>
      </tr>`;
        })
        .join('')}</tbody>
    </table></div>`;

  const payrolls = a.payrolls?.length
    ? panel(
        'Відомості',
        `${a.payrolls.length} за весь час`,
        `<div class="tbl-scroll"><table>
        <thead><tr><th>Курʼєр</th><th>Доставок</th><th>Нараховано</th><th>Утримано</th><th>До виплати</th><th></th></tr></thead>
        <tbody>${[...a.payrolls]
          .reverse()
          .map((p) => {
            const c = a.couriers.find((x) => x.id === p.courierId);
            return `<tr>
            <td>${esc(c?.fullName || p.courierId)}</td>
            <td class="num">${esc(p.deliveriesCount)}</td>
            <td class="num">${esc(money(p.grossAmount))}</td>
            <td class="num" style="color:${p.deductions ? 'var(--s-bad)' : 'inherit'}">
              ${esc(money(p.deductions))}</td>
            <td class="num" style="font-weight:650">${esc(money(p.netAmount))}</td>
            <td>${
              p.status === 'paid'
                ? statusChip('delivered', 'виплачено')
                : `<button class="btn btn-dark btn-sm" data-action="pay-payroll" data-id="${esc(p.id)}">
                     Виплатити</button>`
            }</td>
          </tr>`;
          })
          .join('')}</tbody>
      </table></div>`
      )
    : '';

  return (
    whereabouts(a) +
    panel(
      'Курʼєри та зарплата',
      'Нараховане, борг по готівці й виплати',
      table,
      `<button class="btn btn-dark btn-sm" data-action="open-create-courier">Створити курʼєра</button>`
    ) +
    payrolls +
    `<div class="callout callout--info">
      Борг — це зафіксована розбіжність при здачі готівки. Він утримується
      з найближчої відомості автоматично, а курʼєр бачить його у профілі
      ще до дня виплати.
    </div>`
  );
}

/**
 * Де курʼєри зараз.
 *
 * Єдине питання, на яке адмін мусить уміти відповісти клієнту по телефону:
 * «де моя їжа». Досі позиція нікуди не йшла — `geo.start` викликався з
 * порожнім колбеком, тобто трекінг витрачав батарею й не давав нічого.
 *
 * Показуємо ОДНУ останню точку й вік цієї точки. Вік важливіший за саму
 * координату: свіжа точка за 3 км корисна, п'ятнадцятихвилинна — ні.
 */
/** «щойно», а не «щойно тому» — elapsed повертає і крапку в часі, і тривалість. */
function freshness(at) {
  const label = elapsed(at);
  return label === 'щойно' ? 'щойно' : `${label} тому`;
}

function whereabouts(a) {
  const online = a.couriers.filter((c) => c.status === 'online');
  const locations = a.locations || {};

  if (!online.length) {
    return panel(
      'Хто на лінії',
      'Позиція оновлюється лише під час активної доставки',
      `<div class="panel__body">${emptyState({
        icon: 'couriers',
        title: 'Нікого немає на лінії',
        text: 'Поза зміною позиція не зберігається — це не стеження за людиною.',
      })}</div>`
    );
  }

  const rows = online
    .map((c) => {
      const pos = locations[c.id];
      const active = a.orders.find(
        (o) =>
          o.courierId === c.id && ['courier_assigned', 'picked_up', 'on_the_way'].includes(o.status)
      );
      const age = pos ? Date.now() - pos.at : null;
      const stale = age !== null && age > 120000;

      return `<div class="card" style="margin-bottom:12px">
      <div class="row">
        <div class="cell-name">${avatar(c.fullName, true)}${esc(c.fullName)}</div>
        ${
          pos
            ? statusChip(stale ? 'preparing' : 'on_the_way', freshness(pos.at))
            : statusChip('placed', 'позиції ще немає')
        }
      </div>
      ${
        pos
          ? geoMap({
              from: a.business,
              to: active ? { lat: active.destLat, lng: active.destLng } : null,
              courier: pos,
              badge: active ? active.code : 'без замовлення',
            })
          : `<div class="tiny" style="margin-top:10px">
               Трекінг вмикається лише з активним замовленням — зараз його немає.
             </div>`
      }
      ${
        stale
          ? `<div class="callout callout--warn" style="margin-top:10px">
               Точка застаріла: телефон міг втратити мережу або застосунок
               згорнули. Це не означає, що курʼєр стоїть.
             </div>`
          : ''
      }
    </div>`;
    })
    .join('');

  return panel(
    'Хто на лінії',
    `${online.length} ${online.length === 1 ? 'курʼєр' : 'курʼєрів'}`,
    `<div class="panel__body">${rows}</div>`
  );
}

/* ── Фото ───────────────────────────────────────────────────────────────── */

function photos(a) {
  const withPhoto = a.orders.filter((o) => o.proofPhotoPath);
  const imageOf = (orderId) => a.photos?.find((p) => p.orderId === orderId)?.thumb;

  // Обхід коду — головне, заради чого цей екран існує. Саме там фото
  // з доказу перетворюється на єдиний доказ, і дивитись його треба
  // першим, а не шукати серед решти
  const sorted = [...withPhoto].sort(
    (x, y) => Number(!!y.pinBypassed) - Number(!!x.pinBypassed) || y.deliveredAt - x.deliveredAt
  );

  return `
    ${panel(
      'Фото підтверджень',
      `${withPhoto.length} за поточний період`,
      withPhoto.length
        ? `<div class="panel__body"><div class="proofs">${sorted
            .map((o) => proofCard(o, imageOf(o.id)))
            .join('')}</div></div>`
        : `<div class="panel__body">${emptyState({ icon: 'photo', title: 'Фото поки немає' })}</div>`
    )}

    <div class="callout">
      Фото зберігаються 90 днів, потім видаляються автоматично. Це персональні
      дані — доступ лише адміну й закладу-власнику замовлення.
    </div>`;
}

function proofCard(o, image) {
  return `<figure class="proof" data-action="open-order" data-id="${esc(o.id)}">
    ${
      image
        ? `<img class="proof__img" src="${esc(image)}" alt="Фото підтвердження ${esc(o.code)}" loading="lazy">`
        : `<div class="proof__img proof__img--none">${icons.photo(20)}
             <span class="tiny">зображення не збереглось</span>
           </div>`
    }
    <figcaption class="proof__cap">
      <div class="row">
        <span class="num tiny">${esc(o.code)}</span>
        ${o.pinBypassed ? statusChip('preparing', 'обхід коду') : statusChip('delivered', 'код звірено')}
      </div>
      <div class="tiny" style="margin-top:4px">${esc(dateTime(o.deliveredAt))}</div>
    </figcaption>
  </figure>`;
}

/* ── Журнал ─────────────────────────────────────────────────────────────── */

function journal(a) {
  if (!a.events.length) {
    return panel(
      'Журнал переходів',
      'append-only',
      `<div class="panel__body">${emptyState({ icon: 'journal', title: 'Журнал порожній' })}</div>`
    );
  }

  const codeOf = (id) => a.orders.find((o) => o.id === id)?.code || id;

  return `
    ${panel(
      'Журнал переходів',
      `${a.events.length} записів`,
      `<div class="tbl-scroll"><table>
        <thead><tr><th>Час</th><th>Замовлення</th><th>Перехід</th><th>Хто</th></tr></thead>
        <tbody>${[...a.events]
          .reverse()
          .map(
            (e) => `<tr data-action="open-order" data-id="${esc(e.orderId)}">
          <td class="num">${esc(dateTime(e.createdAt))}</td>
          <td class="num">${esc(codeOf(e.orderId))}</td>
          <td>${esc(statusLabel(e.fromStatus))} → <strong>${esc(statusLabel(e.toStatus))}</strong></td>
          <td>${actorCell(e, a)}</td>
        </tr>`
          )
          .join('')}</tbody>
      </table></div>`
    )}

    <div class="callout">
      Журнал append-only: рядки не редагуються й не видаляються ніким,
      включно з адміном. Без цього спір «я тиснув доставлено» недоказовий.
    </div>`;
}

const ROLE_LABELS = {
  courier: 'курʼєр',
  admin: 'адмін',
  business: 'заклад',
  client: 'клієнт',
  system: 'система',
};

/**
 * Хто саме зробив перехід.
 *
 * `actorId` писався від початку, але журнал показував саму лише роль —
 * «курʼєр» у спорі не відповідає на питання, ЯКИЙ курʼєр. Ім'я
 * розвʼязується з довідника, а не зберігається в події: перейменування
 * не має переписувати append-only журнал.
 */
function actorCell(e, a) {
  const role = ROLE_LABELS[e.actorRole] || e.actorRole;
  const name = a.couriers.find((c) => c.id === e.actorId)?.fullName;

  if (!name) return `<span class="mut">${esc(role)}</span>`;
  return `<div class="cell-name">${avatar(name, true)}
    <span>${esc(name)}<span class="tiny" style="display:block">${esc(role)}</span></span>
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
          <div class="row"><span class="mut">Логін</span>
            <strong class="num">${esc(sheet.result.login)}</strong></div>
          <div class="row"><span class="mut">Пароль</span>
            <strong class="num">${esc(sheet.result.password)}</strong></div>
        </div>
        <div class="callout callout--warn" style="margin-top:14px">
          <strong>Пароль показується один раз</strong> — саме так система й
          працює. Ніде у відкритому вигляді він не зберігається. Передай його зараз.
        </div>
        <button class="btn btn-dark" data-action="close-sheet" style="margin-top:16px">Готово</button>
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
        <input class="input num" id="nc-phone" inputmode="tel" autocomplete="off">
      </div>
      <button class="btn btn-dark" data-action="create-courier">Створити</button>
      <button class="btn btn-quiet" data-action="close-sheet" style="margin-top:4px">Назад</button>
    </div></div>`;
}

function orderSheet(state, orderId) {
  const o = state.admin?.orders.find((x) => x.id === orderId);
  if (!o) return '';
  const courier = state.admin.couriers.find((c) => c.id === o.courierId);

  return `<div class="sheet-backdrop" data-action="close-sheet">
    <div class="sheet" data-stop role="dialog" aria-modal="true">
      <div class="row" style="margin-bottom:14px">
        <h2 class="sheet__title num" style="margin:0">${esc(o.code)}</h2>
        ${statusChip(o.status)}
      </div>

      <div class="card">
        <div class="lbl">Адреса доставки</div>
        <div class="addr-line">${esc(o.destAddressText)}</div>
        ${o.destLandmark ? `<div class="landmark">${esc(o.destLandmark)}</div>` : ''}
      </div>

      <div class="card">
        <div class="row"><span class="mut">Клієнт</span><span>${esc(o.clientName)}</span></div>
        <div class="row"><span class="mut">Оплата</span>
          <span>${o.paymentMethod === 'cash' ? 'готівка' : 'онлайн'}</span></div>
        <div class="row"><span class="mut">Сума</span>
          <span class="num" style="font-weight:650">${esc(money(o.total))}</span></div>
        <div class="row"><span class="mut">Курʼєр</span>
          <span>${esc(courier?.fullName || '—')}</span></div>
        ${o.returnCount ? `<div class="row"><span class="mut">Повернень у чергу</span><span class="num">${esc(o.returnCount)}</span></div>` : ''}
      </div>

      ${
        o.paymentStatus === 'refund_needed'
          ? `<div class="callout callout--warn">
               <strong>Потрібен рефанд.</strong> Гроші клієнта досі не повернуті.
               Процес поки ручний — платіжного провайдера не визначено (Q6).
             </div>`
          : ''
      }

      <button class="btn btn-ghost" data-action="close-sheet" style="margin-top:16px">Закрити</button>
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
      if (!Number.isFinite(amount)) {
        toast('Вкажи суму', 'danger');
        return true;
      }
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

    case 'create-payroll':
      try {
        const p = await db.createPayroll(el.dataset.id);
        toast(`Відомість на ${p.netAmount} ₴ сформована`, 'ok', 3200);
        await load();
      } catch (error) {
        toast(error.message, 'danger');
      }
      return true;

    case 'pay-payroll':
      try {
        await db.payPayroll(el.dataset.id);
        toast('Виплачено', 'ok');
        await load();
      } catch (error) {
        toast(error.message, 'danger');
      }
      return true;

    case 'open-order':
      setState({ sheet: { type: 'order', orderId: el.dataset.id } });
      return true;

    default:
      return false;
  }
}

export { getState };
