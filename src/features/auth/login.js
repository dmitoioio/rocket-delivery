/** Екран логіна. Самореєстрації немає — облікові записи створює адмін (ADR-0004). */

import * as db from '../../lib/db.js';
import { setState } from '../../lib/store.js';
import { toast, haptic } from '../shared/toast.js';
import { esc } from '../../lib/format.js';

export function render() {
  return `<div class="login">
    <h1 class="login__logo">Rocket Delivery</h1>
    <p class="login__sub">Доставка CSTL LIFE · Олика</p>

    <form id="login-form" novalidate>
      <div class="field">
        <label class="field__label" for="login">Логін</label>
        <input class="input" id="login" name="login" autocomplete="username"
               autocapitalize="none" spellcheck="false" required>
      </div>
      <div class="field">
        <label class="field__label" for="password">Пароль</label>
        <input class="input" id="password" name="password" type="password"
               autocomplete="current-password" required>
      </div>
      <div id="login-error"></div>
      <button class="btn btn-rocket" type="submit" id="login-submit">Увійти</button>
    </form>

    ${devHint()}
  </div>`;
}

/**
 * Демо-доступи приходять з адаптера і показуються ТІЛЬКИ на моковому
 * бекенді. У продакшн-збірці цей адаптер не існує взагалі, тож ні доступів,
 * ні підказки в бандлі немає (B18). CI перевіряє це окремим кроком.
 */
function devHint() {
  if (!db.demoCredentials) return '';

  const rows = db.demoCredentials
    .map(
      (c) =>
        `<div class="row" style="margin-top:6px">
           <span class="mut">${esc(c.role)}</span>
           <span class="num tiny">${esc(c.login)} / ${esc(c.password)}</span>
         </div>`
    )
    .join('');

  return `<div class="callout callout--info" style="margin-top:24px">
    <strong>Демо-режим.</strong> Дані живуть у памʼяті браузера й скидаються
    при перезавантаженні.
    ${rows}
  </div>`;
}

export function mount(root) {
  const form = root.querySelector('#login-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('#login-submit');
    const errorBox = form.querySelector('#login-error');
    const login = form.login.value.trim();
    const password = form.password.value;

    if (!login || !password) {
      errorBox.innerHTML = `<div class="callout callout--warn">Заповни обидва поля</div>`;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Вхід…';
    errorBox.innerHTML = '';

    try {
      const session = await db.signIn(login, password);
      haptic('ok');
      setState({ session, route: session.role === 'admin' ? 'admin/dashboard' : 'courier/queue' });
    } catch (error) {
      haptic('error');
      errorBox.innerHTML = `<div class="callout callout--warn">${esc(error.message)}</div>`;
      btn.disabled = false;
      btn.textContent = 'Увійти';
      toast(error.message, 'danger');
    }
  });
}
