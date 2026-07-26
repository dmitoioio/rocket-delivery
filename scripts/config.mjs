/** Спільна конфігурація збірки для build.mjs і dev.mjs. */

/**
 * Змінні середовища, які МОЖНА вбудовувати в бандл.
 * Білий список, а не process.env цілком — інакше service_role-ключ
 * одного дня опиниться у публічному JS (docs/05-roles-auth-rls.md).
 */
const PUBLIC_ENV = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_MAP_TILES_URL',
  'VITE_MAP_TILES_KEY',
  'VITE_GOOGLE_MAPS_KEY',
  'VITE_MAX_DELIVERY_RADIUS_KM',
  'VITE_MAX_ACTIVE_ORDERS_PER_COURIER',
  'VITE_APP_ENV',
];

export function isProduction() {
  return process.env.VITE_APP_ENV === 'production';
}

/**
 * Який адаптер даних потрапить у бандл.
 * Моковий адаптер містить демо-доступи й повну бізнес-логіку в памʼяті —
 * у продакшн-збірку він не потрапляє взагалі.
 */
export function adapterPath() {
  return isProduction() ? 'src/lib/adapters/supabase.js' : 'src/lib/adapters/mock.js';
}

export function publicEnvDefine() {
  return Object.fromEntries(
    PUBLIC_ENV.map((k) => [`process.env.${k}`, JSON.stringify(process.env[k] ?? '')])
  );
}
