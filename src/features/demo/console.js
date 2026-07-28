/**
 * Демо-консоль — пульт симуляції.
 *
 * ⚠️ Не потрапляє у продакшн-збірку. У реальній системі нічого з цього
 * не існує: замовлення приносять люди, кухня працює сама, годинник іде.
 *
 * Існує тому, що без неї демо було мертвим у найпростішому сенсі:
 * генератор замовлень і автопілот кухні лежали в моці від початку,
 * але **вмикати їх не було звідки**. Черга вичерпувалась на четвертому
 * насіннєвому замовленні, і застосунок, який мав показувати живу
 * систему, показував порожній екран.
 *
 * Друге, що тут з'явилось, — можливість подивитись правила, які інакше
 * не побачити: графік закладу треба зачекати до ночі, прострочення —
 * годину. Тумблер робить їх спостережуваними за секунду.
 */

import * as adapter from '#adapter';
import { getState, setState } from '../../lib/store.js';
import { renderTabs } from '../shared/tabs.js';
import { toast } from '../shared/toast.js';
import { icons } from '../shared/icons.js';
import { statusChip, panel, kpi, esc, money, elapsed, dateTime } from '../shared/ui.js';

const TABS = [
  { key: 'sim', label: 'Симуляція', icon: icons.dashboard },
  { key: 'state', label: 'Стан', icon: icons.journal },
];

export const tabKeys = TABS.map((t) => t.key);

export function title(tab) {
  return tab === 'state' ? 'Стан демо' : 'Пульт демо';
}

export function subtitle(state) {
  const d = state.console?.demo;
  if (!d) return '';
  return d.generator ? `генератор кожні ${d.intervalSec} с` : 'генератор вимкнено';
}

export function tabsBar(state, tab) {
  return renderTabs(TABS, tab);
}

export async function load() {
  setState({ status: 'loading', error: null });
  try {
    const overview = await adapter.fetchAdminOverview();
    setState({ console: overview, status: 'ready' });
  } catch (error) {
    setState({ status: 'error', error });
  }
}

export function renderTab(state, tab) {
  if (!state.console) return '';
  return tab === 'state' ? stateScreen(state.console) : simScreen(state.console);
}

/* ── Симуляція ──────────────────────────────────────────────────────────── */

const INTERVALS = [30, 60, 90, 180];

function simScreen(a) {
  const d = a.demo || {};
  const hours = a.business?.workingHours || { from: 0, to: 24 };
  const roundTheClock = hours.from === 0 && hours.to === 24;

  return `
    ${panel(
      'Потік замовлень',
      'Щоб черга не вичерпувалась',
      `<div class="panel__body">
        ${toggle('demo-generator', 'Генератор замовлень', d.generator, 'Створює нове замовлення саме, поки ти дивишся в інший екран')}

        <div class="h-sec">Як часто</div>
        <div class="seg">
          ${INTERVALS.map(
            (s) => `<button data-action="demo-interval" data-value="${s}"
              aria-selected="${(d.intervalSec || 90) === s}">${s} с</button>`
          ).join('')}
        </div>

        <button class="btn btn-ghost" data-action="demo-spawn" style="margin-top:16px">
          Створити замовлення зараз
        </button>
      </div>`
    )}

    ${panel(
      'Кухня',
      'Хто тисне «готово до забору»',
      `<div class="panel__body">
        ${toggle('demo-autokitchen', 'Автопілот кухні', d.autoKitchen, 'Замовлення само стає готовим у розрахунковий час. Вимкни — і готовність доведеться тиснути руками з поверхні закладу')}
      </div>`
    )}

    ${panel(
      'Графік закладу',
      roundTheClock ? 'цілодобово' : `з ${hours.from}:00 до ${hours.to}:00`,
      `<div class="panel__body">
        <div class="seg">
          <button data-action="demo-hours" data-value="0-24" aria-selected="${roundTheClock}">
            Цілодобово
          </button>
          <button data-action="demo-hours" data-value="10-22" aria-selected="${!roundTheClock}">
            10:00 – 22:00
          </button>
        </div>
        <div class="tiny" style="margin-top:10px">
          Демо за замовчуванням цілодобове навмисно: інакше застосунок був би
          непридатний уночі, а тести залежали б від години прогону. Перемкни
          на реальні години — і замовлення поза ними перестане створюватись (B34).
        </div>
      </div>`
    )}

    ${panel(
      'Почати спочатку',
      'Стан демо переживає перезавантаження',
      `<div class="panel__body">
        <button class="btn btn-danger" data-action="demo-reset">Скинути демо</button>
        <div class="tiny" style="margin-top:10px">
          Замовлення, гроші, борги, фото й журнал повернуться до насіннєвих.
          Створені курʼєри зникнуть.
        </div>
      </div>`
    )}`;
}

function toggle(id, label, on, hint) {
  return `<div class="row" style="align-items:flex-start">
    <div style="flex:1">
      <div class="strong">${esc(label)}</div>
      <div class="tiny" style="margin-top:3px">${esc(hint)}</div>
    </div>
    <button class="sw" role="switch" id="${esc(id)}"
            aria-checked="${!!on}" aria-label="${esc(label)}"
            data-action="${esc(id)}"></button>
  </div>`;
}

/* ── Стан ───────────────────────────────────────────────────────────────── */

/**
 * Одна сторінка, на якій видно всю систему одночасно.
 *
 * Сенс не декоративний: більшість зв'язків, які замикались у фазах 1–4,
 * інакше видно лише по одному — гроші в адмінці, статуси в закладі,
 * позиція в курʼєрах. Тут вони поруч, і розбіжність між ними помітна
 * одразу.
 */
function stateScreen(a) {
  const s = a.stats;
  const byStatus = {};
  for (const o of a.orders) byStatus[o.status] = (byStatus[o.status] || 0) + 1;

  const flagged = a.orders.filter((o) => o.watchdog?.length);
  const unpaidEarnings = a.earnings.filter((e) => !e.payrollId).reduce((x, e) => x + e.amount, 0);
  const cashOnHand = a.couriers.reduce((x, c) => x + c.cashOnHand, 0);
  const debt = a.couriers.reduce((x, c) => x + (c.debt || 0), 0);

  return `
    ${panel(
      'Замовлення за статусами',
      `${a.orders.length} усього`,
      `<div class="kpis">
        ${Object.entries(byStatus)
          .map(([status, n]) => kpi(n, statusWord(status)))
          .join('')}
      </div>`
    )}

    ${panel(
      'Гроші сходяться',
      'Числа, які мають узгоджуватись між собою',
      `<div class="kpis">
        ${kpi(money(cashOnHand), 'Готівка в курʼєрів', { sub: 'ще не здана', tone: cashOnHand ? 'bad' : 'good' })}
        ${kpi(money(unpaidEarnings), 'Нараховано, не виплачено', { sub: 'піде у відомість' })}
        ${kpi(money(debt), 'Борг по розбіжностях', { tone: debt ? 'bad' : 'good' })}
        ${kpi(money(s.platformEarnings), 'Заробіток платформи', { tone: 'good' })}
      </div>`
    )}

    ${panel(
      'Watchdog',
      flagged.length ? `${flagged.length} із прапорцями` : 'Прапорців немає',
      flagged.length
        ? `<div class="panel__body">${flagged
            .map(
              (o) => `<div class="card" style="margin-bottom:10px">
        <div class="row">
          <span class="num tiny">${esc(o.code)}</span>
          ${statusChip(o.status)}
        </div>
        <div class="row" style="margin-top:8px">
          <span class="mut">${o.watchdog.map(flagWord).join(' · ')}</span>
          <span class="tiny num">${esc(elapsed(o.readyAt || o.placedAt))}</span>
        </div>
      </div>`
            )
            .join('')}</div>`
        : `<div class="panel__body"><div class="tiny">
             Прапорці зʼявляються самі: невзяте понад 15 хв, застрягле в дорозі
             понад годину, доставлене пізніше обіцяного, двічі повернене.
           </div></div>`
    )}

    ${panel(
      'Останні події',
      `${a.events.length} у журналі`,
      `<div class="panel__body">${[...a.events]
        .slice(-8)
        .reverse()
        .map(
          (e) => `<div class="row" style="margin-bottom:8px">
        <span class="tiny">${esc(statusWord(e.toStatus))}</span>
        <span class="tiny num">${esc(dateTime(e.createdAt))}</span>
      </div>`
        )
        .join('')}</div>`
    )}`;
}

const STATUS_WORDS = {
  placed: 'оформлено',
  accepted_by_business: 'прийнято',
  preparing: 'готується',
  ready: 'готово',
  courier_assigned: 'взято',
  picked_up: 'забрано',
  on_the_way: 'в дорозі',
  delivered: 'доставлено',
  failed_delivery: 'не вдалось',
  rejected_by_business: 'відхилено',
  cancelled_by_client: 'скасовано',
};

function statusWord(status) {
  return STATUS_WORDS[status] || status || '—';
}

const FLAG_WORDS = {
  unclaimed: 'ніхто не взяв',
  stuck: 'застрягло в дорозі',
  late: 'приїхало пізно',
  bounced: 'ходить по колу',
};

function flagWord(flag) {
  return FLAG_WORDS[flag] || flag;
}

/* ── Дії ────────────────────────────────────────────────────────────────── */

export async function handle(action, el) {
  const d = getState().console?.demo || {};

  switch (action) {
    case 'demo-generator':
      adapter.setDemoSettings({ generator: !d.generator });
      toast(d.generator ? 'Генератор вимкнено' : 'Генератор увімкнено', 'ok');
      await load();
      return true;

    case 'demo-autokitchen':
      adapter.setDemoSettings({ autoKitchen: !d.autoKitchen });
      toast(
        d.autoKitchen ? 'Тепер «готово» тисне заклад' : 'Кухня знову на автопілоті',
        'ok',
        3200
      );
      await load();
      return true;

    case 'demo-interval':
      adapter.setDemoSettings({ intervalSec: Number(el.dataset.value) });
      await load();
      return true;

    case 'demo-spawn': {
      const order = adapter.spawnDemoOrder();
      toast(`${order.code} · ${order.destLocality}`, 'ok');
      await load();
      return true;
    }

    case 'demo-hours': {
      const [from, to] = String(el.dataset.value).split('-').map(Number);
      adapter.setBusinessHours(from, to);
      toast(from === 0 && to === 24 ? 'Цілодобово' : `Працює ${from}:00–${to}:00`, 'ok');
      await load();
      return true;
    }

    case 'demo-reset':
      adapter.resetDemo();
      toast('Демо почалось спочатку', 'ok');
      await load();
      return true;

    default:
      return false;
  }
}

export function renderOverlay() {
  return '';
}
