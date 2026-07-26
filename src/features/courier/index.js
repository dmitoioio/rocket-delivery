/** Курʼєрський застосунок: вкладки, завантаження даних, обробка дій. */

import * as db from '../../lib/db.js';
import * as geo from '../../lib/geo.js';
import * as photoLib from '../../lib/photo.js';
import { getState, setState } from '../../lib/store.js';
import { renderTabs } from '../shared/tabs.js';
import { toast, haptic } from '../shared/toast.js';
import { icons } from '../shared/icons.js';
import * as queueScreen from './queue.js';
import * as activeScreen from './active.js';
import * as historyScreen from './history.js';
import * as profileScreen from './profile.js';
import * as complete from './complete.js';

const TABS = [
  { key: 'queue', label: 'Черга', icon: icons.queue },
  { key: 'active', label: 'Активне', icon: icons.active },
  { key: 'history', label: 'Історія', icon: icons.history },
  { key: 'profile', label: 'Профіль', icon: icons.profile },
];

export const tabKeys = TABS.map((t) => t.key);

const TITLES = {
  queue: 'Черга',
  active: 'Активна доставка',
  history: 'Історія',
  profile: 'Профіль',
};

export function title(tab) {
  return TITLES[tab] || 'Rocket';
}

export function subtitle(state, tab) {
  if (tab === 'queue') {
    const ready = state.queue.filter((o) => o.status === 'ready').length;
    if (ready) return `${ready} готових до забору`;
    // Назва закладу — з даних, не з коду: другий заклад не має вимагати
    // переписування UI (docs/01)
    return state.queue[0]?.businessName || 'Немає замовлень';
  }
  if (tab === 'active') return state.active[0]?.code || '';
  return '';
}

export function tabsBar(state, tab) {
  const readyCount = state.queue.filter((o) => o.status === 'ready').length;
  const withBadge = TABS.map((t) =>
    t.key === 'queue' && readyCount
      ? { ...t, badge: readyCount }
      : t.key === 'active' && state.active.length
        ? { ...t, badge: state.active.length }
        : t
  );
  return renderTabs(withBadge, tab);
}

export function renderTab(state, tab) {
  switch (tab) {
    case 'active':
      return activeScreen.render(state);
    case 'history':
      return historyScreen.render(state);
    case 'profile':
      return profileScreen.render(state);
    default:
      return queueScreen.render(state);
  }
}

export function renderOverlay(state) {
  if (state.complete) return complete.sheet(state);
  if (state.sheet?.type === 'cancel') return activeScreen.cancelSheet(state.sheet.orderId);
  if (state.sheet?.type === 'handoff') {
    return profileScreen.handoffSheet(state.courier, state.sheet.orders || []);
  }
  if (state.sheet?.type === 'geo-gate') return profileScreen.geoGateSheet();
  if (state.sheet?.type === 'geo-denied') return profileScreen.geoDeniedSheet();
  return '';
}

/* ── Завантаження ───────────────────────────────────────────────────────── */

export async function load(tab) {
  const { session } = getState();
  if (!session?.courierId) return;
  const cid = session.courierId;

  setState({ status: 'loading', error: null });
  try {
    if (tab === 'queue') {
      const [queue, active, courier] = await Promise.all([
        db.fetchQueue(),
        db.fetchActive(cid),
        db.fetchCourier(cid),
      ]);
      setState({ queue, active, courier, status: 'ready' });
    } else if (tab === 'active') {
      const active = await db.fetchActive(cid);
      setState({ active, status: 'ready' });
      await loadContact(active[0], cid);
    } else if (tab === 'history') {
      const [history, courier] = await Promise.all([db.fetchHistory(cid), db.fetchCourier(cid)]);
      setState({ history, courier, status: 'ready' });
    } else if (tab === 'profile') {
      setState({ courier: await db.fetchCourier(cid), status: 'ready' });
    }
  } catch (error) {
    setState({ status: 'error', error });
  }
}

/** Контакт клієнта — окремим RPC і тільки поки замовлення активне (B15). */
async function loadContact(order, courierId) {
  if (!order) return setState({ contact: null });
  try {
    const contact = await db.getOrderContact(order.id, courierId);
    setState({ contact: { ...contact, orderId: order.id } });
  } catch {
    setState({ contact: null });
  }
}

/* ── Дії ────────────────────────────────────────────────────────────────── */

export async function handle(action, el) {
  const state = getState();
  const cid = state.session?.courierId;

  switch (action) {
    case 'accept':
      await accept(el.dataset.id, cid, el);
      return true;

    case 'advance':
      await advance(el.dataset.id, el.dataset.to, cid);
      return true;

    case 'open-cancel':
      setState({ sheet: { type: 'cancel', orderId: el.dataset.id } });
      return true;

    case 'cancel-order':
      await cancel(el.dataset.id, el.dataset.reason, cid);
      return true;

    /* — завершення доставки — */
    case 'take-photo':
      await takePhoto();
      return true;

    case 'pin-bypass':
      patchFlow({ pinBypassed: true, pin: '', pinError: null });
      return true;

    case 'pin-restore':
      patchFlow({ pinBypassed: false });
      return true;

    case 'cash-taken':
      patchFlow({ cashTaken: !state.complete?.cashTaken });
      return true;

    case 'finish-delivery':
      await finish(cid);
      return true;

    case 'close-complete':
      setState({ complete: null });
      await load('active');
      return true;

    /* — профіль — */
    case 'toggle-online':
      await toggleOnline(cid);
      return true;

    case 'grant-geo':
      await grantGeo(cid);
      return true;

    case 'open-handoff':
      await openHandoff(cid);
      return true;

    case 'declare-handoff':
      await declareHandoff(cid);
      return true;

    default:
      return false;
  }
}

/** Зберігає введений PIN перед перемальовуванням — інакше він губиться. */
function patchFlow(patch) {
  const flow = getState().complete;
  if (!flow) return;
  const typed = document.getElementById('pin-input')?.value;
  setState({ complete: { ...flow, ...(typed !== undefined ? { pin: typed } : {}), ...patch } });
}

/**
 * Взяття замовлення.
 *
 * UX програшу важливіший за UX виграшу — програвати кур'єр буде частіше
 * (ADR-0009). Картка згасає, тост пояснює, кур'єр ЛИШАЄТЬСЯ в черзі.
 * Ніякої модалки: поки він її закриває, програє й наступну гонку.
 */
async function accept(orderId, courierId, el) {
  if (!orderId || !courierId) return;

  el.disabled = true;
  el.textContent = 'Беру…';

  try {
    await db.acceptOrder(orderId, courierId);
    haptic('ok');
    setState({ queue: getState().queue.filter((o) => o.id !== orderId) });
    await load('active');
    setState({ route: 'courier/active' });
  } catch (error) {
    haptic('error');
    if (error.kind === 'conflict') {
      document.querySelector(`[data-card="${CSS.escape(orderId)}"]`)?.classList.add('card--taken');
      toast('Встиг інший', 'info', 1800);
      setState({ queue: getState().queue.filter((o) => o.id !== orderId) });
    } else {
      toast(error.message, 'danger', 3200);
      el.disabled = false;
      el.textContent = 'Взяти замовлення';
    }
  }
}

async function advance(orderId, toStatus, courierId) {
  if (toStatus === 'delivered') {
    setState({
      complete: {
        orderId,
        photo: null,
        pin: '',
        pinBypassed: false,
        cashTaken: false,
        pinError: null,
        result: null,
      },
    });
    return;
  }

  try {
    const res = await db.advanceStatus(orderId, courierId, toStatus);
    haptic('ok');
    if (res.queued) toast('Немає звʼязку — надішлеться автоматично', 'info', 3000);
    await load('active');
  } catch (error) {
    haptic('error');
    toast(error.message, 'danger');
  }
}

async function cancel(orderId, reasonCode, courierId) {
  setState({ sheet: null });
  try {
    const res = await db.cancelOrder(orderId, courierId, { reasonCode, note: '' });
    if (res.queued) toast('Немає звʼязку — надішлеться автоматично', 'info', 3000);
    else if (reasonCode === 'return_to_queue') toast('Повернуто в чергу');
    else toast('Адмін уже бачить це в дашборді', 'info', 3400);
    setState({ contact: null });
    await load('active');
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function takePhoto() {
  const file = await photoLib.capture();
  if (!file) return;
  try {
    const compressed = await photoLib.compress(file);
    const uploaded = await photoLib.upload(getState().complete.orderId, compressed.dataUrl);
    patchFlow({ photo: { ...uploaded, bytes: compressed.bytes } });
    haptic('ok');
  } catch {
    toast('Не вдалось обробити фото', 'danger');
  }
}

async function finish(courierId) {
  const state = getState();
  const flow = state.complete;
  if (!flow) return;

  const order = state.active.find((o) => o.id === flow.orderId);
  const pin = flow.pinBypassed ? '' : document.getElementById('pin-input')?.value || flow.pin;

  const check = complete.readiness({ ...flow, pin }, order);
  if (!check.ok) return toast(check.missing, 'danger');

  try {
    const res = await db.completeDelivery(flow.orderId, courierId, {
      photoPath: flow.photo?.path,
      pin,
      pinBypassed: !!flow.pinBypassed,
    });

    if (res.queued) {
      // Ніколи не показуємо успіх для непідтвердженого сервером (B23)
      setState({ complete: null });
      toast('Немає звʼязку — доставка надішлеться автоматично', 'info', 3600);
      await load('active');
      return;
    }

    haptic('ok');
    const courier = await db.fetchCourier(courierId);
    setState({
      courier,
      complete: {
        ...flow,
        result: {
          earned: db.config.courierPerDelivery + (order?.waitingBonus || 0),
          cashOnHand: courier.cashOnHand,
        },
      },
    });
  } catch (error) {
    haptic('error');
    if (error.kind === 'validation' && /код/i.test(error.message)) {
      setState({ complete: { ...flow, pin, pinError: error.message } });
      return;
    }
    setState({ complete: null });
    toast(error.message, 'danger', 3200);
  }
}

/* ── Онлайн і геолокація ────────────────────────────────────────────────── */

/**
 * Без дозволу на геолокацію кур'єр не може вийти на лінію (B22):
 * замовлення без трекінгу — це замовлення, за яким ніхто не бачить, де їжа.
 */
async function toggleOnline(courierId) {
  const c = getState().courier;
  if (!c) return;

  if (c.status === 'online') {
    await geo.stop();
    await db.setCourierStatus(courierId, 'offline');
    await load('profile');
    return;
  }

  const permission = await geo.permissionState();
  if (permission === 'denied') return setState({ sheet: { type: 'geo-denied' } });
  if (permission !== 'granted') return setState({ sheet: { type: 'geo-gate' } });

  await goOnline(courierId);
}

async function grantGeo(courierId) {
  const granted = await geo.requestPermission();
  if (!granted) return setState({ sheet: { type: 'geo-denied' } });
  setState({ sheet: null });
  await goOnline(courierId);
}

async function goOnline(courierId) {
  setState({ sheet: null });
  await db.setCourierStatus(courierId, 'online');
  await load('profile');
  toast('Ти на лінії', 'ok');
}

/** Трекінг тільки під час активного замовлення. */
export async function syncTracking() {
  const state = getState();
  const shouldTrack = state.courier?.status === 'online' && state.active.length > 0;

  if (shouldTrack && !geo.isTracking()) {
    await geo.start(() => {
      /* У продакшені — Realtime Broadcast, не INSERT у таблицю (B16) */
    });
  } else if (!shouldTrack && geo.isTracking()) {
    await geo.stop();
  }
}

/* ── Готівка ────────────────────────────────────────────────────────────── */

async function openHandoff(courierId) {
  let orders = [];
  try {
    const history = await db.fetchHistory(courierId);
    orders = history.filter((o) => o.status === 'delivered' && o.paymentMethod === 'cash');
  } catch {
    /* перелік необовʼязковий — сума на руках уже відома */
  }
  setState({ sheet: { type: 'handoff', orders } });
}

async function declareHandoff(courierId) {
  const amount = Number(document.getElementById('handoff-amount')?.value);
  if (!amount || amount <= 0) return toast('Вкажи суму', 'danger');

  setState({ sheet: null });
  try {
    const res = await db.declareCashHandoff(courierId, amount);
    if (res.queued) toast('Немає звʼязку — надішлеться автоматично', 'info', 3000);
    else toast('Заявку відправлено. Чекай підтвердження закладу', 'ok', 3400);
    await load('profile');
  } catch (error) {
    toast(error.message, 'danger');
  }
}
