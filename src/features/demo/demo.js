/**
 * Усе, що існує ТІЛЬКИ в демо-режимі: вхід одним кліком і підказки,
 * які в реальній системі знає лише клієнт.
 *
 * ⚠️ ЦЕЙ ФАЙЛ НЕ ПОТРАПЛЯЄ У ПРОДАКШН-ЗБІРКУ.
 * scripts/config.mjs підставляє замість нього demo.stub.js, коли
 * VITE_APP_ENV=production — той самий механізм, що й для адаптера даних.
 *
 * Чому саме підміна модуля, а не перевірка `if (demoCredentials)`:
 * esbuild не згортає імпортовану константу в умові, тож розмітка кнопок
 * і демо-текст лишались у продакшн-бандлі мертвим кодом. Гарантія має
 * бути структурною, а не залежати від поведінки мініфікатора (B18).
 */

import { demoCredentials, demoPinFor, resetDemo } from '#adapter';
import { icons } from '../shared/icons.js';
import { toast } from '../shared/toast.js';
import { esc } from '../../lib/format.js';
import * as business from './business.js';
import * as client from './client.js';

export const isDemo = true;

/**
 * Поверхні, які в реальній системі належать cstllife (ADR-0001).
 *
 * Роутер бере їх звідси, тож у продакшн-збірці, де підставляється
 * demo.stub.js, вони не існують — ні як екрани, ні як імпорти.
 */
export const surfaces = { business, client };

/** Ролі, доступні для входу одним кліком у демо. */
export const extraRoles = [
  {
    key: 'client',
    label: 'Клієнт',
    name: 'Оформити замовлення · бачить код',
    route: 'client/order',
  },
  {
    key: 'business',
    label: 'Заклад',
    name: 'Суші Мар · кухня і готівка',
    route: 'business/kitchen',
  },
];

/** Дві рівноцінні кнопки вибору ролі — це перемикач, а не дві головні дії. */
export function roleButtons() {
  if (!demoCredentials) return '';

  const rocket = demoCredentials
    .map(
      (c, i) => `<button class="btn ${c.role === 'admin' ? 'btn-dark' : 'btn-rocket'} btn-role"
          data-demo="${i}">
        ${c.role === 'admin' ? icons.dashboard(20) : icons.active(20)}
        <span class="btn-role__text">
          <span class="btn-role__title">${esc(c.label)}</span>
          <span class="btn-role__sub">${esc(c.name)}</span>
        </span>
      </button>`
    )
    .join('');

  const cstl = extraRoles
    .map(
      (r) => `<button class="btn btn-cstl btn-role" data-role="${esc(r.key)}"
          data-route="${esc(r.route)}">
        ${r.key === 'client' ? icons.profile(20) : icons.cash(20)}
        <span class="btn-role__text">
          <span class="btn-role__title">${esc(r.label)}</span>
          <span class="btn-role__sub">${esc(r.name)}</span>
        </span>
      </button>`
    )
    .join('');

  return `<div class="h-sec" style="margin-top:0">Rocket Delivery</div>${rocket}
    <div class="h-sec">Симуляція cstllife</div>${cstl}`;
}

export function notice() {
  return `<div class="callout callout--info" style="margin-top:24px">
    <strong>Демо-режим.</strong> Бекенду немає: дані живуть у сховищі браузера
    й переживають перезавантаження. Замовлення, курʼєри й гроші вигадані.
    <button class="btn btn-ghost btn-sm" data-action="reset-demo"
            style="margin-top:12px">Почати демо спочатку</button>
  </div>`;
}

/**
 * Дії, які існують лише в демо і спрацьовують поза будь-якою поверхнею.
 *
 * Скидання потрібне тому, що стан тепер переживає перезавантаження
 * (Фаза 1): без цієї кнопки з поламаного сценарію не було б виходу.
 *
 * @param {string} action
 * @returns {boolean} чи оболонці треба скинути стан застосунку
 */
export function handleGlobal(action) {
  if (action !== 'reset-demo') return false;
  resetDemo();
  toast('Демо почалось спочатку', 'ok');
  return true;
}

/** Обгортає ручну форму в розкриття: у демо вона другорядна. */
export function wrapManualForm(formHtml) {
  return `<details class="login__manual">
    <summary>Увійти логіном і паролем</summary>
    ${formHtml}
  </details>`;
}

/**
 * Підказка з кодом клієнта.
 *
 * У реальній системі курʼєр цього коду НЕ знає й знати не може — його
 * бачить лише клієнт на сторінці свого замовлення в cstllife. Тут підказка
 * існує тільки тому, що клієнтської поверхні ще немає, і без неї демо
 * неможливо пройти до кінця.
 *
 * @param {string} orderId
 */
export function pinHint(orderId) {
  const pin = demoPinFor?.(orderId);
  if (!pin) return '';
  return `<div class="tiny" style="text-align:center;margin-top:8px">
    Демо: клієнт назвав би <strong class="num">${esc(pin)}</strong>
  </div>`;
}

/**
 * @param {HTMLElement} root
 * @param {{credentials: Function, role: Function}} handlers
 */
export function attach(root, handlers) {
  for (const btn of root.querySelectorAll('[data-demo]')) {
    btn.addEventListener('click', () => {
      const cred = demoCredentials?.[Number(btn.dataset.demo)];
      if (cred) handlers.credentials(cred.login, cred.password, btn);
    });
  }

  // Клієнт і заклад — не облікові записи Rocket Delivery: у реальній
  // системі це користувачі cstllife зі своєю авторизацією. У демо
  // вхід у них прямий, без паролів.
  for (const btn of root.querySelectorAll('[data-role]')) {
    btn.addEventListener('click', () => {
      handlers.role(btn.dataset.role, btn.dataset.route);
    });
  }
}
