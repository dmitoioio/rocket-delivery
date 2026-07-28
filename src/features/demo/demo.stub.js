/**
 * Заглушка демо-режиму для продакшн-збірки.
 *
 * Підставляється замість demo.js, коли VITE_APP_ENV=production.
 * Завдяки цьому ні кнопок ролей, ні демо-тексту, ні доступів, ні підказки
 * з кодом клієнта в бандлі немає взагалі — не як мертвий код, а фізично
 * (B18). CI це перевіряє.
 */

export const isDemo = false;

/** Поверхонь cstllife у продакшн-збірці Rocket Delivery не існує (ADR-0001). */
export const surfaces = {};
export const extraRoles = [];

/** У продакшені курʼєр коду клієнта не знає — і не має знати (B41). */
export function pinHint() {
  return '';
}

export function roleButtons() {
  return '';
}

export function notice() {
  return '';
}

/** У продакшені ручна форма — єдиний спосіб входу, тож без розкриття. */
export function wrapManualForm(formHtml) {
  return formHtml;
}

export function attach() {}

/** У продакшені демо-дій не існує — оболонка нічого не обробляє. */
export function handleGlobal() {
  return false;
}
