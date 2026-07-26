import { context } from 'esbuild';
import { resolve } from 'node:path';
import { publicEnvDefine, buildAliases } from './config.mjs';

const ctx = await context({
  entryPoints: { app: 'src/app/main.js' },
  bundle: true,
  splitting: true,
  sourcemap: true,
  format: 'esm',
  target: ['es2022', 'safari16'],
  outdir: 'dist',
  define: publicEnvDefine(),
  alias: buildAliases(resolve),
});

await ctx.watch();

const { host, port } = await ctx.serve({
  servedir: 'public',
  // dist монтується поруч, щоб /app.js і /app.css віддавались зі збірки
  fallback: 'public/index.html',
  port: 5173,
});

console.log(`▶ Dev-сервер: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
console.log('  Бекенд: mock (дані в памʼяті, скидаються при перезавантаженні)');
