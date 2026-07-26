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

/** Обовʼязкові змінні середовища для реального бекенду. */
const REQUIRED_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

/**
 * Падати голосно й одразу, а не через три екрани з незрозумілою помилкою.
 * @returns {string[]} перелік відсутніх змінних
 */
export function missingEnv() {
  return REQUIRED_ENV.filter((k) => !process.env[k]);
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
  if (process.env.VITE_APP_ENV !== 'production') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* PWA-офлайн необовʼязковий для роботи застосунку */
    });
  });
}

if (typeof document !== 'undefined') {
  boot();
}
