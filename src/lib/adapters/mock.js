/**
 * Моковий адаптер даних — працює повністю в памʼяті браузера.
 *
 * ⚠️ ЦЕЙ ФАЙЛ НЕ ПОТРАПЛЯЄ У ПРОДАКШН-ЗБІРКУ.
 * scripts/build.mjs підставляє замість нього adapters/supabase.js, коли
 * VITE_APP_ENV=production. Тому демо-доступи нижче фізично відсутні
 * у продакшн-бандлі (баг B18), і CI це перевіряє.
 *
 * Призначення: дає повністю робочу бізнес-логіку до появи реальної схеми
 * Supabase. Уся поведінка тут — референс того, що має робити сервер.
 */

import { err } from '../errors.js';
import { distanceM } from '../geo.js';

/* ── Демо-доступи (тільки dev) ──────────────────────────────────────────── */

const USERS = [
  {
    login: 'rd-oleh-07',
    password: 'Skuter2607',
    role: 'courier',
    courierId: 'c1',
    mustChangePassword: false,
  },
  { login: 'boss-rocket', password: 'RocketBoss26', role: 'admin', adminId: 'a1' },
];

/**
 * Підказка на екрані логіна.
 *
 * Живе ТУТ, а не в features/auth/login.js: інакше доступи продублюються
 * в екрані й потраплять у продакшн-бандл в обхід підміни адаптера.
 * Саме так і сталось під час розробки — упіймала перевірка в CI.
 * Supabase-адаптер цього поля не експортує, тож підказки просто немає.
 */
export const demoCredentials = USERS.map((u) => ({
  role: u.role,
  label: u.role === 'admin' ? 'Адміністратор' : 'Курʼєр',
  name: u.role === 'admin' ? 'Бос · дашборд і гроші' : 'Олег Ткачук · черга й доставка',
  login: u.login,
  password: u.password,
}));

/* ── Конфігурація ставок ────────────────────────────────────────────────── */
/* Живе в таблиці, не в коді: затвердження фінмоделі = INSERT, не реліз
   (docs/adr/0005). Значення поки демо-заглушка — Q2/Q3 відкладені. */

export const config = {
  deliveryFee: 50,
  // 35 ₴ кур'єру / 15 ₴ платформі — числа з макета CSTL LIFE.
  // Досі заглушка: реальний розподіл — рішення власника (Q2/Q3 відкладені).
  // Головне, що поле існує і рахується, а маржа платформи ненульова.
  courierPerDelivery: 35,
  platformPerDelivery: 15,
  maxDeliveryRadiusKm: 15,
  maxActiveOrders: 1,
  cashLimit: 2000,
  cashLimitNovice: 500,
  noviceDeliveries: 20,
  // Прогресивна надбавка за час у черзі — протидія черрі-пікінгу (B35)
  waitingBonusSteps: [
    { afterMin: 10, bonus: 10 },
    { afterMin: 20, bonus: 20 },
    { afterMin: 30, bonus: 35 },
  ],
};

/* ── Насіннєві дані ─────────────────────────────────────────────────────── */

const BUSINESS = {
  id: 'b1',
  name: 'Суші Мар',
  type: 'sushi',
  addressText: 'с. Дідичі, вул. Незалежності 19А',
  lat: 50.75083,
  lng: 25.80328,
  phone: '+380671112233',
  isActive: true,
  deliveryRadiusKm: 15,
  cashReconciliationPeriod: 'weekly',
  /**
   * Графік роботи: без нього замовлення падають о 23:00 у заклад,
   * що працює до 22:00 (B34).
   *
   * У демо за замовчуванням цілодобово — інакше застосунок ставав би
   * непридатним уночі, а тести залежали б від годинника машини.
   * Реальний графік вмикається з демо-консолі, щоб правило було видно
   * в дії, а не лише в коді.
   */
  workingHours: { from: 0, to: 24 },
};

const min = (n) => n * 60000;

function seedOrders() {
  const now = Date.now();
  const mk = (o) => ({
    businessId: 'b1',
    courierId: null,
    tripId: null,
    itemsTotal: 0,
    deliveryFee: config.deliveryFee,
    waitingBonus: 0,
    returnCount: 0,
    proofPhotoPath: null,
    deliveryPin: null,
    pinBypassed: false,
    cancelReason: null,
    ...o,
    total: (o.itemsTotal || 0) + config.deliveryFee,
  });

  return [
    mk({
      id: 'o1',
      code: 'RD-0412',
      status: 'ready',
      itemsTotal: 420,
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      clientName: 'Оксана',
      clientPhone: '+380501234567',
      destLocality: 'с. Метельне',
      destAddressText: 'с. Метельне, вул. О. Денисюка 71',
      destLat: 50.69161,
      destLng: 25.81878,
      destLandmark: 'зелені ворота, за магазином',
      deliveryPin: '4271',
      distanceKm: 7.2,
      placedAt: now - min(24),
      estimatedReadyAt: now - min(9),
      readyAt: now - min(11),
    }),
    mk({
      id: 'o2',
      code: 'RD-0413',
      status: 'preparing',
      itemsTotal: 640,
      paymentMethod: 'online',
      paymentStatus: 'paid',
      clientName: 'Андрій',
      clientPhone: '+380671110099',
      destLocality: 'с. Дідичі',
      destAddressText: 'с. Дідичі, вул. Шкільна 4',
      destLat: 50.7482,
      destLng: 25.8091,
      destLandmark: 'біля школи, синій паркан',
      deliveryPin: '8130',
      distanceKm: 1.4,
      placedAt: now - min(4),
      estimatedReadyAt: now + min(5),
      readyAt: null,
    }),
    // Далеке замовлення з готівкою — рівно те, що ніхто не бере (B35).
    // Уже висить 22 хвилини, тож має надбавку.
    mk({
      id: 'o3',
      code: 'RD-0414',
      status: 'ready',
      itemsTotal: 310,
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      clientName: 'Марія',
      clientPhone: '+380931234455',
      destLocality: 'с. Романів',
      destAddressText: 'с. Романів, вул. Лісова 12',
      destLat: 50.6612,
      destLng: 25.9014,
      destLandmark: 'останній двір, велика липа',
      deliveryPin: '9042',
      distanceKm: 12.6,
      placedAt: now - min(31),
      estimatedReadyAt: now - min(20),
      readyAt: now - min(22),
    }),
    mk({
      id: 'o0',
      code: 'RD-0409',
      status: 'delivered',
      itemsTotal: 380,
      paymentMethod: 'online',
      paymentStatus: 'paid',
      courierId: 'c1',
      clientName: 'Ігор',
      clientPhone: '+380509998877',
      destLocality: 'с. Метельне',
      destAddressText: 'с. Метельне, вул. Центральна 3',
      destLat: 50.6931,
      destLng: 25.8203,
      destLandmark: 'жовтий будинок',
      distanceKm: 6.8,
      placedAt: now - min(180),
      readyAt: now - min(165),
      pickedUpAt: now - min(160),
      deliveredAt: now - min(140),
      proofPhotoPath: 'demo/o0.jpg',
    }),
  ];
}

/* ── Стан ───────────────────────────────────────────────────────────────── */

let db = null;

function reset() {
  db = {
    business: BUSINESS,
    orders: seedOrders(),
    couriers: [
      {
        id: 'c1',
        fullName: 'Олег Ткачук',
        phone: '+380670001122',
        vehicle: 'escooter',
        // На лінії з самого початку: інакше перше, що бачить той, хто
        // відкрив демо, — відмова «вийди на лінію». Правило перевіряється
        // тестом, а не незручністю на старті.
        status: 'online',
        login: 'rd-oleh-07',
        maxActiveOrders: config.maxActiveOrders,
        cashOnHand: 1250,
        completedDeliveries: 34,
        isActive: true,
      },
      {
        id: 'c2',
        fullName: 'Віталій Кузьмич',
        phone: '+380630003344',
        vehicle: 'escooter',
        status: 'online',
        login: 'rd-vitalii-11',
        maxActiveOrders: config.maxActiveOrders,
        cashOnHand: 0,
        completedDeliveries: 6,
        isActive: true,
      },
    ],
    cashHandoffs: [
      {
        id: 'h1',
        courierId: 'c2',
        businessId: 'b1',
        declaredAmount: 880,
        confirmedAmount: null,
        status: 'declared',
        orderIds: [],
        declaredAt: Date.now() - min(50),
      },
    ],
    earnings: [
      {
        id: 'e1',
        courierId: 'c1',
        orderId: 'o0',
        amount: 40,
        reason: 'delivery',
        createdAt: Date.now() - min(140),
      },
    ],
    events: [],
    photos: [],
    payrolls: [],
    locations: {},
    demo: { generator: false, autoKitchen: true, intervalSec: 90, lastSpawn: Date.now() },
  };

  // Відстань — обчислювана величина, а не насіннєва константа.
  // Одне джерело правди: координати.
  for (const o of db.orders) o.distanceKm = distanceKmFor(o) ?? o.distanceKm;
}

/* ── Збереження демо-стану ──────────────────────────────────────────────── */

const STORAGE_KEY = 'rocket-demo-v1';

/**
 * Демо переживає перезавантаження сторінки.
 *
 * Без цього кожне оновлення стирало все: доставлені замовлення, здану
 * готівку, створених курʼєрів. Перевірити наскрізний сценарій було
 * неможливо — а саме він і є сенсом демо.
 */
function persist() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* сховище переповнене або вимкнене — демо працює далі в памʼяті */
  }
}

function restore() {
  if (typeof localStorage === 'undefined') return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    // Мінімальна перевірка форми: пошкоджене сховище не має ламати демо
    if (!saved?.orders || !saved?.couriers) return false;
    db = saved;
    return true;
  } catch {
    return false;
  }
}

reset();
restore();

/** Скинути демо до насіннєвого стану. */
export function resetDemo() {
  reset();
  persist();
}

/** Штучна затримка мережі, щоб стани завантаження були видимі в розробці. */
const lag = (ms = 180) => new Promise((r) => setTimeout(r, ms));

/* ── Геометрія ──────────────────────────────────────────────────────────── */

/**
 * Відстань від закладу до клієнта в кілометрах.
 *
 * Рахується з координат, а не береться з насіння: інакше «12,6 км» —
 * це вигадане число, яке нічого не перевіряє, а радіус доставки (B10)
 * не має на чому спрацювати.
 */
function distanceKmFor(order) {
  if (!Number.isFinite(order.destLat) || !Number.isFinite(order.destLng)) return null;
  const from = { lat: db.business.lat, lng: db.business.lng };
  const to = { lat: order.destLat, lng: order.destLng };
  return Math.round((distanceM(from, to) / 1000) * 10) / 10;
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

/**
 * 🔒 Прибирає з відповіді те, що клієнтський застосунок отримувати не має.
 *
 * `deliveryPin` — очікуваний код клієнта. Якщо він приїжджає курʼєру
 * разом із замовленням, уся верифікація перетворюється на театр: код
 * видно в інструментах розробника, і питати клієнта необовʼязково.
 * Перевірка коду має жити ТІЛЬКИ на сервері (B41).
 *
 * @template T
 * @param {T} order
 * @returns {T}
 */
function publicOrder(order) {
  if (!order) return order;
  const { deliveryPin, ...safe } = order;
  void deliveryPin;
  return safe;
}

function publicOrders(orders) {
  return orders.map(publicOrder);
}

/**
 * Тільки для демо: підказка з кодом клієнта на екрані завершення.
 * У продакшн-збірці цього адаптера не існує взагалі.
 */
export function demoPinFor(orderId) {
  return db.orders.find((o) => o.id === orderId)?.deliveryPin || null;
}

function logEvent(orderId, from, to, actor) {
  db.events.push({
    id: `ev${db.events.length + 1}`,
    orderId,
    fromStatus: from,
    toStatus: to,
    actorRole: actor?.role || 'system',
    actorId: actor?.courierId || actor?.adminId || null,
    createdAt: Date.now(),
  });
}

/**
 * Симуляція серверних процесів: заклад тисне «готово», надбавка за
 * очікування росте. У продакшені перше робить людина на кухні,
 * друге — фонова задача.
 */
function tickServer() {
  const now = Date.now();

  for (const o of db.orders) {
    // «Готово» тисне людина на кухні (поверхня закладу). Автопілот існує
    // лише для демо: коли не хочеться грати кухаря, щоб побачити чергу.
    if (
      db.demo?.autoKitchen &&
      o.status === 'preparing' &&
      o.estimatedReadyAt &&
      now >= o.estimatedReadyAt
    ) {
      logEvent(o.id, 'preparing', 'ready', null);
      o.status = 'ready';
      o.readyAt = now;
    }

    if (o.status === 'ready' && o.readyAt) {
      const waited = (now - o.readyAt) / 60000;
      let bonus = 0;
      for (const step of config.waitingBonusSteps) {
        if (waited >= step.afterMin) bonus = step.bonus;
      }
      o.waitingBonus = bonus;
    }

    applyWatchdog(o, now);
  }

  maybeSpawnOrder(now);
  persist();
}

/**
 * Watchdog — те, чого в системі не було зовсім (B7).
 *
 * Замовлення могло висіти в будь-якому статусі вічно, і ніхто не дізнався б.
 * Позначаємо прапорцем, а не окремим статусом: доставлене із запізненням
 * лишається `delivered`, але має бути видно, що воно прострочене.
 */
function applyWatchdog(o, now) {
  const flags = [];

  if (o.status === 'ready' && !o.courierId && o.readyAt && now - o.readyAt > min(15)) {
    flags.push('unclaimed');
  }
  if (o.status === 'on_the_way' && o.onTheWayAt && now - o.onTheWayAt > min(60)) {
    flags.push('stuck');
  }
  if (o.deliveredAt && o.estimatedReadyAt && o.deliveredAt - o.estimatedReadyAt > min(45)) {
    flags.push('late');
  }
  if ((o.returnCount || 0) >= 2 && !['delivered', 'failed_delivery'].includes(o.status)) {
    flags.push('bounced');
  }

  o.watchdog = flags;
  o.isOverdue = flags.includes('late');
}

/* ── Створення замовлення ───────────────────────────────────────────────── */

/** Населені пункти в радіусі пілоту + одне свідомо задалеке, щоб було видно відмову. */
export const DEMO_DESTINATIONS = [
  {
    locality: 'с. Дідичі',
    address: 'вул. Шкільна 4',
    lat: 50.7482,
    lng: 25.8091,
    landmark: 'біля школи, синій паркан',
  },
  {
    locality: 'с. Метельне',
    address: 'вул. О. Денисюка 71',
    lat: 50.69161,
    lng: 25.81878,
    landmark: 'зелені ворота, за магазином',
  },
  {
    locality: 'с. Романів',
    address: 'вул. Лісова 12',
    lat: 50.6612,
    lng: 25.9014,
    landmark: 'останній двір, велика липа',
  },
  {
    locality: 'м. Олика',
    address: 'вул. Замкова 8',
    lat: 50.7211,
    lng: 25.8102,
    landmark: 'навпроти аптеки',
  },
  {
    locality: 'с. Покащів',
    address: 'вул. Польова 3',
    lat: 50.7803,
    lng: 25.7412,
    landmark: 'жовта хата з криницею',
  },
  {
    locality: 'м. Луцьк',
    address: 'просп. Волі 40',
    lat: 50.7472,
    lng: 25.3254,
    landmark: 'за межами радіуса',
  },
];

const FIRST_NAMES = ['Оксана', 'Андрій', 'Марія', 'Ігор', 'Ніна', 'Тарас', 'Леся', 'Богдан'];

function nextOrderCode() {
  const n = 415 + db.orders.length;
  return `RD-${String(n).padStart(4, '0')}`;
}

function newPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * Створення замовлення. У продакшені це робить чекаут на cstllife.
 *
 * Тут же живе hard limit радіусу (B10): без нього система колись прийме
 * замовлення за 40 км, і курʼєр на скутері туди просто не доїде.
 */
export async function createOrder({ destination, itemsTotal, paymentMethod, clientName }) {
  await lag(200);

  const dest = DEMO_DESTINATIONS.find((d) => d.locality === destination) || DEMO_DESTINATIONS[1];
  const km =
    Math.round((distanceM({ lat: db.business.lat, lng: db.business.lng }, dest) / 1000) * 10) / 10;

  if (km > config.maxDeliveryRadiusKm) {
    throw err.validation(
      `Задалеко: ${km} км від закладу за ліміту ${config.maxDeliveryRadiusKm} км`
    );
  }

  const hours = db.business.workingHours;
  if (hours && !isOpenNow(hours)) {
    throw err.validation(`Заклад зачинено. Працює ${hours.from}:00–${hours.to}:00`);
  }

  const now = Date.now();
  const order = {
    id: `o${db.orders.length + 1}-${now.toString(36)}`,
    code: nextOrderCode(),
    businessId: db.business.id,
    courierId: null,
    tripId: null,
    status: 'placed',
    itemsTotal,
    deliveryFee: config.deliveryFee,
    total: itemsTotal + config.deliveryFee,
    paymentMethod,
    paymentStatus: paymentMethod === 'online' ? 'paid' : 'pending',
    clientName: clientName || FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)],
    clientPhone: `+3806${Math.floor(10000000 + Math.random() * 89999999)}`,
    destLocality: dest.locality,
    destAddressText: `${dest.locality}, ${dest.address}`,
    destLat: dest.lat,
    destLng: dest.lng,
    destLandmark: dest.landmark,
    deliveryPin: newPin(),
    distanceKm: km,
    waitingBonus: 0,
    returnCount: 0,
    proofPhotoPath: null,
    pinBypassed: false,
    cancelReason: null,
    cashHandoffId: null,
    watchdog: [],
    placedAt: now,
    estimatedReadyAt: null,
    readyAt: null,
  };

  db.orders.push(order);
  logEvent(order.id, null, 'placed', { role: 'client' });
  persist();
  return publicOrder(clone(order));
}

/** Графік роботи закладу: замовлення о 23:00 у заклад до 22:00 (B34). */
function isOpenNow(hours, now = new Date()) {
  if (!hours) return true;
  const h = now.getHours();
  return h >= hours.from && h < hours.to;
}

/** Змінити графік закладу — з демо-консолі або з тесту. */
export function setBusinessHours(from, to) {
  db.business.workingHours = from === 0 && to === 24 ? { from: 0, to: 24 } : { from, to };
  persist();
  return clone(db.business.workingHours);
}

/** Генератор замовлень — щоб черга не вичерпувалась і демо було живим. */
function maybeSpawnOrder(now) {
  const d = db.demo;
  if (!d?.generator) return;
  if (now - (d.lastSpawn || 0) < (d.intervalSec || 90) * 1000) return;

  d.lastSpawn = now;
  // Генератор не створює свідомо задалеких замовлень — вони б лише
  // засмічували чергу відмовами
  const reachable = DEMO_DESTINATIONS.filter(
    (dst) =>
      distanceM({ lat: db.business.lat, lng: db.business.lng }, dst) / 1000 <=
      config.maxDeliveryRadiusKm
  );
  const dest = reachable[Math.floor(Math.random() * reachable.length)];
  const itemsTotal = 180 + Math.floor(Math.random() * 12) * 40;

  const order = {
    id: `g${now.toString(36)}`,
    code: nextOrderCode(),
    businessId: db.business.id,
    courierId: null,
    tripId: null,
    status: 'placed',
    itemsTotal,
    deliveryFee: config.deliveryFee,
    total: itemsTotal + config.deliveryFee,
    paymentMethod: Math.random() < 0.5 ? 'cash' : 'online',
    paymentStatus: 'pending',
    clientName: FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)],
    clientPhone: `+3806${Math.floor(10000000 + Math.random() * 89999999)}`,
    destLocality: dest.locality,
    destAddressText: `${dest.locality}, ${dest.address}`,
    destLat: dest.lat,
    destLng: dest.lng,
    destLandmark: dest.landmark,
    deliveryPin: newPin(),
    distanceKm:
      Math.round((distanceM({ lat: db.business.lat, lng: db.business.lng }, dest) / 1000) * 10) /
      10,
    waitingBonus: 0,
    returnCount: 0,
    proofPhotoPath: null,
    pinBypassed: false,
    cancelReason: null,
    cashHandoffId: null,
    watchdog: [],
    placedAt: now,
    estimatedReadyAt: null,
    readyAt: null,
  };
  if (order.paymentMethod === 'online') order.paymentStatus = 'paid';

  db.orders.push(order);
  logEvent(order.id, null, 'placed', { role: 'client' });
}

function courierById(id) {
  return db.couriers.find((c) => c.id === id) || null;
}

function effectiveCashLimit(courier) {
  return courier.completedDeliveries < config.noviceDeliveries
    ? config.cashLimitNovice
    : config.cashLimit;
}

/* ── Публічний API адаптера ─────────────────────────────────────────────── */

export const name = 'mock';

export async function signIn(login, password) {
  await lag(300);
  const user = USERS.find((u) => u.login === login && u.password === password);
  if (!user) throw err.auth('Невірний логін або пароль');

  if (user.role === 'courier') {
    const c = courierById(user.courierId);
    if (!c?.isActive) throw err.auth('Обліковий запис деактивовано');
  }
  return {
    role: user.role,
    courierId: user.courierId || null,
    adminId: user.adminId || null,
    login: user.login,
    mustChangePassword: !!user.mustChangePassword,
  };
}

export async function signOut() {
  await lag(60);
}

/**
 * Черга. Повертає ОБМЕЖЕНИЙ набір полів — це VIEW courier_queue.
 *
 * Свідомо НЕ віддаються:
 *  • paymentMethod — інакше готівкові замовлення дискримінуються (B35)
 *  • clientPhone, destAddressText, destLandmark, координати — приватні
 *    дані, до взяття курʼєр не має на них права (B15)
 */
export async function fetchQueue() {
  await lag();
  tickServer();
  return db.orders
    .filter((o) => (o.status === 'ready' || o.status === 'preparing') && !o.courierId)
    .map((o) => ({
      id: o.id,
      code: o.code,
      businessName: db.business.name,
      pickupLat: db.business.lat,
      pickupLng: db.business.lng,
      status: o.status,
      destLocality: o.destLocality,
      distanceKm: o.distanceKm,
      // Заробіток кур'єра, а НЕ сума чека: сума чека розкриває спосіб
      // оплати непрямо (кругле число = готівка) і кур'єру не потрібна
      courierEarnings: config.courierPerDelivery + (o.waitingBonus || 0),
      waitingBonus: o.waitingBonus,
      estimatedReadyAt: o.estimatedReadyAt,
      readyAt: o.readyAt,
    }))
    .sort(
      (a, b) => b.waitingBonus - a.waitingBonus || (a.readyAt || Infinity) - (b.readyAt || Infinity)
    );
}

export async function fetchActive(courierId) {
  await lag();
  tickServer();
  return publicOrders(
    clone(
      db.orders.filter(
        (o) =>
          o.courierId === courierId &&
          ['courier_assigned', 'picked_up', 'on_the_way'].includes(o.status)
      )
    )
  );
}

export async function fetchHistory(courierId) {
  await lag();
  const earnedFor = (orderId) =>
    db.earnings.filter((e) => e.orderId === orderId).reduce((s, e) => s + e.amount, 0);

  return publicOrders(
    clone(
      db.orders
        .map((o) => ({
          ...o,
          courierEarnings: earnedFor(o.id),
          businessName: db.business.name,
        }))
        .filter(
          (o) =>
            o.courierId === courierId &&
            [
              'delivered',
              'failed_delivery',
              'cancelled_by_client',
              'rejected_by_business',
            ].includes(o.status)
        )
        .sort((a, b) => (b.deliveredAt || b.placedAt) - (a.deliveredAt || a.placedAt))
    )
  );
}

export async function fetchCourier(courierId) {
  await lag(80);
  const c = courierById(courierId);
  if (!c) throw err.auth();
  const today = Date.now() - min(60 * 24);
  const mine = db.earnings.filter((e) => e.courierId === courierId);
  return {
    ...clone(c),
    cashLimit: effectiveCashLimit(c),
    todayCount: mine.filter((e) => e.createdAt >= today).length,
    todayAmount: mine.filter((e) => e.createdAt >= today).reduce((s, e) => s + e.amount, 0),
    weekCount: mine.length,
    weekAmount: mine.reduce((s, e) => s + e.amount, 0),
  };
}

/**
 * Атомарне взяття замовлення.
 *
 * Це серверний UPDATE ... WHERE status='ready' AND courier_id IS NULL.
 * Порожній результат = гонку програно. За відкритої черги (ADR-0009)
 * це основна механіка, а не крайній випадок.
 */
export async function acceptOrder(orderId, courierId) {
  await lag(240);
  tickServer();

  const courier = courierById(courierId);
  if (!courier) throw err.auth();

  // Офлайн-курʼєр не бере замовлень. Раніше це було лише написом
  // у профілі — сервер пускав будь-кого.
  if (courier.status !== 'online') {
    throw err.limit('Вийди на лінію, щоб брати замовлення');
  }

  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw err.conflict();

  // Умовний UPDATE: обидві перевірки — атомарно на сервері
  if (order.status !== 'ready' || order.courierId) throw err.conflict();

  // Курʼєр, який щойно повернув це замовлення, не бачить його 3 хвилини —
  // інакше воно ходить по колу «взяв → повернув» (B6)
  if (order.returnedBy === courierId && Date.now() - (order.returnedAt || 0) < min(3)) {
    throw err.conflict('Ти щойно повернув це замовлення');
  }

  const activeCount = db.orders.filter(
    (o) =>
      o.courierId === courierId &&
      ['courier_assigned', 'picked_up', 'on_the_way'].includes(o.status)
  ).length;
  if (activeCount >= courier.maxActiveOrders) {
    throw err.limit('Спочатку заверши поточне замовлення');
  }

  if (order.paymentMethod === 'cash') {
    const limit = effectiveCashLimit(courier);
    if (courier.cashOnHand + order.total > limit) {
      throw err.limit('Здай готівку, щоб брати замовлення з оплатою готівкою');
    }
  }

  logEvent(order.id, order.status, 'courier_assigned', { role: 'courier', courierId });
  order.courierId = courierId;
  order.status = 'courier_assigned';
  order.courierAssignedAt = Date.now();
  persist();
  return publicOrder(clone(order));
}

const FLOW = {
  courier_assigned: 'picked_up',
  picked_up: 'on_the_way',
};

export async function advanceStatus(orderId, courierId, toStatus) {
  await lag(200);
  const order = db.orders.find((o) => o.id === orderId && o.courierId === courierId);
  if (!order) throw err.permission();
  if (FLOW[order.status] !== toStatus) throw err.conflict('Статус уже змінено');

  logEvent(order.id, order.status, toStatus, { role: 'courier', courierId });
  order.status = toStatus;
  order[`${toStatus === 'picked_up' ? 'pickedUp' : 'onTheWay'}At`] = Date.now();
  persist();
  return publicOrder(clone(order));
}

/**
 * Завершення доставки.
 * Інваріант: без фото не приймається. Це перевірка СЕРВЕРА, не UI —
 * кнопка в інтерфейсі лише дублює її для зручності.
 */
export async function completeDelivery(orderId, courierId, { photoPath, pin, pinBypassed }) {
  await lag(320);
  const order = db.orders.find((o) => o.id === orderId && o.courierId === courierId);
  if (!order) throw err.permission();
  if (order.status !== 'on_the_way') throw err.conflict('Статус уже змінено');
  if (!photoPath) throw err.validation('Потрібне фото підтвердження');

  if (!pinBypassed && order.deliveryPin && pin !== order.deliveryPin) {
    throw err.validation('Невірний код');
  }

  logEvent(order.id, order.status, 'delivered', { role: 'courier', courierId });
  order.status = 'delivered';
  order.deliveredAt = Date.now();
  order.proofPhotoPath = photoPath;
  order.pinBypassed = !!pinBypassed;

  db.photos.push({ orderId: order.id, path: photoPath, createdAt: Date.now() });

  const courier = courierById(courierId);
  courier.completedDeliveries += 1;
  if (order.paymentMethod === 'cash') courier.cashOnHand += order.total;

  // Заробіток нараховує сервер, не клієнт. Ставка фіксується на момент
  // доставки, а не читається з конфіга при перегляді.
  db.earnings.push({
    id: `e${db.earnings.length + 1}`,
    courierId,
    orderId: order.id,
    amount: config.courierPerDelivery + (order.waitingBonus || 0),
    reason: 'delivery',
    createdAt: Date.now(),
  });

  persist();
  return publicOrder(clone(order));
}

export async function cancelOrder(orderId, courierId, { reasonCode, note }) {
  await lag(220);
  const order = db.orders.find((o) => o.id === orderId && o.courierId === courierId);
  if (!order) throw err.permission();

  const toStatus = reasonCode === 'return_to_queue' ? 'returned_to_queue' : 'failed_delivery';
  logEvent(order.id, order.status, toStatus, { role: 'courier', courierId });

  if (toStatus === 'returned_to_queue') {
    order.returnCount += 1;
    order.returnedBy = courierId;
    order.returnedAt = Date.now();
    order.courierId = null;
    order.status = 'ready';
    order.courierAssignedAt = null;
  } else {
    order.status = 'failed_delivery';
    order.cancelledAt = Date.now();
    order.cancelReason = { reasonCode, note };
    // Скасування онлайн-оплаченого замовлення завжди вимагає рефанду
    if (order.paymentMethod === 'online') order.paymentStatus = 'refund_needed';

    // Курʼєр відпрацював поїздку — заробіток за неї зберігається
    // (рекомендація Q4). Інакше курʼєри уникали б «підозрілих» адрес.
    db.earnings.push({
      id: `e${db.earnings.length + 1}-${Date.now().toString(36)}`,
      courierId,
      orderId: order.id,
      amount: config.courierPerDelivery,
      reason: 'failed_delivery_compensation',
      createdAt: Date.now(),
    });
  }
  persist();
  return publicOrder(clone(order));
}

export async function setCourierStatus(courierId, status) {
  await lag(120);
  const c = courierById(courierId);
  if (!c) throw err.auth();
  c.status = status;
  persist();
  return clone(c);
}

/** Готівкові замовлення, за які курʼєр ще не звітував. */
function unsettledCashOrders(courierId) {
  return db.orders.filter(
    (o) =>
      o.courierId === courierId &&
      o.status === 'delivered' &&
      o.paymentMethod === 'cash' &&
      !o.cashHandoffId
  );
}

export async function declareCashHandoff(courierId, amount) {
  await lag(260);
  const c = courierById(courierId);
  if (!c) throw err.auth();
  if (amount <= 0) throw err.validation('Вкажи суму');

  // Здача привʼязується до КОНКРЕТНИХ замовлень. Без цього список
  // «з чого складається» був вигаданим і повторювався після кожної здачі,
  // а зʼясувати, на якому замовленні розійшлось, було неможливо.
  const covered = unsettledCashOrders(courierId);

  const handoff = {
    id: `h${db.cashHandoffs.length + 1}-${Date.now().toString(36)}`,
    courierId,
    businessId: db.business.id,
    declaredAmount: amount,
    expectedAmount: covered.reduce((s, o) => s + o.total, 0),
    confirmedAmount: null,
    status: 'declared',
    orderIds: covered.map((o) => o.id),
    declaredAt: Date.now(),
  };
  db.cashHandoffs.push(handoff);
  for (const o of covered) o.cashHandoffId = handoff.id;

  // cashOnHand зменшується ТІЛЬКИ при підтвердженні закладом (ADR-0008),
  // інакше курʼєр знімав би собі ліміт власною заявою.
  persist();
  return clone(handoff);
}

/**
 * Контакт клієнта — тільки через RPC, з перевіркою «цей курʼєр і
 * замовлення активне». Після delivered контакт закривається (B15).
 */
export async function getOrderContact(orderId, courierId) {
  await lag(100);
  const order = db.orders.find((o) => o.id === orderId);
  if (
    !order ||
    order.courierId !== courierId ||
    !['courier_assigned', 'picked_up', 'on_the_way'].includes(order.status)
  ) {
    throw err.permission();
  }
  return {
    clientName: order.clientName,
    clientPhone: order.clientPhone,
    destLat: order.destLat,
    destLng: order.destLng,
    destAddressText: order.destAddressText,
    destLandmark: order.destLandmark,
  };
}

/* ── Адмін ──────────────────────────────────────────────────────────────── */

/**
 * Метрики, без яких адмінка гарна, але не відповідає на питання
 * «чи ми заробляємо і чи не псується сервіс»:
 * маржа платформи, середній час доставки, непідтверджена готівка.
 */
function buildStats(orders, now) {
  const activeStatuses = ['ready', 'courier_assigned', 'picked_up', 'on_the_way'];
  const delivered = orders.filter((o) => o.status === 'delivered');

  const spans = delivered
    .filter((o) => o.readyAt && o.deliveredAt)
    .map((o) => (o.deliveredAt - o.readyAt) / 60000);

  // «Прострочено» — факт перевищив обіцяний час більш ніж на 15 хвилин.
  // Головна метрика якості: без неї не видно, що сервіс погіршується.
  const overdue = delivered.filter(
    (o) => o.estimatedReadyAt && o.deliveredAt && o.deliveredAt - o.estimatedReadyAt > min(45)
  ).length;

  const unconfirmedCash = db.cashHandoffs
    .filter((h) => h.status === 'declared')
    .reduce((s, h) => s + h.declaredAmount, 0);

  const onHand = db.couriers.reduce((s, c) => s + c.cashOnHand, 0);

  return {
    active: orders.filter((o) => activeStatuses.includes(o.status)).length,
    stale: orders.filter(
      (o) => o.status === 'ready' && !o.courierId && o.readyAt && now - o.readyAt > min(15)
    ).length,
    online: db.couriers.filter((c) => c.status === 'online').length,
    delivered: delivered.length,
    total: orders.length,
    refunds: orders.filter((o) => o.paymentStatus === 'refund_needed').length,
    failed: orders.filter((o) => o.status === 'failed_delivery').length,
    avgMinutes: spans.length ? Math.round(spans.reduce((s, x) => s + x, 0) / spans.length) : null,
    overdue,
    unconfirmedCash: unconfirmedCash + onHand,
    // Маржа платформи — те, чого в прототипі не було взагалі
    platformEarnings: delivered.length * config.platformPerDelivery,
    collectedDelivery: delivered.length * config.deliveryFee,
    courierPayout: db.earnings.reduce((s, e) => s + e.amount, 0),
  };
}

export async function fetchAdminOverview() {
  await lag();
  tickServer();
  const now = Date.now();
  const orders = publicOrders(clone(db.orders));
  return {
    business: clone(db.business),
    orders,
    couriers: clone(db.couriers),
    handoffs: clone(db.cashHandoffs),
    earnings: clone(db.earnings),
    events: clone(db.events),
    photos: clone(db.photos),
    payrolls: clone(db.payrolls || []),
    locations: clone(db.locations || {}),
    demo: clone(db.demo || {}),
    stats: buildStats(orders, now),
  };
}

export async function confirmHandoff(handoffId, confirmedAmount) {
  await lag(220);
  const h = db.cashHandoffs.find((x) => x.id === handoffId);
  if (!h) throw err.conflict();
  if (h.status !== 'declared') throw err.conflict('Цю здачу вже опрацьовано');

  h.confirmedAmount = confirmedAmount;
  h.confirmedAt = Date.now();
  h.discrepancy = confirmedAmount - h.declaredAmount;
  h.status = h.discrepancy === 0 ? 'confirmed' : 'disputed';

  const c = courierById(h.courierId);
  if (c) {
    c.cashOnHand = Math.max(0, c.cashOnHand - confirmedAmount);
    // Розбіжність — це зафіксований борг, а не усна суперечка (ADR-0008).
    // Він утримається з наступної виплати.
    if (h.discrepancy < 0) c.debt = (c.debt || 0) + Math.abs(h.discrepancy);
  }
  persist();
  return clone(h);
}

/* ── Зарплата ───────────────────────────────────────────────────────────── */

/**
 * Відомість за період: нараховане мінус борг по готівці.
 *
 * Раніше earnings_log просто ріс, а виплатити його не було як — тобто
 * половина фінансового циклу не існувала.
 */
export async function createPayroll(courierId) {
  await lag(240);
  const c = courierById(courierId);
  if (!c) throw err.conflict();

  const pending = db.earnings.filter((e) => e.courierId === courierId && !e.payrollId);
  if (!pending.length) throw err.validation('Немає нарахувань за період');

  const gross = pending.reduce((s, e) => s + e.amount, 0);
  const deductions = Math.min(c.debt || 0, gross);

  const payroll = {
    id: `p${db.payrolls.length + 1}-${Date.now().toString(36)}`,
    courierId,
    periodStart: Math.min(...pending.map((e) => e.createdAt)),
    periodEnd: Date.now(),
    deliveriesCount: pending.filter((e) => e.reason === 'delivery').length,
    grossAmount: gross,
    deductions,
    netAmount: gross - deductions,
    status: 'draft',
    createdAt: Date.now(),
  };

  db.payrolls.push(payroll);
  for (const e of pending) e.payrollId = payroll.id;
  persist();
  return clone(payroll);
}

export async function payPayroll(payrollId) {
  await lag(240);
  const p = db.payrolls.find((x) => x.id === payrollId);
  if (!p) throw err.conflict();
  if (p.status === 'paid') throw err.conflict('Уже виплачено');

  p.status = 'paid';
  p.paidAt = Date.now();

  const c = courierById(p.courierId);
  if (c) c.debt = Math.max(0, (c.debt || 0) - p.deductions);

  persist();
  return clone(p);
}

export async function createCourier({ fullName, phone }) {
  await lag(320);
  if (!fullName?.trim()) throw err.validation('Вкажи імʼя');

  const id = `c${db.couriers.length + 1}`;
  const slug = fullName
    .trim()
    .toLowerCase()
    .split(/\s+/)[0]
    .replace(/[^a-zа-яїієґ]/gi, '');
  const login = `rd-${slug || 'courier'}-${String(db.couriers.length + 1).padStart(2, '0')}`;
  // Пароль генерується на сервері й показується адміну ОДИН РАЗ.
  // Ніде не зберігається у відкритому вигляді (ADR-0004, B17).
  const password = Array.from({ length: 8 }, () =>
    'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'.charAt(Math.floor(Math.random() * 54))
  ).join('');

  db.couriers.push({
    id,
    fullName: fullName.trim(),
    phone: phone || '',
    vehicle: 'escooter',
    status: 'offline',
    login,
    maxActiveOrders: config.maxActiveOrders,
    cashOnHand: 0,
    completedDeliveries: 0,
    isActive: true,
  });

  persist();
  return { login, password };
}

export async function setCourierActive(courierId, isActive) {
  await lag(160);
  const c = courierById(courierId);
  if (!c) throw err.conflict();
  c.isActive = isActive;
  if (!isActive) c.status = 'offline';
  persist();
  return clone(c);
}

/** Тільки для розробки: повернути насіннєві дані. */
export function __reset() {
  reset();
}
