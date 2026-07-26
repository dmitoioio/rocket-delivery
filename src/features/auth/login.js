/** Екран логіна. Самореєстрації немає — облікові записи створює адмін (ADR-0004). */

import * as db from '../../lib/db.js';
import * as demo from '#demo';
import { setState } from '../../lib/store.js';
import { toast, haptic } from '../shared/toast.js';
import { esc } from '../../lib/format.js';

export function render() {
  return `<div class="login">
    <h1 class="login__logo">Rocket Delivery</h1>
    <p class="login__sub">Доставка CSTL LIFE · Олика</p>

    ${demo.roleButtons()}
    ${demo.wrapManualForm(loginForm())}
    ${demo.notice()}
  </div>`;
}

function loginForm() {
  return `<form id="login-form" novalidate>
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
      <button class="btn ${demo.isDemo ? 'btn-ghost' : 'btn-rocket'}" type="submit"
              id="login-submit">Увійти</button>
    </form>`;
}

/* ── Поведінка ──────────────────────────────────────────────────────────── */

export function mount(root) {
  demo.attach(root, enter);

  const form = root.querySelector('#login-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const login = form.login.value.trim();
    const password = form.password.value;

    if (!login || !password) {
      form.querySelector('#login-error').innerHTML =
        `<div class="callout callout--warn">Заповни обидва поля</div>`;
      return;
    }
    enter(login, password, form.querySelector('#login-submit'), form);
  });
}

/**
 * @param {string} login
 * @param {string} password
 * @param {HTMLElement} btn кнопка, яку блокуємо на час запиту
 * @param {HTMLFormElement} [form] щоб показати помилку в потрібному місці
 */
async function enter(login, password, btn, form) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Вхід…';
  form?.querySelector('#login-error')?.replaceChildren();

  try {
    const session = await db.signIn(login, password);
    haptic('ok');
    setState({ session, route: session.role === 'admin' ? 'admin/dashboard' : 'courier/queue' });
  } catch (error) {
    haptic('error');
    btn.disabled = false;
    btn.innerHTML = original;

    const box = form?.querySelector('#login-error');
    if (box) box.innerHTML = `<div class="callout callout--warn">${esc(error.message)}</div>`;
    else toast(error.message, 'danger');
  }
}
