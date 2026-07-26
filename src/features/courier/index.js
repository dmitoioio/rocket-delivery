/** Курʼєрський застосунок: вкладки, завантаження даних, обробка дій. */

import * as db from '../../lib/db.js';
import * as geo from '../../lib/geo.js';
import * as photo from '../../lib/photo.js';
import { getState, setState } from '../../lib/store.js';
import { renderTabs } from '../shared/tabs.js';
import { toast, haptic } from '../shared/toast.js';
import * as queueScreen from './queue.js';
import * as activeScreen from './active.js';
import * as historyScreen from './history.js';
import * as profileScreen from './profile.js';
import * as complete from './complete.js';

const TABS = [
  { key: 'queue', label: 'Черга', icon: '📋' },
  { key: 'active', label: 'Активне', icon: '🛵' },
  { key: 'history', label: 'Історія', icon: '🗂' },
  { key: 'profile', label: 'Профіль', icon: '👤' },
];

export const tabKeys = TABS.map((t) => t.key);

const TITLES = {
  queue: 'Черга замовлень',
  active: 'Активне замовлення',
  history: 'Історія',
  profile: 'Профіль',
};

export function title(tab) {
  return TITLES[tab] || 'Rocket';
}

export function tabsBar(state, tab) {
  const withBadge = TABS.map((t) =>
    t.key === 'queue' && state.queue.some((o) => o.status === 'ready')
      ? { ...t, badge: state.queue.filter((o) => o.status === 'ready').length }
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

/** Шторки поверх контенту. */
export function renderOverlay(state) {
  if (state.complete) {
    return state.complete.result
      ? complete.successSheet(state.complete.result)
      : complete.sheet(state);
  }
  if (state.sheet?.type === 'cancel') return activeScreen.cancelSheet(state.sheet.orderId);
  if (state.sheet?.type === 'handoff') return profileScreen.handoffSheet(state.courier);
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
      setState({ history: await db.fetchHistory(cid), status: 'ready' });
    } else if (tab === 'profile') {
      setState({ courier: await db.fetchCourier(cid), status: 'ready' });
    }
  } catch (error) {
    setState({ status: 'error', error });
  }
}

/** Контакт клієнта — окремим RPC, і тільки поки замовлення активне (B15). */
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

/**
 * @param {string} action
 * @param {HTMLElement} el
 * @returns {Promise<boolean>} чи оброблено
 */
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

    case 'take-photo':
      await takePhoto();
      return true;

    case 'photo-next':
      setState({ complete: { ...state.complete, step: 'pin' } });
      return true;

    case 'pin-next':
      await submitPin(false);
      return true;

    case 'pin-bypass':
      await submitPin(true);
      return true;

    case 'cash-ok':
      await finish(cid);
      return true;

    case 'cash-problem':
      toast('Звернись до адміністратора — розбіжність зафіксовано', 'danger', 3600);
      await finish(cid);
      return true;

    case 'close-complete':
      setState({ complete: null });
      await load('active');
      return true;

    case 'toggle-online':
      await toggleOnline(cid);
      return true;

    case 'grant-geo':
      await grantGeo(cid);
      return true;

    case 'open-handoff':
      setState({ sheet: { type: 'handoff' } });
      return true;

    case 'declare-handoff':
      await declareHandoff(cid);
      return true;

    default:
      return false;
  }
}

/**
 * Взяття замовлення.
 *
 * UX програшу важливіший за UX виграшу — програвати курʼєр буде частіше
 * (ADR-0009). Картка згасає, тост пояснює, курʼєр ЛИШАЄТЬСЯ в черзі.
 * Ніякої модалки: поки він її закриває, програє й наступну гонку.
 */
async function accept(orderId, courierId, el) {
  if (!orderId || !courierId) return;

  el.disabled = true;
  el.textContent = 'Беру...';

  try {
    await db.acceptOrder(orderId, courierId);
    haptic('ok');
    setState({ queue: getState().queue.filter((o) => o.id !== orderId) });
    await load('active');
    setState({ route: 'courier/active' });
  } catch (error) {
    if (error.kind === 'conflict') {
      haptic('error');
      fadeOutCard(orderId);
      toast('Встиг інший', 'info', 1800);
      setState({ queue: getState().queue.filter((o) => o.id !== orderId) });
    } else {
      haptic('error');
      toast(error.message, 'danger', 3200);
      el.disabled = false;
      el.textContent = 'ВЗЯТИ';
    }
  }
}

function fadeOutCard(orderId) {
  document.querySelector(`[data-card="${CSS.escape(orderId)}"]`)?.classList.add('card--taken');
}

async function advance(orderId, toStatus, courierId) {
  if (toStatus === 'delivered') {
    // Завершення доставки — окремий флоу з фото й PIN
    setState({ complete: { orderId, step: 'photo', photo: null, pin: '', result: null } });
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
    else toast(reasonCode === 'return_to_queue' ? 'Повернуто в чергу' : 'Замовлення скасовано');
    setState({ contact: null });
    await load('active');
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function takePhoto() {
  const file = await photo.capture();
  if (!file) return;
  try {
    const compressed = await photo.compress(file);
    const uploaded = await photo.upload(getState().complete.orderId, compressed.dataUrl);
    setState({
      complete: {
        ...getState().complete,
        photo: { ...uploaded, bytes: compressed.bytes },
      },
    });
  } catch {
    toast('Не вдалось обробити фото', 'danger');
  }
}

async function submitPin(bypassed) {
  const state = getState();
  const input = document.getElementById('pin-input');
  const pin = bypassed ? '' : (input?.value || '').trim();

  if (!bypassed && pin.length !== 4) {
    setState({ complete: { ...state.complete, pin, pinError: 'Потрібно 4 цифри' } });
    return;
  }

  const order = state.active.find((o) => o.id === state.complete.orderId);
  const next = { ...state.complete, pin, pinBypassed: bypassed, pinError: null };

  if (order?.paymentMethod === 'cash') {
    setState({ complete: { ...next, step: 'cash' } });
  } else {
    setState({ complete: next });
    await finish(state.session.courierId);
  }
}

async function finish(courierId) {
  const state = getState();
  const flow = state.complete;
  if (!flow) return;

  try {
    const res = await db.completeDelivery(flow.orderId, courierId, {
      photoPath: flow.photo?.path,
      pin: flow.pin,
      pinBypassed: !!flow.pinBypassed,
    });

    haptic('ok');

    if (res.queued) {
      // Ніколи не показуємо успіх для непідтвердженого сервером (B23)
      setState({ complete: null });
      toast('Немає звʼязку — доставка надішлеться автоматично', 'info', 3600);
      await load('active');
      return;
    }

    const courier = await db.fetchCourier(courierId);
    setState({
      courier,
      complete: {
        ...flow,
        result: {
          earned: db.config.courierPerDelivery,
          cashOnHand: courier.cashOnHand,
        },
      },
    });
  } catch (error) {
    haptic('error');
    // Невірний PIN повертає на крок PIN, а не закриває весь флоу
    if (error.kind === 'validation' && /код/i.test(error.message)) {
      setState({ complete: { ...flow, step: 'pin', pinError: error.message } });
      return;
    }
    setState({ complete: null });
    toast(error.message, 'danger', 3200);
  }
}

/* ── Онлайн і геолокація ────────────────────────────────────────────────── */

/**
 * Без дозволу на геолокацію курʼєр не може вийти в онлайн (B22):
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
  if (!granted) {
    setState({ sheet: { type: 'geo-denied' } });
    return;
  }
  setState({ sheet: null });
  await goOnline(courierId);
}

async function goOnline(courierId) {
  setState({ sheet: null });
  await db.setCourierStatus(courierId, 'online');
  await load('profile');
  toast('Ти онлайн', 'ok');
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

async function declareHandoff(courierId) {
  const input = document.getElementById('handoff-amount');
  const amount = Number(input?.value);
  if (!amount || amount <= 0) return toast('Вкажи суму', 'danger');

  setState({ sheet: null });
  try {
    const res = await db.declareCashHandoff(courierId, amount);
    if (res.queued) toast('Немає звʼязку — надішлеться автоматично', 'info', 3000);
    else toast('Заявку відправлено. Чекай підтвердження закладу', 'ok', 3200);
    await load('profile');
  } catch (error) {
    toast(error.message, 'danger');
  }
}
