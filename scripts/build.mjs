import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { publicEnvDefine, buildAliases, isProduction } from './config.mjs';

const OUT = 'dist';

/**
 * Продакшн без ключів — це білий екран, а не застосунок.
 *
 * ⚠️ Падати тут ОБОВʼЯЗКОВО, і саме гучно. Мовчазна збірка «успішна»,
 * після якої сайт відкривається й нічого не працює, — найгірший
 * можливий результат: виглядає як складна помилка, а насправді
 * забутий рядок у налаштуваннях.
 *
 * Як налаштувати — docs/15-setup-supabase.md, крок 3.
 */
if (isProduction() && (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY)) {
  console.error(`
❌ Продакшн-збірка без підключення до бази.

Немає: ${!process.env.VITE_SUPABASE_URL ? 'VITE_SUPABASE_URL ' : ''}${
    !process.env.VITE_SUPABASE_ANON_KEY ? 'VITE_SUPABASE_ANON_KEY' : ''
  }

Значення беруться в Supabase: Project Settings → API
   Project URL  → VITE_SUPABASE_URL
   anon public  → VITE_SUPABASE_ANON_KEY

Покроково: docs/15-setup-supabase.md

Щоб зібрати демо без бази:  VITE_APP_ENV=demo npm run build
`);
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await build({
  entryPoints: { app: 'src/app/main.js' },
  bundle: true,
  splitting: true, // Leaflet і supabase-js вантажаться окремими чанками
  minify: true,
  // Sourcemap лише поза продакшеном: інакше повний вихідний код
  // застосунку публікується разом із бандлом
  sourcemap: !isProduction(),
  format: 'esm',
  target: ['es2022', 'safari16'],
  // Без цього esbuild екранує кирилицю у \uXXXX. Це і роздуває бандл,
  // і — головне — робить перевірки CI на вміст беззмістовними: пошук
  // «Суші Мар» у бандлі не знаходив нічого НІКОЛИ, тож охоронна
  // перевірка мовчки проходила, нічого не перевіряючи.
  charset: 'utf8',
  outdir: OUT,
  define: publicEnvDefine(),
  // Підміна бекенду на збірці: dev → mock, production → supabase.
  // Саме тому демо-доступи фізично відсутні у продакшн-бандлі (B18).
  alias: buildAliases(resolve),
  logLevel: 'info',
});

await cp('public', OUT, { recursive: true });

console.log(`✅ Збірка готова → ${OUT} (бекенд: ${isProduction() ? 'supabase' : 'mock'})`);
