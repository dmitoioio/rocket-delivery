/** Спільна конфігурація збірки для build.mjs, dev.mjs і standalone.mjs. */

import { execFileSync } from 'node:child_process';

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

/**
 * Три середовища, а не два:
 *
 *   development — локальна розробка, моковий бекенд
 *   demo        — GitHub Pages: моковий бекенд, але це публічна адреса.
 *                 Реальних даних за ним немає, тож демо-доступи тут
 *                 нічого не захищають і нічим не ризикують.
 *   production  — реальний Supabase. Демо-адаптера в бандлі немає взагалі,
 *                 і CI це перевіряє (B18).
 */
export function isProduction() {
  return process.env.VITE_APP_ENV === 'production';
}

export function isDemo() {
  return process.env.VITE_APP_ENV === 'demo';
}

/**
 * Який адаптер даних потрапить у бандл.
 * Supabase — тільки для production. Скрізь інде моковий: він містить
 * повну бізнес-логіку в памʼяті й дозволяє показати робочий застосунок
 * до появи реальної схеми.
 */
export function adapterPath() {
  return isProduction() ? 'src/lib/adapters/supabase.js' : 'src/lib/adapters/mock.js';
}

/**
 * Демо-вхід одним кліком. У продакшені підставляється заглушка, тож
 * кнопок ролей і демо-тексту в бандлі немає фізично, а не як мертвий код.
 *
 * ⚠️ Саме підміна модуля, а не `if (isDemo)`: esbuild не згортає
 * імпортовану константу в умові, і перевірене вимірюванням — розмітка
 * лишалась у бандлі. Гарантія має бути структурною (B18).
 */
export function demoPath() {
  return isProduction() ? 'src/features/demo/demo.stub.js' : 'src/features/demo/demo.js';
}

/** Аліаси модулів, що підміняються на збірці. */
export function buildAliases(resolve) {
  return {
    '#adapter': resolve(adapterPath()),
    '#demo': resolve(demoPath()),
  };
}

export function publicEnvDefine() {
  return {
    ...Object.fromEntries(
      PUBLIC_ENV.map((k) => [`process.env.${k}`, JSON.stringify(process.env[k] ?? '')])
    ),
    ...buildStampDefine(),
  };
}

/* ── Штамп збірки ───────────────────────────────────────────────────────── */

/**
 * Номер збірки — це кількість комітів, а не рукописна цифра.
 *
 * Рукописну забувають підняти саме тоді, коли на неї дивляться:
 * бачиш ту саму цифру й не знаєш, чи деплой не доїхав, чи хтось
 * не оновив константу. Лічильник комітів росте сам і монотонно,
 * тож «34 → 35» означає рівно те, що здається.
 */
function git(args, fallback) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return fallback;
  }
}

export function buildStamp() {
  // На GitHub Actions checkout за замовчуванням мілкий (depth=1), тож
  // rev-list дав би «1». Тому в CI довантажуємо історію — див. ci.yml
  // і deploy-pages.yml: fetch-depth: 0
  const build = git(['rev-list', '--count', 'HEAD'], '0');
  const sha = git(['rev-parse', '--short=7', 'HEAD'], process.env.GITHUB_SHA?.slice(0, 7) || '—');
  return { build, sha, at: new Date().toISOString() };
}

function buildStampDefine() {
  const s = buildStamp();
  return {
    __BUILD_NUMBER__: JSON.stringify(s.build),
    __BUILD_SHA__: JSON.stringify(s.sha),
    __BUILD_AT__: JSON.stringify(s.at),
  };
}
