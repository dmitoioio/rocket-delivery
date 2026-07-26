/**
 * Вхід одним кліком — ТІЛЬКИ для демо-режиму.
 *
 * ⚠️ ЦЕЙ ФАЙЛ НЕ ПОТРАПЛЯЄ У ПРОДАКШН-ЗБІРКУ.
 * scripts/config.mjs підставляє замість нього demo-login.stub.js, коли
 * VITE_APP_ENV=production — той самий механізм, що й для адаптера даних.
 *
 * Чому саме підміна модуля, а не перевірка `if (demoCredentials)`:
 * esbuild не згортає імпортовану константу в умові, тож розмітка кнопок
 * і демо-текст лишались у продакшн-бандлі мертвим кодом. Гарантія має
 * бути структурною, а не залежати від поведінки мініфікатора (B18).
 */

import { demoCredentials } from '#adapter';
import { icons } from '../shared/icons.js';
import { esc } from '../../lib/format.js';

export const isDemo = true;

/** Дві рівноцінні кнопки вибору ролі — це перемикач, а не дві головні дії. */
export function roleButtons() {
  if (!demoCredentials) return '';

  return `<div class="h-sec" style="margin-top:0">Увійти як</div>
    ${demoCredentials
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
      .join('')}`;
}

export function notice() {
  return `<div class="callout callout--info" style="margin-top:24px">
    <strong>Демо-режим.</strong> Бекенду немає: дані живуть у памʼяті браузера
    й скидаються при перезавантаженні. Замовлення, курʼєри й гроші вигадані.
  </div>`;
}

/** Обгортає ручну форму в розкриття: у демо вона другорядна. */
export function wrapManualForm(formHtml) {
  return `<details class="login__manual">
    <summary>Увійти логіном і паролем</summary>
    ${formHtml}
  </details>`;
}

/**
 * @param {HTMLElement} root
 * @param {(login: string, password: string, btn: HTMLElement) => void} onEnter
 */
export function attach(root, onEnter) {
  for (const btn of root.querySelectorAll('[data-demo]')) {
    btn.addEventListener('click', () => {
      const cred = demoCredentials?.[Number(btn.dataset.demo)];
      if (cred) onEnter(cred.login, cred.password, btn);
    });
  }
}
