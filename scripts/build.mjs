import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { publicEnvDefine, adapterPath, isProduction } from './config.mjs';

const OUT = 'dist';

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
  outdir: OUT,
  define: publicEnvDefine(),
  // Підміна бекенду на збірці: dev → mock, production → supabase.
  // Саме тому демо-доступи фізично відсутні у продакшн-бандлі (B18).
  alias: { '#adapter': resolve(adapterPath()) },
  logLevel: 'info',
});

await cp('public', OUT, { recursive: true });

console.log(`✅ Збірка готова → ${OUT} (бекенд: ${isProduction() ? 'supabase' : 'mock'})`);
