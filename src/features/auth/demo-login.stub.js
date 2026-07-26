/**
 * Заглушка демо-входу для продакшн-збірки.
 *
 * Підставляється замість demo-login.js, коли VITE_APP_ENV=production.
 * Завдяки цьому ні кнопок ролей, ні демо-тексту, ні доступів у бандлі
 * немає взагалі — не як мертвий код, а фізично (B18). CI це перевіряє.
 */

export const isDemo = false;

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
