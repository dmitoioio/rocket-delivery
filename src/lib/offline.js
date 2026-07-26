/**
 * Черга відкладених дій — docs/12-technical-design.md, розділ 7.
 *
 * Село. Звʼязок падає — це норма, не виняток. Курʼєр тисне «доставлено»
 * без мережі, і дія має виконатись пізніше, а не зникнути.
 *
 * ⚠️ ВЗЯТТЯ ЗАМОВЛЕННЯ СЮДИ НЕ ПОТРАПЛЯЄ. Це єдина дія, яку не можна
 * відкладати: поки курʼєр офлайн, замовлення забере інший. Відкладене
 * взяття означає, що через 10 хвилин він поїде за чужим замовленням.
 */

import { setState, getState } from './store.js';
import { toAppError } from './errors.js';

const DB_NAME = 'rocket-delivery';
const STORE = 'outbox';
const MAX_ATTEMPTS = 5;

/** Пам'ятний фолбек, якщо IndexedDB недоступна (приватний режим тощо). */
let memory = [];
let useMemory = false;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no-idb'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  if (useMemory) return fn(null);
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const result = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
    });
  } catch {
    useMemory = true;
    return fn(null);
  }
}

async function readAll() {
  if (useMemory) return [...memory];
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    useMemory = true;
    return [...memory];
  }
}

async function syncStateFromStore() {
  const items = await readAll();
  items.sort((a, b) => a.createdAt - b.createdAt);
  setState({ outbox: items });
  return items;
}

/**
 * Поставити дію в чергу.
 * @param {{type: string, payload: object, idempotencyKey: string, orderId?: string}} action
 */
export async function enqueue(action) {
  const item = {
    id: action.idempotencyKey,
    type: action.type,
    payload: action.payload,
    orderId: action.orderId || null,
    idempotencyKey: action.idempotencyKey,
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
    failed: false,
  };

  if (useMemory) memory.push(item);
  else await tx('readwrite', (s) => s && s.put(item));

  await syncStateFromStore();
  return item;
}

async function remove(id) {
  if (useMemory) memory = memory.filter((x) => x.id !== id);
  else await tx('readwrite', (s) => s && s.delete(id));
}

async function update(item) {
  if (useMemory) memory = memory.map((x) => (x.id === item.id ? item : x));
  else await tx('readwrite', (s) => s && s.put(item));
}

/** @type {Map<string, (payload: object, key: string) => Promise<unknown>>} */
const handlers = new Map();

/** Реєстрація обробника типу дії. Заповнюється з db.js. */
export function registerHandler(type, fn) {
  handlers.set(type, fn);
}

let flushing = false;

/**
 * Спробувати відправити все, що накопичилось.
 *
 * Порядок збережений: дії по ОДНОМУ замовленню відправляються послідовно,
 * інакше on_the_way може випередити picked_up і сервер відхилить перехід.
 */
export async function flush() {
  if (flushing) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  flushing = true;
  try {
    const items = await syncStateFromStore();
    /** @type {Set<string>} замовлення, по яких уже стався збій у цьому проході */
    const blocked = new Set();

    for (const item of items) {
      if (item.failed) continue;
      if (item.orderId && blocked.has(item.orderId)) continue;

      const handler = handlers.get(item.type);
      if (!handler) {
        await remove(item.id);
        continue;
      }

      try {
        await handler(item.payload, item.idempotencyKey);
        await remove(item.id);
      } catch (e) {
        const error = toAppError(e);
        const next = {
          ...item,
          attempts: item.attempts + 1,
          lastError: error.message,
          // Неповторювані помилки (валідація, конфлікт) не має сенсу
          // ретраїти — одразу показуємо курʼєру
          failed: !error.retryable || item.attempts + 1 >= MAX_ATTEMPTS,
        };
        await update(next);
        if (item.orderId) blocked.add(item.orderId);
        if (!error.retryable) continue;
        break; // мережа лягла — далі немає сенсу
      }
    }

    await syncStateFromStore();
  } finally {
    flushing = false;
  }
}

/** Прибрати проблемний елемент (курʼєр натиснув «скасувати»). */
export async function discard(id) {
  await remove(id);
  await syncStateFromStore();
}

/** Повторити проблемний елемент (курʼєр натиснув «спробувати ще»). */
export async function retry(id) {
  const items = await readAll();
  const item = items.find((x) => x.id === id);
  if (!item) return;
  await update({ ...item, failed: false, attempts: 0, lastError: null });
  await flush();
}

/** Скільки дій чекає на відправку (без проблемних). */
export function pendingCount() {
  return getState().outbox.filter((x) => !x.failed).length;
}

export function failedItems() {
  return getState().outbox.filter((x) => x.failed);
}

let started = false;

/** Автовідправка: при появі мережі, при поверненні з фону, за таймером. */
export function start() {
  if (started || typeof window === 'undefined') return;
  started = true;

  window.addEventListener('online', () => {
    setState({ connection: 'online' });
    flush();
  });

  window.addEventListener('offline', () => setState({ connection: 'offline' }));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flush();
  });

  setInterval(flush, 20000);
  syncStateFromStore().then(flush);
}
