/**
 * Замовлення: створення руками і керування кухнею.
 *
 * ⚠️ Це ПРОДАКШН-код, не демо. Він існує тому, що без нього застосунок
 * на живій базі непридатний: поверхні клієнта й закладу належать cstllife
 * (ADR-0001), і поки той не підключений, замовлення нема кому створити,
 * а «готово до забору» нема кому натиснути. Курʼєр бачив би порожню
 * чергу назавжди.
 *
 * Обґрунтування й умова зняття — ADR-0012.
 *
 * Викликається та сама функція `place_order`, яку викликатиме cstllife.
 * Тобто радіус, графік і генерація коду підтвердження проходять один
 * шлях: те, що працює тут, працюватиме і в них.
 */

import * as db from '../../lib/db.js';
import { getState, setState } from '../../lib/store.js';
import { toast } from '../shared/toast.js';
import { statusChip, emptyState, panel, esc, money, elapsed, time } from '../shared/ui.js';

/**
 * Населені пункти з готовими координатами.
 *
 * Піндроп на карті вимагає ключа провайдера тайлів (B20), якого ще немає.
 * На пілоті з кількох сіл список практичніший: адміну не треба нічого
 * шукати, а точка гарантовано в межах радіуса. Для адреси поза списком
 * є поле «вставити з Google Maps».
 */
export const LOCALITIES = [
  { name: 'с. Дідичі', lat: 50.75083, lng: 25.80328 },
  { name: 'с. Метельне', lat: 50.69161, lng: 25.81878 },
  { name: 'с. Романів', lat: 50.6612, lng: 25.9014 },
  { name: 'смт Олика', lat: 50.7192, lng: 25.8125 },
  { name: 'с. Забороль', lat: 50.7405, lng: 25.7712 },
];

/** «50.7100, 25.8300» або «50.7100,25.8300» — те, що дає Google Maps. */
export function parseCoords(text) {
  const m = String(text || '')
    .trim()
    .match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/* ── Екран ──────────────────────────────────────────────────────────────── */

export function render(a) {
  const active = a.orders.filter((o) =>
    ['placed', 'accepted_by_business', 'preparing', 'ready'].includes(o.status)
  );

  return newOrderForm(a) + kitchen(active);
}

function newOrderForm(a) {
  const f = getState().newOrder || {};

  return panel(
    'Нове замовлення',
    a.business?.name || 'Заклад',
    `<div class="panel__body">
      <div class="field">
        <label class="field__label" for="no-name">Імʼя клієнта</label>
        <input class="input" id="no-name" value="${esc(f.clientName || '')}" autocomplete="off">
      </div>

      <div class="field">
        <label class="field__label" for="no-phone">Телефон</label>
        <input class="input num" id="no-phone" type="tel" inputmode="tel"
               placeholder="+380XXXXXXXXX" value="${esc(f.clientPhone || '')}">
      </div>

      <div class="field">
        <label class="field__label" for="no-locality">Населений пункт</label>
        <select class="input" id="no-locality">
          ${LOCALITIES.map(
            (l) =>
              `<option value="${esc(l.name)}" ${f.locality === l.name ? 'selected' : ''}>${esc(l.name)}</option>`
          ).join('')}
        </select>
      </div>

      <div class="field">
        <label class="field__label" for="no-address">Вулиця й будинок</label>
        <input class="input" id="no-address" placeholder="вул. Лісова 12"
               value="${esc(f.street || '')}">
      </div>

      <div class="field">
        <label class="field__label" for="no-landmark">Орієнтир</label>
        <input class="input" id="no-landmark" placeholder="зелені ворота, за магазином"
               value="${esc(f.landmark || '')}">
        <div class="tiny" style="margin-top:5px">
          У селі без нумерації орієнтир важливіший за адресу — курʼєр шукає по ньому.
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="no-coords">Точні координати</label>
        <input class="input num" id="no-coords" placeholder="50.7100, 25.8300"
               value="${esc(f.coords || '')}">
        <div class="tiny" style="margin-top:5px">
          Необовʼязково. Порожнє — візьметься центр населеного пункту.
          У Google Maps: довгий тап по точці → координати копіюються.
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="no-total">Сума замовлення, ₴</label>
        <input class="input num" id="no-total" inputmode="numeric" placeholder="320"
               value="${esc(f.itemsTotal || '')}">
        <div class="tiny" style="margin-top:5px">
          Без доставки — ${esc(money(db.config.deliveryFee))} додасться автоматично.
        </div>
      </div>

      <div class="h-sec">Оплата</div>
      <div class="seg">
        <button data-action="no-pay" data-value="cash"
          aria-selected="${(f.paymentMethod || 'cash') === 'cash'}">Готівкою курʼєру</button>
        <button data-action="no-pay" data-value="online"
          aria-selected="${f.paymentMethod === 'online'}">Оплачено онлайн</button>
      </div>

      <button class="btn btn-rocket" data-action="create-order" style="margin-top:18px">
        Створити замовлення
      </button>

      <div class="tiny" style="margin-top:10px">
        Радіус доставки й графік закладу перевіряє сервер — те саме, що
        перевірятиме для замовлень із cstllife.
      </div>
    </div>`
  );
}

/* ── Кухня ──────────────────────────────────────────────────────────────── */

function kitchen(active) {
  if (!active.length) {
    return panel(
      'У роботі',
      'Немає замовлень',
      `<div class="panel__body">${emptyState({
        icon: 'clock',
        title: 'Черга порожня',
        text: 'Створи замовлення вище — воно зʼявиться тут і піде далі до курʼєрів.',
      })}</div>`
    );
  }

  return panel(
    'У роботі',
    `${active.length} ${active.length === 1 ? 'замовлення' : 'замовлень'}`,
    `<div class="panel__body">${active.map(card).join('')}</div>`
  );
}

function card(o) {
  const isNew = o.status === 'placed';
  const cooking = ['accepted_by_business', 'preparing'].includes(o.status);
  const waiting = o.status === 'ready';

  return `<article class="card ${isNew ? 'card--hot' : ''}" style="margin-bottom:12px">
    <div class="row">
      <span class="num tiny">${esc(o.code)}</span>
      ${statusChip(o.status)}
    </div>
    <div class="strong" style="margin-top:9px">
      ${esc(o.destLocality || '')} · ${esc(money(o.total))}
    </div>
    <div class="tiny">${esc(o.destAddressText || '')}</div>
    ${o.destLandmark ? `<div class="landmark">${esc(o.destLandmark)}</div>` : ''}

    ${
      isNew
        ? `<div class="h-sec" style="margin:14px 0 8px">Буде готово через</div>
           <div class="row" style="gap:8px">
             ${[10, 20, 30, 45]
               .map(
                 (m) => `<button class="btn btn-ghost btn-sm" style="flex:1"
                   data-action="kitchen-accept" data-id="${esc(o.id)}" data-mins="${m}">${m} хв</button>`
               )
               .join('')}
           </div>
           <button class="btn btn-danger" data-action="kitchen-reject" data-id="${esc(o.id)}"
                   style="margin-top:10px">Не можемо виконати</button>`
        : ''
    }

    ${
      cooking
        ? `<div class="row" style="margin-top:12px">
             <span class="mut">${o.estimatedReadyAt ? `Обіцяно на ${esc(time(o.estimatedReadyAt))}` : 'Готується'}</span>
           </div>
           <button class="btn btn-rocket" data-action="kitchen-ready" data-id="${esc(o.id)}"
                   style="margin-top:10px">Готово до забору</button>`
        : ''
    }

    ${
      waiting
        ? `<div class="tiny" style="margin-top:10px">
             Чекає курʼєра ${esc(elapsed(o.readyAt))} — уже видно в черзі
           </div>`
        : ''
    }
  </article>`;
}

/* ── Дії ────────────────────────────────────────────────────────────────── */

/** Читає форму з DOM: стан перемальовується цілком, і введене загубилось би. */
function readForm() {
  const v = (id) => document.getElementById(id)?.value?.trim() || '';
  return {
    clientName: v('no-name'),
    clientPhone: v('no-phone'),
    locality: v('no-locality'),
    street: v('no-address'),
    landmark: v('no-landmark'),
    coords: v('no-coords'),
    itemsTotal: v('no-total'),
    paymentMethod: getState().newOrder?.paymentMethod || 'cash',
  };
}

export async function handle(action, el) {
  switch (action) {
    case 'no-pay':
      setState({ newOrder: { ...readForm(), paymentMethod: el.dataset.value } });
      return true;

    case 'create-order':
      await createOrder();
      return true;

    case 'kitchen-accept':
      return kitchenAction(
        () => db.businessAcceptOrder(el.dataset.id, Number(el.dataset.mins)),
        `Прийнято, готово через ${el.dataset.mins} хв`
      );

    case 'kitchen-ready':
      return kitchenAction(
        () => db.businessMarkReady(el.dataset.id),
        'Замовлення в черзі курʼєрів'
      );

    case 'kitchen-reject':
      return kitchenAction(
        () => db.businessRejectOrder(el.dataset.id, 'out_of_stock'),
        'Відхилено'
      );

    default:
      return false;
  }
}

async function kitchenAction(run, okMessage) {
  try {
    await run();
    toast(okMessage, 'ok');
  } catch (error) {
    toast(error.message, 'danger', 4000);
  }
  return true;
}

async function createOrder() {
  const f = readForm();

  if (!f.clientName) return toast('Вкажи імʼя клієнта', 'danger');
  if (!f.clientPhone) return toast('Вкажи телефон — курʼєр має куди подзвонити', 'danger');
  const total = Number(f.itemsTotal);
  if (!Number.isFinite(total) || total <= 0) return toast('Вкажи суму замовлення', 'danger');

  const preset = LOCALITIES.find((l) => l.name === f.locality) || LOCALITIES[0];
  const exact = f.coords ? parseCoords(f.coords) : null;
  if (f.coords && !exact) {
    return toast('Координати у форматі 50.7100, 25.8300', 'danger', 4000);
  }
  const point = exact || preset;

  // Стан зберігаємо ДО запиту: якщо сервер відмовить (радіус, графік),
  // введене має лишитись на екрані, а не зникнути разом із помилкою
  setState({ newOrder: f });

  try {
    const order = await db.createOrder({
      businessRef: getState().admin?.business?.externalRef || getState().admin?.business?.id,
      items: [],
      itemsTotal: total,
      paymentMethod: f.paymentMethod,
      clientName: f.clientName,
      clientPhone: f.clientPhone,
      destAddressText: `${f.locality}, ${f.street}`.replace(/, $/, ''),
      destLocality: f.locality,
      destLat: point.lat,
      destLng: point.lng,
      destLandmark: f.landmark || null,
      idempotencyKey: `admin-${Date.now()}`,
    });

    setState({ newOrder: null });
    toast(`${order.code} створено`, 'ok', 3200);
  } catch (error) {
    toast(error.message, 'danger', 5000);
  }
}
