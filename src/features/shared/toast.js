/**
 * Тости.
 *
 * ⚠️ Програш гонки за замовлення показується САМЕ тостом, не модалкою.
 * Модалку треба закрити, щоб узяти наступне замовлення — поки курʼєр її
 * закриває, він програє й другу гонку (docs/13-ux-design.md, розділ 5).
 */

import { esc } from '../../lib/format.js';

let host = null;

function getHost() {
  if (host?.isConnected) return host;
  host = document.createElement('div');
  host.className = 'toast-host';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  document.body.appendChild(host);
  return host;
}

/**
 * @param {string} message
 * @param {'info'|'ok'|'danger'} [kind]
 * @param {number} [ms]
 */
export function toast(message, kind = 'info', ms = 2600) {
  const node = document.createElement('div');
  node.className = `toast${kind === 'info' ? '' : ` toast--${kind}`}`;
  node.innerHTML = esc(message);
  getHost().appendChild(node);

  setTimeout(() => {
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 200);
  }, ms);
}

/**
 * Тактильний відгук. Курʼєр у рукавичках може не побачити зміну — але відчує.
 * @param {'ok'|'error'|'tap'} kind
 */
export function haptic(kind = 'tap') {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  const patterns = { ok: [18, 40, 18], error: [60], tap: [12] };
  navigator.vibrate(patterns[kind] || patterns.tap);
}
