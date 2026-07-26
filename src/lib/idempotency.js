/**
 * Ключі ідемпотентності.
 *
 * ⚠️ Ключ генерується В МОМЕНТ ДІЇ КОРИСТУВАЧА, не в момент відправки.
 * Інакше ретрай створить новий ключ, і сервер порахує його другою дією —
 * подвійне скасування, подвійне нарахування, подвійна здача готівки.
 */

export function newKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Обгортка для дій з UI: ключ створюється один раз тут і далі мандрує
 * з дією через усі ретраї.
 * @template T
 * @param {(key: string) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withKey(fn) {
  return fn(newKey());
}
