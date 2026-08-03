/**
 * Rocket Delivery — точка входу.
 *
 * Курʼєрський застосунок платформи cstllife (м. Олика, Волинська обл.).
 * Документація: docs/ — почати з docs/README.md
 */

import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';

import { start } from './shell.js';
import { backendName } from '../lib/db.js';

/**
 * Обовʼязкові змінні середовища для реального бекенду.
 *
 * 🛑 Звертання СТАТИЧНІ й по одному. Це не стиль, а умова роботи:
 * `process` у браузері не існує, значення підставляє збірник (esbuild
 * `define`, scripts/config.mjs) — а підставити він уміє лише буквальне
 * `process.env.ІМʼЯ`. Було `REQUIRED_ENV.filter((k) => !process.env[k])`:
 * імʼя приходило змінною, підставляти було нічого, слово `process`
 * лишалось у бандлі, і продакшн падав `process is not defined` ДО
 * першого рядка розмітки — білий екран.
 *
 * Не спіймалось, бо в demo цієї гілки немає взагалі (там моковий бекенд),
 * а CI перевіряв ВМІСТ продакшн-бандла, жодного разу його не відкривши.
 * Тепер відкриває — scripts/smoke-prod.mjs.
 */
const REQUIRED_ENV = {
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
};

/**
 * Падати голосно й одразу, а не через три екрани з незрозумілою помилкою.
 * @returns {string[]} перелік відсутніх змінних
 */
export function missingEnv() {
  return Object.keys(REQUIRED_ENV).filter((k) => !REQUIRED_ENV[k]);
}

function boot() {
  const root = document.getElementById('app');
  if (!root) return;

  // Моковий бекенд працює без жодних ключів — це і є сенс dev-режиму
  if (backendName !== 'mock') {
    const missing = missingEnv();
    if (missing.length) {
      root.innerHTML = `<div class="empty">
        <div class="empty__icon">🔧</div>
        <div class="empty__title">Не задані змінні середовища</div>
        <div class="mono">${missing.join(', ')}</div>
        <div style="margin-top:12px">Скопіюй <code>.env.example</code> у <code>.env</code> і заповни.</div>
      </div>`;
      return;
    }
  }

  start(root);
  registerServiceWorker();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Локальна розробка без SW: інакше він кешує оболонку й ховає зміни
  const env = process.env.VITE_APP_ENV;
  if (env !== 'production' && env !== 'demo') return;

  window.addEventListener('load', () => {
    // Відносний шлях: на GitHub Pages scope — це підкаталог, не корінь
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* PWA-офлайн необовʼязковий для роботи застосунку */
    });
  });
}

if (typeof document !== 'undefined') {
  boot();
}
