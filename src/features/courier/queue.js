/**
 * Черга замовлень — найважливіший екран курʼєра.
 * Тут він заробляє і тут відбувається конкуренція (ADR-0009).
 */

import { queueCard, emptyState, errorState, skeletonList } from '../shared/ui.js';
import { money } from '../../lib/format.js';

export function render(state) {
  const { status, error, queue, courier } = state;

  if (status === 'loading' && !queue.length) return skeletonList(3);
  if (status === 'error' && !queue.length) return errorState(error, 'reload');

  if (!queue.length) {
    return emptyState({
      icon: '🍣',
      title: 'Замовлень поки немає',
      text: 'Зазвичай найбільше замовлень з 18:00 до 21:00. Застосунок сповістить звуком.',
    });
  }

  const cashBlocked = isCashBlocked(courier);
  const hasActive = state.active.length >= (courier?.maxActiveOrders ?? 1);

  const notice = hasActive
    ? `<div class="notice notice--warn">Спочатку заверши поточне замовлення</div>`
    : cashBlocked
      ? `<div class="notice notice--warn">Ліміт готівки вичерпано — здай готівку,
         щоб брати замовлення з оплатою готівкою</div>`
      : '';

  return notice + queue.map((order) => cardFor(order, { hasActive, cashBlocked })).join('');
}

function cardFor(order, { hasActive }) {
  // Спосіб оплати в черзі не показується (B35), тож заблокувати картку
  // саме через ліміт готівки тут неможливо — це робить сервер при взятті
  // і повертає зрозумілу помилку.
  return queueCard(order, {
    disabled: hasActive && order.status === 'ready',
    disabledReason: 'Заверши поточне замовлення',
  });
}

function isCashBlocked(courier) {
  if (!courier) return false;
  return courier.cashOnHand >= courier.cashLimit;
}

/** Підказка для профілю: скільки лишилось до блокування. */
export function cashHeadroom(courier) {
  if (!courier) return '';
  return money(Math.max(0, courier.cashLimit - courier.cashOnHand));
}
