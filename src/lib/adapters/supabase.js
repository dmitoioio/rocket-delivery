/**
 * Supabase-адаптер — реальний бекенд.
 *
 * ⚠️ ЗАГЛУШКА. Реалізується на етапі 3–4 дорожньої карти, ПІСЛЯ того як
 * буде прочитано схему CSTL_NEWS і створено таблиці (docs/10-roadmap.md).
 * Створювати таблиці наосліп заборонено: Rocket Delivery живе в тому
 * самому проєкті Supabase, що й cstllife (ADR-0001).
 *
 * Контракт цього модуля збігається з adapters/mock.js один в один.
 * Моковий адаптер є референсною реалізацією бізнес-правил — звіряти з ним.
 *
 * Кожна функція нижче, крім читання, має виконуватись через RPC або Edge
 * Function, а не прямим запитом із браузера (docs/02-architecture.md):
 *  • acceptOrder      — атомарний умовний UPDATE, інакше гонка (B25)
 *  • completeDelivery — інваріант «фото обовʼязкове» + нарахування заробітку
 *  • declareCashHandoff / confirmHandoff — двосторонній протокол (ADR-0008)
 *  • getOrderContact  — перевірка «цей курʼєр і замовлення активне» (B15)
 *  • createCourier    — потрібен service_role
 */

import { err } from '../errors.js';

export const name = 'supabase';

/**
 * Демо-доступів у продакшені немає — і це не «забули додати», а вимога:
 * підказка на екрані логіна з'являється, лише якщо адаптер її віддає (B18).
 * Експортуємо явний null, щоб збірка не попереджала про відсутній експорт.
 */
export const demoCredentials = null;

/** @type {import('@supabase/supabase-js').SupabaseClient|null} */
let client = null;

/** Ліниве створення клієнта — щоб бандл не тягнув його на екрані логіна. */
async function getClient() {
  if (client) return client;
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw err.server('Supabase не налаштований');

  const { createClient } = await import('@supabase/supabase-js');
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

const TODO = (fn) => {
  throw err.server(`Supabase-адаптер: ${fn} ще не реалізовано`);
};

export async function signIn() {
  await getClient();
  // supabase.auth.signInWithPassword — роль читається з app_metadata,
  // НЕ з user_metadata (користувач може редагувати user_metadata сам)
  return TODO('signIn');
}

export async function signOut() {
  const c = await getClient();
  await c.auth.signOut();
}

export async function fetchQueue() {
  // SELECT з VIEW courier_queue — без телефону, точної адреси
  // й способу оплати (B15, B35)
  return TODO('fetchQueue');
}

export async function fetchActive() {
  return TODO('fetchActive');
}
export async function fetchHistory() {
  return TODO('fetchHistory');
}
export async function fetchCourier() {
  return TODO('fetchCourier');
}
export async function acceptOrder() {
  return TODO('acceptOrder');
}
export async function advanceStatus() {
  return TODO('advanceStatus');
}
export async function completeDelivery() {
  return TODO('completeDelivery');
}
export async function cancelOrder() {
  return TODO('cancelOrder');
}
export async function setCourierStatus() {
  return TODO('setCourierStatus');
}
export async function declareCashHandoff() {
  return TODO('declareCashHandoff');
}
export async function getOrderContact() {
  return TODO('getOrderContact');
}
export async function fetchAdminOverview() {
  return TODO('fetchAdminOverview');
}
export async function confirmHandoff() {
  return TODO('confirmHandoff');
}
export async function createCourier() {
  return TODO('createCourier');
}
export async function setCourierActive() {
  return TODO('setCourierActive');
}

export const config = {
  deliveryFee: 50,
  courierPerDelivery: 40,
  maxDeliveryRadiusKm: Number(process.env.VITE_MAX_DELIVERY_RADIUS_KM) || 15,
  maxActiveOrders: Number(process.env.VITE_MAX_ACTIVE_ORDERS_PER_COURIER) || 1,
  cashLimit: 2000,
  cashLimitNovice: 500,
  noviceDeliveries: 20,
  waitingBonusSteps: [],
};
