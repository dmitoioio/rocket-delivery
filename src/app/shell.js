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

/**
 * 🛑 Чи є на екрані введене, але ще не збережене.
 *
 * Рендер замінює `innerHTML` цілком — разом із полями введення й фокусом.
 * Для екранів без форм це дешево й надійно. Але для форми це означає, що
 * фонове перечитування СТИРАЄ те, що людина зараз друкує, і забирає фокус:
 * «мене викидає, і весь текст пропадає».
 *
 * У демо цього не було видно: фонове перечитування там ішло раз на 15 с
 * по тих самих незмінних даних, а вкладки «Замовлення» не існувало
 * взагалі. З живою базою кожна подія Realtime — чужий курʼєр вийшов на
 * лінію, змінився статус — прилітає негайно й перемальовує екран під
 * пальцями (правило 17.10: не рухай те, що зараз під пальцем).
 *
 * Тому фонові перемальовування пропускаються, доки на екрані є незбережений
 * текст. Дані в стані при цьому оновлюються — застаріває лише картинка,
 * і рівно до наступної дії людини.
 */
function hasUnsavedInput() {
  if (!root) return false;

  // Уся площа, а не лише #screen: шторка з полем коду малюється ПОЗА нею,
  // а стирати введений PIN у курʼєра під дверима — найдорожчий випадок
  // цього ж бага.
  const active = document.activeElement;
  if (active && root.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
    return true;
  }
  for (const el of root.querySelectorAll('input, textarea')) {
    if (el.value) return true;
  }
  return false;
}

let shownSession = null;
let shownRoute = null;

function render() {
  const state = getState();

  /*
   * Кого малюємо, а кого — ні.
   *
   * Фонові перемальовування (таймер, події Realtime, автопілот демо)
   * стирали набране, бо рендер замінює розмітку цілком. Тому вони
   * чекають, поки на екрані є непорожнє поле.
   *
   * Але «фонове» — не те саме, що «не клік». Зміна екрана й вхід
   * приходять НЕ з обробника кліку: форма логіна надсилається подією
   * submit. Перша версія цієї умови дивилась лише на клік — і після
   * правильного логіна з паролем екран не перемальовувався взагалі:
   * поля лишались заповненими, кнопка застрягала на «Вхід…», людина
   * сиділа на екрані входу. Тобто фікс форми зламав сам вхід.
   *
   * Тому пропускається лише те, що не змінює НІ сесію, НІ маршрут:
   * саме такі зміни — це «прийшли свіжі дані», і тільки їх можна
   * відкласти. Вхід, вихід і перехід між вкладками малюються завжди.
   */
  const navigated = state.session !== shownSession || state.route !== shownRoute;
  if (!userAction && !navigated && hasUnsavedInput()) return;

  shownSession = state.session;
  shownRoute = state.route;

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
        ${navExit(area, isAdmin)}
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
 * Кнопка виходу в шапці.
 *
 * ⚠️ Адмін ДОВГО не мав її взагалі: у нього немає вкладки профілю
 * (вона є тільки в курʼєра), а кнопка зміни ролі показувалась усім,
 * КРІМ адміна й курʼєра. Тобто зайшовши адміністратором, вийти було
 * неможливо — ні передати пристрій, ні перевірити курʼєрський вхід.
 * У демо це не помічалось, бо там завжди можна скинути стан.
 *
 * Курʼєру кнопка тут не потрібна: у нього вихід у профілі, а місце
 * в шапці на телефоні дорожче.
 */
function navExit(area, isAdmin) {
  if (isAdmin) {
    return `<button class="nav__btn" data-action="logout" aria-label="Вийти">${icons.back()}</button>`;
  }
  if (area === 'courier') return '';
  return `<button class="nav__btn" data-action="switch-role" aria-label="Змінити роль">${icons.back()}</button>`;
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

/**
 * Чи виконується зараз дія людини. Тримається на весь обробник кліку,
 * включно з очікуванням мережі всередині: рендери, спричинені натисканням,
 * мають малюватись завжди — навіть коли форма заповнена.
 */
let userAction = false;

async function onClick(e) {
  // Кліки всередині шторки не мають закривати її
  if (e.target.closest('[data-stop]') && e.target.closest('[data-action]') === null) return;

  const el = e.target.closest('[data-action]');
  if (!el) return;

  userAction = true;
  try {
    await handleClick(el);
  } finally {
    userAction = false;
  }
}

async function handleClick(el) {
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
      stopWatching(); // канал прив'язаний до сесії — після виходу він мертвий
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

/* ── Синхронізація ──────────────────────────────────────────────────────── */

let watching = false;
let unwatch = null;

/**
 * Підписка на зміни замовлень, якщо бекенд її підтримує.
 *
 * Мок повертає null — підписка на памʼять власного браузера нічого не
 * синхронізує. Жива база повертає функцію відписки, і тоді опитування
 * сповільнюється вчетверо (15 с → 60 с), але не зникає.
 */
function startWatching() {
  unwatch = db.watchOrders(() => scheduleReload());
  watching = unwatch !== null;
}

function stopWatching() {
  unwatch?.();
  unwatch = null;
  watching = false;
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

  startWatching();

  // Періодичне перечитування. З Realtime воно рідше, але НЕ вимикається:
  // після розриву звʼязку події не «догортаються», і черга залишилась би
  // застарілою назавжди (docs/12, розділ 5). Realtime — прискорювач,
  // опитування — страховка.
  setInterval(
    () => {
      const { area, tab } = parseRoute(getState().route);
      if (getState().session && (area === 'admin' || tab === 'queue')) loadCurrent();
    },
    watching ? 60000 : 15000
  );

  window.addEventListener('offline', () => toast('Звʼязок зник — дії підуть у чергу', 'danger'));

  render();
}
