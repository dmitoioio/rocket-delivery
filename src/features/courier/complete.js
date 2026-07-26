/**
 * Завершення доставки — найвідповідальніший момент: гроші, чужа їжа, доказ.
 *
 * Порядок кроків не випадковий (docs/13-ux-design.md, розділ 7):
 *  1. Фото — найдовша дія, має статись, поки курʼєр ще біля клієнта
 *  2. PIN  — верифікація безглузда після того, як курʼєр поїхав
 *  3. Готівка — тільки для cash
 */

import { esc, money } from '../shared/ui.js';

export const STEPS = ['photo', 'pin', 'cash', 'done'];

export function sheet(state) {
  const flow = state.complete;
  if (!flow) return '';
  const order = state.active.find((o) => o.id === flow.orderId);
  if (!order) return '';

  const body =
    flow.step === 'photo'
      ? photoStep(flow)
      : flow.step === 'pin'
        ? pinStep(flow)
        : flow.step === 'cash'
          ? cashStep(order)
          : '';

  return `<div class="sheet-backdrop">
    <div class="sheet" role="dialog" aria-modal="true">
      ${body}
    </div>
  </div>`;
}

/* ── 1. Фото ────────────────────────────────────────────────────────────── */

function photoStep(flow) {
  if (!flow.photo) {
    return `
      <h2 class="sheet__title">Фото підтвердження</h2>
      <p class="hint" style="margin-bottom:16px">
        Сфотографуй передане замовлення. Без фото завершити доставку не можна.
      </p>
      <button class="btn btn--primary" data-action="take-photo">📷 ЗРОБИТИ ФОТО</button>
      <button class="btn btn--ghost" data-action="close-complete" style="margin-top:8px">Назад</button>`;
  }

  return `
    <h2 class="sheet__title">Фото готове</h2>
    <img class="photo-preview" src="${esc(flow.photo.preview)}" alt="Фото підтвердження доставки">
    <div class="hint" style="margin-bottom:16px">${esc(Math.round(flow.photo.bytes / 1024))} КБ</div>
    <button class="btn btn--primary" data-action="photo-next">ДАЛІ</button>
    <button class="btn btn--ghost" data-action="take-photo" style="margin-top:8px">Перезняти</button>`;
}

/* ── 2. PIN ─────────────────────────────────────────────────────────────── */

/**
 * Обхід PIN існує обовʼязково: клієнт забуде код, і без обходу курʼєр
 * застрягне під дверима з їжею. Обхід фіксується в журналі — це не дірка,
 * це керований виняток (B12).
 */
function pinStep(flow) {
  return `
    <h2 class="sheet__title">Код від клієнта</h2>
    <p class="hint" style="margin-bottom:16px">Попроси клієнта назвати 4 цифри з його замовлення.</p>
    <input class="input input--pin" id="pin-input" inputmode="numeric" pattern="[0-9]*"
           maxlength="4" autocomplete="off" value="${esc(flow.pin || '')}" aria-label="Код клієнта">
    ${flow.pinError ? `<div class="notice notice--danger" style="margin-top:12px">${esc(flow.pinError)}</div>` : ''}
    <button class="btn btn--primary" data-action="pin-next" style="margin-top:16px">ПІДТВЕРДИТИ</button>
    <button class="btn btn--ghost" data-action="pin-bypass" style="margin-top:8px">
      Клієнт не памʼятає код
    </button>`;
}

/* ── 3. Готівка ─────────────────────────────────────────────────────────── */

function cashStep(order) {
  return `
    <h2 class="sheet__title">Отримано готівку?</h2>
    <div class="card" style="margin-bottom:16px">
      <div class="card__total mono" style="text-align:center">${esc(money(order.total))}</div>
    </div>
    <p class="hint" style="margin-bottom:16px">
      Гроші належать закладу — здаси їх при наступному візиті.
    </p>
    <button class="btn btn--primary" data-action="cash-ok">ТАК, ОТРИМАВ</button>
    <button class="btn btn--danger" data-action="cash-problem" style="margin-top:8px">Проблема з оплатою</button>`;
}

/* ── Підсумок ───────────────────────────────────────────────────────────── */

export function successSheet(result) {
  return `<div class="sheet-backdrop" data-action="close-complete">
    <div class="sheet" role="dialog" aria-modal="true" data-stop style="text-align:center">
      <div class="empty__icon">✅</div>
      <h2 class="sheet__title">Доставлено</h2>
      <div class="card">
        <div class="line"><span class="line__label">Заробіток</span>
          <strong class="mono">${esc(money(result.earned))}</strong></div>
        ${
          result.cashOnHand
            ? `<div class="line"><span class="line__label">До здачі</span>
                 <strong class="mono">${esc(money(result.cashOnHand))}</strong></div>`
            : ''
        }
      </div>
      <button class="btn btn--primary" data-action="close-complete" style="margin-top:16px">ДАЛІ</button>
    </div>
  </div>`;
}
