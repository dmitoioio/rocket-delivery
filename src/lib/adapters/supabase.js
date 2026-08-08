/**
 * Продакшн-адаптер: справжня база замість памʼяті браузера.
 *
 * ⚠️ Форма відповідей ТОЧНО як у mock.js. Це не збіг і не ввічливість —
 * саме на цьому тримається вся конструкція: екрани не знають, який
 * бекенд під ними, і при переході на живу базу не міняється жоден рядок
 * у `src/features/`. Розбіжність форми = баг адаптера, і його ловить
 * test/contract.test.js.
 *
 * Правил тут немає. Радіус, гонка, звірка коду, нарахування грошей —
 * усе в базі (supabase/migrations/0002_functions.sql). Клієнт лише
 * викликає й перекладає назви полів: перевірка на клієнті захистом не є.
 */

import { createClient } from '@supabase/supabase-js';
import { err } from '../errors.js';

export const name = 'supabase';

/** Демо-доступів у продакшені немає — це перевіряє CI (B18). */
export const demoCredentials = null;

const URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_ANON_KEY;

let client = null;

function db() {
  if (!client) {
    if (!URL || !KEY) {
      throw err.server('Не налаштовано підключення до бази (VITE_SUPABASE_URL / ANON_KEY)');
    }
    client = createClient(URL, KEY, {
      db: { schema: 'delivery' },
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}

/* ── Помилки ────────────────────────────────────────────────────────────────
   Коди RD001–RD004 приходять із бази (див. шапку 0002_functions.sql).
   Без цієї таблиці будь-яке порушення правила виглядало б як «помилка
   сервера», і курʼєр бачив би «щось пішло не так» замість «вийди на лінію». */

const KIND_BY_CODE = {
  RD001: 'permission',
  RD002: 'validation',
  RD003: 'conflict',
  RD004: 'limit',
};

/** Людські формулювання для правил, які курʼєр бачитиме найчастіше. */
const MESSAGE = {
  already_taken: 'Встиг інший',
  not_online: 'Вийди на лінію, щоб брати замовлення',
  cash_limit_reached: 'Ліміт готівки на руках. Здай гроші, щоб брати далі',
  too_many_active: 'Спочатку заверши поточну доставку',
  recently_returned: 'Ти щойно повернув це замовлення',
  photo_required: 'Потрібне фото підтвердження',
  wrong_pin: 'Невірний код',
  business_closed: 'Заклад зараз зачинений',
  courier_inactive: 'Обліковий запис деактивовано',
  nothing_to_hand_off: 'Немає готівкових замовлень до здачі',
  nothing_to_pay: 'Немає нарахувань за період',
  // Привʼязка курʼєра до наявного облікового запису
  not_admin: 'Тільки адміністратор може додавати курʼєрів',
  full_name_required: 'Вкажи повне імʼя курʼєра',
  auth_user_not_found:
    'Такої пошти немає в Supabase. Спершу створи обліковий запис: Authentication → Users → Add user',
  courier_already_linked: 'До цієї пошти вже привʼязаний курʼєр',
};

function fail(error) {
  if (!error) return null;
  const code = error.code;
  const raw = String(error.message || '');
  // Повідомлення бази має форму «ключ: подробиці» — беремо ключ
  const key = raw.split(':')[0].trim();
  const kind = KIND_BY_CODE[code];

  if (!kind) {
    if (/JWT|token|expired/i.test(raw)) return err.auth();
    if (/fetch|network/i.test(raw)) return err.network();
    return err.server(raw);
  }
  return err[kind](MESSAGE[key] || raw);
}

async function call(fn, args) {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw fail(error);
  return data;
}

/* ── Переклад назв ──────────────────────────────────────────────────────────
   База — snake_case (звичай Postgres), застосунок — camelCase (звичай JS).
   Один перекладач замість ручного мапінгу в кожній функції: інакше при
   додаванні поля його забудуть у трьох місцях із пʼяти. */

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function toApp(row) {
  if (row === null || row === undefined || typeof row !== 'object') return row;
  if (Array.isArray(row)) return row.map(toApp);
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    // Часові мітки застосунок скрізь тримає числом (Date.now()), а база — ISO
    out[camel(k)] = /_at$/.test(k) && typeof v === 'string' ? Date.parse(v) : v;
  }
  return out;
}

/* ── Автентифікація ─────────────────────────────────────────────────────────
   Пароль перевіряє Supabase Auth. У наших таблицях паролів немає ніде (B17). */

export async function signIn(login, password) {
  const email = login.includes('@') ? login : `${login}@rocket.local`;
  const { data, error } = await db().auth.signInWithPassword({ email, password });
  if (error) throw err.auth('Невірний логін або пароль');

  const role = data.user?.app_metadata?.role || 'courier';
  if (role === 'admin') {
    return { role, courierId: null, adminId: data.user.id, login, mustChangePassword: false };
  }

  const { data: c } = await db()
    .from('couriers')
    .select('id, is_active, must_change_password')
    .eq('auth_user_id', data.user.id)
    .maybeSingle();

  if (!c) throw err.auth('Обліковий запис курʼєра не знайдено');
  if (!c.is_active) throw err.auth('Обліковий запис деактивовано');

  return {
    role: 'courier',
    courierId: c.id,
    adminId: null,
    login,
    mustChangePassword: !!c.must_change_password,
  };
}

export async function signOut() {
  await db().auth.signOut();
  client = null;
}

/* ── Читання ────────────────────────────────────────────────────────────────
   Черга йде з VIEW `courier_queue`, а не з таблиці: там фізично немає
   телефону, адреси й коду підтвердження (B15, B41, docs/05). */

export async function fetchQueue() {
  await call('tick'); // надбавка за очікування рахується сервером (B35)
  const { data, error } = await db()
    .from('courier_queue')
    .select('*')
    .order('waiting_bonus', { ascending: false })
    .order('ready_at', { ascending: true, nullsFirst: false });
  if (error) throw fail(error);
  return toApp(data || []);
}

export async function fetchActive(courierId) {
  const { data, error } = await db()
    .from('my_orders')
    .select('*')
    .eq('courier_id', courierId)
    .in('status', ['courier_assigned', 'picked_up', 'on_the_way']);
  if (error) throw fail(error);
  return toApp(data || []);
}

export async function fetchHistory(courierId) {
  const { data, error } = await db()
    .from('my_orders')
    .select('*')
    .eq('courier_id', courierId)
    .in('status', ['delivered', 'failed_delivery', 'cancelled_by_client', 'rejected_by_business'])
    .order('delivered_at', { ascending: false, nullsFirst: false });
  if (error) throw fail(error);

  const orders = toApp(data || []);
  const { data: earnings } = await db()
    .from('earnings_log')
    .select('order_id, amount')
    .eq('courier_id', courierId);

  const earnedFor = (id) =>
    (earnings || []).filter((e) => e.order_id === id).reduce((s, e) => s + Number(e.amount), 0);
  return orders.map((o) => ({ ...o, courierEarnings: earnedFor(o.id) }));
}

export async function fetchCourier(courierId) {
  const { data: c, error } = await db()
    .from('couriers')
    .select('*')
    .eq('id', courierId)
    .maybeSingle();
  if (error) throw fail(error);
  if (!c) throw err.auth();

  const { data: earnings } = await db()
    .from('earnings_log')
    .select('amount, created_at')
    .eq('courier_id', courierId);

  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const rows = (earnings || []).map((e) => ({
    amount: Number(e.amount),
    at: Date.parse(e.created_at),
  }));
  const today = rows.filter((e) => e.at >= dayAgo);

  return {
    ...toApp(c),
    cashLimit: Number(c.cash_limit),
    todayCount: today.length,
    todayAmount: today.reduce((s, e) => s + e.amount, 0),
    weekCount: rows.length,
    weekAmount: rows.reduce((s, e) => s + e.amount, 0),
  };
}

/**
 * Контакт клієнта — окремим викликом, не полем замовлення.
 * Це нагадування в самому API: телефон і точна адреса не звичайні дані,
 * а привілей, який видається під умову й логується (B15).
 */
export async function getOrderContact(orderId) {
  const rows = await call('get_order_contact', { p_order: orderId });
  if (!rows || !rows.length) throw err.permission('Контакт недоступний для цього замовлення');
  return toApp(rows[0]);
}

/* ── Дії курʼєра ───────────────────────────────────────────────────────────── */

export async function acceptOrder(orderId, courierId) {
  return toApp(await call('accept_order', { p_order: orderId, p_courier: courierId }));
}

export async function advanceStatus(orderId, courierId, toStatus) {
  return toApp(
    await call('advance_status', { p_order: orderId, p_courier: courierId, p_to: toStatus })
  );
}

export async function completeDelivery(orderId, courierId, { photoPath, pin, pinBypassed }) {
  return toApp(
    await call('complete_delivery', {
      p_order: orderId,
      p_courier: courierId,
      p_photo_path: photoPath,
      p_pin: pin || null,
      p_pin_bypassed: !!pinBypassed,
    })
  );
}

export async function cancelOrder(orderId, courierId, { reasonCode, note }) {
  return toApp(
    await call('cancel_order', {
      p_order: orderId,
      p_courier: courierId,
      p_reason: reasonCode,
      p_note: note || null,
    })
  );
}

export async function setCourierStatus(courierId, status) {
  return toApp(await call('set_courier_status', { p_courier: courierId, p_status: status }));
}

/** Позиція курʼєра. У продакшені живий рух іде Broadcast-ом (B16). */
export async function updateCourierLocation(courierId, pos) {
  await call('update_courier_location', {
    p_courier: courierId,
    p_lat: pos.lat,
    p_lng: pos.lng,
    p_accuracy: pos.accuracy ?? null,
  });
  return null;
}

export async function declareCashHandoff(courierId, amount) {
  return toApp(await call('declare_cash_handoff', { p_courier: courierId, p_amount: amount }));
}

/* ── Адмін ─────────────────────────────────────────────────────────────────── */

export async function fetchAdminOverview() {
  await call('tick');
  const s = db();
  const [orders, couriers, handoffs, earnings, events, payrolls, locations, business] =
    await Promise.all([
      s.from('orders').select('*').order('placed_at', { ascending: false }).limit(200),
      s.from('couriers').select('*'),
      s.from('cash_handoffs').select('*').order('declared_at', { ascending: false }),
      s.from('earnings_log').select('*'),
      s
        .from('order_status_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200),
      s.from('payrolls').select('*').order('created_at', { ascending: false }),
      s.from('courier_locations').select('*'),
      s.from('businesses').select('*').limit(1).maybeSingle(),
    ]);

  const first = [orders, couriers, handoffs, earnings, events, payrolls, locations].find(
    (r) => r.error
  );
  if (first) throw fail(first.error);

  // Код підтвердження вирізається ще раз, уже на клієнті. Дублювання
  // навмисне: якщо хтось колись розширить представлення, друга сітка
  // втримає (docs/05, «правило однієї сітки» — навпаки, дві)
  const publicOrders = toApp(orders.data || []).map(({ deliveryPin, ...safe }) => {
    void deliveryPin;
    return safe;
  });

  const locMap = {};
  for (const l of locations.data || []) {
    locMap[l.courier_id] = {
      lat: +l.lat,
      lng: +l.lng,
      accuracy: l.accuracy_m,
      at: Date.parse(l.updated_at),
    };
  }

  return {
    business: toApp(business.data),
    orders: publicOrders,
    couriers: toApp(couriers.data || []),
    handoffs: toApp(handoffs.data || []),
    earnings: toApp(earnings.data || []),
    events: toApp(events.data || []),
    payrolls: toApp(payrolls.data || []),
    photos: publicOrders
      .filter((o) => o.proofPhotoPath)
      .map((o) => ({ orderId: o.id, path: o.proofPhotoPath, createdAt: o.deliveredAt })),
    locations: locMap,
    demo: {},
    stats: buildStats(publicOrders, couriers.data || []),
  };
}

function buildStats(orders, couriers) {
  const delivered = orders.filter((o) => o.status === 'delivered');
  const durations = delivered
    .filter((o) => o.readyAt && o.deliveredAt)
    .map((o) => (o.deliveredAt - o.readyAt) / 60000);

  return {
    total: orders.length,
    delivered: delivered.length,
    active: orders.filter((o) =>
      ['ready', 'courier_assigned', 'picked_up', 'on_the_way'].includes(o.status)
    ).length,
    online: couriers.filter((c) => c.status === 'online').length,
    overdue: orders.filter((o) => o.isOverdue).length,
    stale: 0,
    failed: orders.filter((o) => o.status === 'failed_delivery').length,
    refunds: orders.filter((o) => o.paymentStatus === 'refund_needed').length,
    avgMinutes: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0,
    unconfirmedCash: couriers.reduce((s, c) => s + Number(c.cash_on_hand || 0), 0),
    platformEarnings: delivered.length * 15,
    collectedDelivery: delivered.reduce((s, o) => s + Number(o.deliveryFee || 0), 0),
    courierPayout: delivered.length * 35,
  };
}

export async function confirmHandoff(handoffId, amount) {
  return toApp(await call('confirm_handoff', { p_handoff: handoffId, p_amount: amount }));
}

export async function createPayroll(courierId) {
  return toApp(await call('create_payroll', { p_courier: courierId }));
}

export async function payPayroll(payrollId) {
  return toApp(await call('pay_payroll', { p_payroll: payrollId }));
}

/**
 * Створення замовлення. У продакшені це робить чекаут cstllife
 * (docs/14-cstllife-integration.md) — тут функція існує для адмінських
 * сценаріїв і наскрізних перевірок.
 */
export async function createOrder(payload) {
  return toApp(
    await call('place_order', {
      p_business_ref: payload.businessRef,
      p_items: payload.items || [],
      p_items_total: payload.itemsTotal,
      p_payment_method: payload.paymentMethod,
      p_client_name: payload.clientName,
      p_client_phone: payload.clientPhone,
      p_dest_address: payload.destAddressText,
      p_dest_lat: payload.destLat,
      p_dest_lng: payload.destLng,
      p_dest_landmark: payload.destLandmark || null,
      p_dest_locality: payload.destLocality || null,
      p_idempotency_key: payload.idempotencyKey || null,
    })
  );
}

/* ── Операції закладу ───────────────────────────────────────────────────────
   У продакшені їх виконує кабінет на cstllife (ADR-0001). Поки той не
   підключений — адмін через вкладку «Замовлення» (ADR-0012). Функції
   ті самі, які викликатиме cstllife: правила проходять один шлях. */

export async function businessAcceptOrder(orderId, minutes) {
  return toApp(await call('business_accept_order', { p_order: orderId, p_minutes: minutes }));
}

export async function businessMarkReady(orderId) {
  return toApp(await call('business_mark_ready', { p_order: orderId }));
}

export async function businessRejectOrder(orderId, reason) {
  return toApp(await call('business_reject_order', { p_order: orderId, p_reason: reason }));
}

/**
 * Створення курʼєра йде через Edge Function із ключем service_role:
 * пароль генерується сервером і показується адміну рівно один раз (B17).
 * Ключ service_role у фронтенді не зʼявляється ніколи.
 */
export async function createCourier({ fullName, phone }) {
  const { data, error } = await db().functions.invoke('create-courier', {
    body: { fullName, phone },
  });
  if (error) throw await functionError(error);
  return data;
}

/**
 * Розшифровка відмови Edge Function.
 *
 * ⚠️ `supabase-js` на будь-який не-2xx кидає рівно один рядок:
 * «Edge Function returned a non-2xx status code». Наше пояснення —
 * «Тільки адміністратор може створювати курʼєрів», «Вкажи повне імʼя» —
 * лежить у ТІЛІ відповіді й до людини не доходило взагалі.
 *
 * Окремо розпізнається найчастіший випадок: функції просто немає.
 * Її треба розгорнути один раз у дашборді, і без цієї підказки симптом
 * виглядає як зламана кнопка — саме так його й побачив власник.
 */
/**
 * Другий шлях: обліковий запис уже створений у дашборді Supabase,
 * застосунок лише привʼязує до нього картку курʼєра.
 *
 * Навіщо він є. Перший шлях (createCourier) вимагає розгорнутої Edge
 * Function, а розгорнути її може тільки власник проєкту. Поки він цього
 * не зробив, кнопка не могла спрацювати НІКОЛИ — застосунок упирався в
 * дію, яку сам виконати не здатен. Тут не потрібно нічого, крім бази.
 *
 * Правила (хто має право, чи існує пошта, чи не привʼязано вже) —
 * у функції бази, не тут. Клієнтська перевірка захистом не є.
 */
export async function linkCourier({ email, fullName, phone }) {
  return toApp(
    await call('link_courier', {
      p_email: email,
      p_full_name: fullName,
      p_phone: phone || null,
    })
  );
}

async function functionError(error) {
  const res = error?.context;

  // Мережа не дійшла або 404 — функцію не розгорнуто
  if (!res || res.status === 404) {
    return err.server(
      'Серверну функцію create-courier не розгорнуто. Як це зробити — крок 6 у docs/15-setup-supabase.md'
    );
  }

  const body = await res
    .clone()
    .json()
    .catch(() => null);
  const message = body?.error || error.message;

  if (res.status === 403) return err.permission(message);
  if (res.status === 400) return err.validation(message);
  return err.server(message);
}

export async function setCourierActive(courierId, isActive) {
  const { data, error } = await db()
    .from('couriers')
    .update({ is_active: isActive })
    .eq('id', courierId)
    .select()
    .maybeSingle();
  if (error) throw fail(error);
  return toApp(data);
}

/* ── Конфігурація ──────────────────────────────────────────────────────────
   Значення дублюють delivery.app_config для першого рендера: показати
   «—» замість суми, поки летить запит, гірше, ніж показати правильне
   число. Джерело істини — база; ці числа лише запасний варіант. */
export const config = {
  deliveryFee: 50,
  courierPerDelivery: 35,
  platformPerDelivery: 15,
  maxDeliveryRadiusKm: Number(process.env.VITE_MAX_DELIVERY_RADIUS_KM) || 15,
  maxActiveOrdersPerCourier: Number(process.env.VITE_MAX_ACTIVE_ORDERS_PER_COURIER) || 1,
  waitingBonusSteps: [
    { afterMin: 10, bonus: 10 },
    { afterMin: 20, bonus: 20 },
  ],
};

/* ── Синхронізація ──────────────────────────────────────────────────────────
   Realtime поважає RLS: у канал приходять лише ті рядки, які підписник і
   так має право прочитати. Це та сама політика, а не друга, узгоджена
   вручну — інакше витік стався б саме через канал.

   ⚠️ Повертає функцію відписки або null. Опитування при цьому НЕ
   вимикається, лише сповільнюється: після розриву звʼязку події не
   «догортаються», і без повного перечитування черга залишиться застарілою
   (docs/12, розділ 5). Realtime — прискорювач, а не єдине джерело. */
export function watchOrders(onChange) {
  const channel = db()
    .channel('rd-orders')
    .on('postgres_changes', { event: '*', schema: 'delivery', table: 'orders' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'delivery', table: 'cash_handoffs' }, onChange)
    .subscribe();

  return () => db().removeChannel(channel);
}
