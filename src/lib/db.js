/**
 * Єдиний шар доступу до даних — docs/12-technical-design.md, розділ 3.
 *
 * ЖОДНИХ прямих викликів бекенду з екранів. Усе через цей модуль.
 * Тут і тільки тут живуть: класифікація помилок, офлайн-черга,
 * ідемпотентність і оптимістичні оновлення.
 *
 * Бекенд підставляється на збірці через аліас `#adapter`:
 *   dev/тести  → adapters/mock.js      (повна бізнес-логіка в памʼяті)
 *   production → adapters/supabase.js  (реальна база)
 * Заміна бекенду — це один рядок у scripts/build.mjs, а не переписування
 * застосунку. Саме заради цього шар існує.
 */

import * as adapter from '#adapter';
import { toAppError, report } from './errors.js';
import { enqueue, registerHandler, flush } from './offline.js';
import { newKey } from './idempotency.js';

export const config = adapter.config;
export const backendName = adapter.name;

/**
 * Демо-доступи — є тільки в моковому адаптері, у продакшені null (B18).
 *
 * Саме прямий ре-експорт, а не `adapter.demoCredentials ?? null`: через
 * простір імен esbuild не бачить константу й не може згорнути демо-гілку,
 * тож розмітка кнопок входу лишалась у продакшн-бандлі мертвим кодом.
 */
export { demoCredentials } from '#adapter';

function offline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Обгортка читання: помилка класифікується й логується, назовні летить
 * AppError, а не сире повідомлення бекенду.
 */
async function read(label, fn) {
  try {
    return await fn();
  } catch (e) {
    const error = toAppError(e);
    report(error, label);
    throw error;
  }
}

/* ── Автентифікація ─────────────────────────────────────────────────────── */

export function signIn(login, password) {
  return read('signIn', () => adapter.signIn(login, password));
}

export function signOut() {
  return read('signOut', () => adapter.signOut());
}

/* ── Читання ────────────────────────────────────────────────────────────── */

export function fetchQueue() {
  return read('fetchQueue', () => adapter.fetchQueue());
}

export function fetchActive(courierId) {
  return read('fetchActive', () => adapter.fetchActive(courierId));
}

export function fetchHistory(courierId) {
  return read('fetchHistory', () => adapter.fetchHistory(courierId));
}

export function fetchCourier(courierId) {
  return read('fetchCourier', () => adapter.fetchCourier(courierId));
}

export function fetchAdminOverview() {
  return read('fetchAdminOverview', () => adapter.fetchAdminOverview());
}

/**
 * Контакт клієнта. Винесено окремою функцією навмисно: це нагадування
 * в самому API, що телефон і точна адреса — не звичайне поле замовлення,
 * а привілей, який видається під умову й логується (B15).
 */
export function getOrderContact(orderId, courierId) {
  return read('getOrderContact', () => adapter.getOrderContact(orderId, courierId));
}

/* ── Взяття замовлення ──────────────────────────────────────────────────── */

/**
 * ⚠️ ЄДИНА дія, яку НЕ МОЖНА класти в офлайн-чергу.
 *
 * Поки курʼєр офлайн, замовлення забере інший. Відкладене взяття означає,
 * що через 10 хвилин курʼєр поїде за замовленням, яке вже везуть.
 * Тому за відсутності мережі — чесна помилка, а не тиха черга.
 */
export async function acceptOrder(orderId, courierId) {
  if (offline()) throw toAppError({ code: 'offline' });
  return read('acceptOrder', () => adapter.acceptOrder(orderId, courierId));
}

/* ── Дії, які можна відкласти ───────────────────────────────────────────── */

/**
 * Спробувати виконати зараз; за відсутності мережі — поставити в чергу.
 * @returns {Promise<{data?: unknown, queued?: boolean}>}
 */
async function actOrQueue({ type, orderId, payload, run }) {
  const idempotencyKey = newKey();

  if (offline()) {
    await enqueue({ type, orderId, payload, idempotencyKey });
    return { queued: true };
  }

  try {
    const data = await run(idempotencyKey);
    return { data };
  } catch (e) {
    const error = toAppError(e);
    report(error, type);
    // Мережеві збої йдуть у чергу — курʼєр не має втрачати дію через
    // одну пропалу відповідь. Решта класів показуються одразу.
    if (error.kind === 'network') {
      await enqueue({ type, orderId, payload, idempotencyKey });
      return { queued: true };
    }
    throw error;
  }
}

export function advanceStatus(orderId, courierId, toStatus) {
  return actOrQueue({
    type: 'advanceStatus',
    orderId,
    payload: { orderId, courierId, toStatus },
    run: () => adapter.advanceStatus(orderId, courierId, toStatus),
  });
}

export function completeDelivery(orderId, courierId, proof) {
  return actOrQueue({
    type: 'completeDelivery',
    orderId,
    payload: { orderId, courierId, proof },
    run: () => adapter.completeDelivery(orderId, courierId, proof),
  });
}

export function cancelOrder(orderId, courierId, reason) {
  return actOrQueue({
    type: 'cancelOrder',
    orderId,
    payload: { orderId, courierId, reason },
    run: () => adapter.cancelOrder(orderId, courierId, reason),
  });
}

export function declareCashHandoff(courierId, amount) {
  return actOrQueue({
    type: 'declareCashHandoff',
    payload: { courierId, amount },
    run: () => adapter.declareCashHandoff(courierId, amount),
  });
}

export function setCourierStatus(courierId, status) {
  return actOrQueue({
    type: 'setCourierStatus',
    payload: { courierId, status },
    run: () => adapter.setCourierStatus(courierId, status),
  });
}

/**
 * Позиція курʼєра.
 *
 * Свідомо НЕ через actOrQueue: координата має цінність лише зараз.
 * Складати позиції в офлайн-чергу означає через 20 хвилин відтворити
 * маршрут, яким курʼєр давно проїхав, — марний трафік і зайве стеження.
 * Втрачена точка не втрата: наступна прийде через 8 секунд.
 */
export function updateCourierLocation(courierId, pos) {
  return adapter.updateCourierLocation?.(courierId, pos).catch(() => null) ?? Promise.resolve(null);
}

/* ── Адмінські дії ──────────────────────────────────────────────────────── */

export function confirmHandoff(handoffId, amount) {
  return read('confirmHandoff', () => adapter.confirmHandoff(handoffId, amount));
}

/** Формування відомості за період: нараховане мінус борг по готівці. */
export function createPayroll(courierId) {
  return read('createPayroll', () => adapter.createPayroll(courierId));
}

export function payPayroll(payrollId) {
  return read('payPayroll', () => adapter.payPayroll(payrollId));
}

/**
 * Створення замовлення. У продакшені це робить чекаут на cstllife —
 * тут функція існує, бо демо симулює й ту поверхню теж.
 */
export function createOrder(payload) {
  return read('createOrder', () => adapter.createOrder(payload));
}

export function createCourier(data) {
  return read('createCourier', () => adapter.createCourier(data));
}

export function setCourierActive(courierId, isActive) {
  return read('setCourierActive', () => adapter.setCourierActive(courierId, isActive));
}

/* ── Обробники відкладених дій ──────────────────────────────────────────── */
/* Той самий ключ ідемпотентності мандрує з дією через усі ретраї, тож
   повтор не створює другу дію на сервері. */

registerHandler('advanceStatus', (p) => adapter.advanceStatus(p.orderId, p.courierId, p.toStatus));
registerHandler('completeDelivery', (p) =>
  adapter.completeDelivery(p.orderId, p.courierId, p.proof)
);
registerHandler('cancelOrder', (p) => adapter.cancelOrder(p.orderId, p.courierId, p.reason));
registerHandler('declareCashHandoff', (p) => adapter.declareCashHandoff(p.courierId, p.amount));
registerHandler('setCourierStatus', (p) => adapter.setCourierStatus(p.courierId, p.status));

export { flush };
