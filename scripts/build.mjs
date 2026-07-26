import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const OUT = 'dist';

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// Змінні середовища, які МОЖНА вбудовувати в бандл.
// Білий список, а не `process.env` цілком — інакше service_role-ключ
// одного дня опиниться у публічному JS (див. docs/05-roles-auth-rls.md).
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

const define = Object.fromEntries(
  PUBLIC_ENV.map((k) => [`process.env.${k}`, JSON.stringify(process.env[k] ?? '')])
);

await build({
  entryPoints: ['src/app/main.js'],
  bundle: true,
  minify: true,
  sourcemap: true,
  format: 'esm',
  target: ['es2022'],
  outfile: `${OUT}/app.js`,
  define,
});

await cp('public', OUT, { recursive: true });

console.log('✅ Збірка готова →', OUT);
