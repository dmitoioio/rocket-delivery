/**
 * Черга замовлень — найважливіший екран кур'єра.
 * Тут він заробляє і тут відбувається конкуренція (ADR-0009).
 */

import { queueCard, emptyState, errorState, skeletonList, esc, money } from '../shared/ui.js';
import { statusChip } from '../shared/ui.js';
import { deliveries } from '../../lib/format.js';

export function render(state) {
  const { status, error, queue, courier } = state;

  if (status === 'loading' && !queue.length) return greeting(courier) + skeletonList(2);
  if (status === 'error' && !queue.length) return greeting(courier) + errorState(error, 'reload');

  const ready = queue.filter((o) => o.status === 'ready');
  const soon = queue.filter((o) => o.status !== 'ready');
  const hasActive = state.active.length >= (courier?.maxActiveOrders ?? 1);

  if (!queue.length) {
    return (
      greeting(courier) +
      stats(courier, 0) +
      emptyState({
        icon: 'clock',
        title: 'Замовлень поки немає',
        text: 'Найбільше замовлень з 18:00 до 21:00. Застосунок сповістить, коли зʼявиться нове.',
      })
    );
  }

  return [
    greeting(courier),
    stats(courier, ready.length),
    ready.length
      ? `<div class="h-sec">Готові до забору · ${ready.length}</div>` +
        ready
          .map((o, i) =>
            queueCard(o, {
              hot: i === 0 && !hasActive,
              disabled: hasActive,
              disabledReason: 'Заверши поточне замовлення',
            })
          )
          .join('')
      : '',
    soon.length
      ? `<div class="h-sec">Скоро будуть готові · ${soon.length}</div>` +
        soon.map((o) => queueCard(o)).join('')
      : '',
  ].join('');
}

function greeting(courier) {
  const name = courier?.fullName?.split(/\s+/)[0] || '';
  const online = courier?.status === 'online';
  return `<div class="row" style="padding:2px 0 16px">
    <div>
      <div class="mid">Привіт${name ? `, ${esc(name)}` : ''}</div>
      <div class="tiny">Електроскутер · борт 07</div>
    </div>
    ${online ? statusChip('delivered', 'на лінії') : statusChip('overdue', 'офлайн')}
  </div>`;
}

/** Заробіток дня — головне число. Кур'єр має бачити свої гроші щодня. */
function stats(courier, inQueue) {
  const count = courier?.todayCount ?? 0;
  const amount = courier?.todayAmount ?? 0;
  return `<div class="card trio">
    <div><div class="mid num">${esc(count)}</div><div class="tiny">${esc(deliveries(count).replace(/^\d+\s/, ''))}</div></div>
    <div><div class="mid num accent">${esc(money(amount))}</div><div class="tiny">заробіток</div></div>
    <div><div class="mid num">${esc(inQueue)}</div><div class="tiny">у черзі</div></div>
  </div>`;
}
