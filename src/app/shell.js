/**
 * Оболонка застосунку: рендер, роутинг, делегування подій.
 *
 * Рендер — функція від стану: екран перемальовується цілком, а не
 * патчиться точково. Для застосунку такого розміру це дешевше й надійніше
 * за ручну синхронізацію DOM, і не лишає застарілих слухачів.
 */

import { getState, setState, subscribe, resetState } from '../lib/store.js';
import * as db from '../lib/db.js';
import * as offline from '../lib/offline.js';
import * as geo from '../lib/geo.js';
import * as login from '../features/auth/login.js';
import * as courier from '../features/courier/index.js';
import * as admin from '../features/admin/index.js';
import { attachSwipe } from '../features/shared/tabs.js';
import { toast } from '../features/shared/toast.js';
import { countdown, esc } from '../lib/format.js';
import { versionLabel } from '../lib/version.js';
import { icons } from '../features/shared/icons.js';
import * as demo from '#demo';

let root = null;
let lastRoute = null;

/* ── Роутинг ────────────────────────────────────────────────────────────── */

function parseRoute(route) {
  const [area = '', tab = ''] = String(route || '').split('/');
  return { area, tab };
}

/**
 * Реєстр поверхонь. courier і admin — це сам Rocket Delivery; client
 * і business приходять із демо-модуля, бо в реальній системі вони
 * належать cstllife (ADR-0001). У продакшені demo.surfaces порожній,
 * і ці екрани не потрапляють у бандл узагалі.
 */
const SURFACES = { courier, admin, ...demo.surfaces };

function moduleFor(area) {
  return SURFACES[area] || courier;
}

/* ── Рендер ─────────────────────────────────────────────────────────────── */

function render() {
  const state = getState();

  if (!state.session) {
    root.innerHTML = login.render();
    login.mount(root);
    return;
  }

  const { area, tab } = parseRoute(state.route);
  const mod = moduleFor(area);
  const isAdmin = area === 'admin';

  const sub = mod.subtitle?.(state, tab) || '';

  root.innerHTML = `
    <div class="shell ${isAdmin ? 'shell--admin' : 'shell--phone'}">
      ${netbar(state)}
      <div class="buildbar num">${esc(versionLabel)}</div>
      <header class="nav">
        <div class="nav__title">${esc(mod.title(tab))}${sub ? `<small>${esc(sub)}</small>` : ''}</div>
        <button class="nav__btn" data-action="refresh" aria-label="Оновити">${icons.refresh()}</button>
        ${
          isAdmin || area === 'courier'
            ? ''
            : `<button class="nav__btn" data-action="switch-role" aria-label="Змінити роль">${icons.back()}</button>`
        }
      </header>
      <main class="shell__body" id="screen">${mod.renderTab(state, tab)}</main>
      ${mod.tabsBar(state, tab)}
    </div>
    ${mod.renderOverlay(state)}
  `;

  const body = root.querySelector('#screen');
  if (body) attachSwipe(body, (dir) => swipeTab(dir));

  // Фокус на поле PIN одразу — курʼєр стоїть під дверима
  root.querySelector('#pin-input')?.focus();
}

/**
 * Стан звʼязку — постійний елемент, не спливаюче повідомлення.
 * Показує ще й розмір черги: курʼєр має бачити, що дії не загубились.
 */
function netbar(state) {
  const queued = state.outbox.filter((x) => !x.failed).length;
  const failed = state.outbox.filter((x) => x.failed).length;

  if (failed) {
    return `<div class="netbar netbar--offline">
      ${icons.offline(15)} ${failed} ${failed === 1 ? 'дія не відправилась' : 'дій не відправились'}
      <button data-action="retry-outbox">Спробувати ще</button>
    </div>`;
  }
  if (state.connection === 'offline') {
    return `<div class="netbar netbar--offline">
      ${icons.offline(15)} Немає звʼязку${queued ? ` · ${queued} в черзі` : ''}
    </div>`;
  }
  if (queued) {
    return `<div class="netbar">
      ${icons.clock(15)} ${queued} ${queued === 1 ? 'дія чекає' : 'дій чекають'} відправки
    </div>`;
  }
  return '';
}

function swipeTab(dir) {
  const { area, tab } = parseRoute(getState().route);
  const keys = moduleFor(area).tabKeys;
  const i = keys.indexOf(tab);
  const next = keys[Math.min(keys.length - 1, Math.max(0, i + dir))];
  if (next && next !== tab) go(`${area}/${next}`);
}

export function go(route) {
  setState({ route, sheet: null });
}

/* ── Делегування подій ──────────────────────────────────────────────────── */

async function onClick(e) {
  // Кліки всередині шторки не мають закривати її
  if (e.target.closest('[data-stop]') && e.target.closest('[data-action]') === null) return;

  const el = e.target.closest('[data-action]');
  if (!el) return;

  const action = el.dataset.action;
  const state = getState();
  const { area } = parseRoute(state.route);

  switch (action) {
    case 'tab':
      go(`${area}/${el.dataset.tab}`);
      return;
    case 'close-sheet':
      if (el.hasAttribute('data-stop')) return;
      setState({ sheet: null });
      return;
    case 'reload':
    case 'refresh':
      await loadCurrent();
      return;
    case 'retry-outbox':
      for (const item of offline.failedItems()) await offline.retry(item.id);
      await loadCurrent();
      return;
    case 'logout':
      await geo.stop();
      await db.signOut();
      resetState();
      return;

    case 'switch-role':
      await geo.stop();
      resetState();
      return;
    default:
      break;
  }

  // Дії екрана входу, де ще немає ані сесії, ані поверхні. Порівняння
  // назв живе всередині демо-модуля навмисне: тримати їх тут означало б
  // лишати демо-рядки у продакшн-бандлі, бо shell.js збирається завжди.
  if (demo.handleGlobal(action)) {
    await geo.stop();
    resetState();
    return;
  }

  const mod = moduleFor(area);
  const handled = await mod.handle(action, el);
  if (!handled) return;

  if (area === 'courier') await courier.syncTracking();
}

/* ── Завантаження за роутом ─────────────────────────────────────────────── */

async function loadCurrent() {
  const { area, tab } = parseRoute(getState().route);
  if (!getState().session) return;
  const mod = moduleFor(area);
  await mod.load(tab || mod.tabKeys[0]);
}

/* ── Таймери ────────────────────────────────────────────────────────────── */

/**
 * Countdown оновлюється щосекунди без повного перемальовування —
 * інакше список стрибав би під пальцем.
 */
function tickCountdowns() {
  for (const el of document.querySelectorAll('[data-countdown]')) {
    const left = countdown(Number(el.dataset.countdown));
    if (left) {
      el.textContent = left;
    } else {
      // Час вийшов — перечитати чергу, замовлення могло стати готовим
      el.textContent = '00:00';
      scheduleReload();
    }
  }
}

let reloadTimer = null;
function scheduleReload() {
  if (reloadTimer) return;
  reloadTimer = setTimeout(async () => {
    reloadTimer = null;
    await loadCurrent();
  }, 1200);
}

/* ── Старт ──────────────────────────────────────────────────────────────── */

export function start(mountPoint) {
  root = mountPoint;

  offline.start();

  subscribe(async (state) => {
    render();
    if (state.route !== lastRoute) {
      lastRoute = state.route;
      await loadCurrent();
      await courier.syncTracking();
    }
  });

  document.addEventListener('click', onClick);
  setInterval(tickCountdowns, 1000);

  // Періодичне оновлення черги: Realtime додасться разом із Supabase,
  // але покладатись лише на нього не можна — після розриву події
  // не «догортаються», потрібне повне перечитування (docs/12, розділ 5)
  setInterval(() => {
    const { area, tab } = parseRoute(getState().route);
    if (getState().session && (area === 'admin' || tab === 'queue')) loadCurrent();
  }, 15000);

  window.addEventListener('offline', () => toast('Звʼязок зник — дії підуть у чергу', 'danger'));

  render();
}
