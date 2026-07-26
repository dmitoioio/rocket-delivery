/**
 * Збірка застосунку в ОДИН самодостатній HTML-файл.
 *
 * Навіщо: показати робочий застосунок без деплою й без бекенду — файл
 * можна відкрити з диска, надіслати в месенджер або опублікувати будь-де.
 * Усередині моковий адаптер, тож жодного мережевого запиту не робиться.
 *
 * Це demo-артефакт, не продакшн-збірка: для продакшену — build.mjs.
 */

import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { publicEnvDefine } from './config.mjs';

const OUT_DIR = 'dist-standalone';
const TMP = join(OUT_DIR, '.tmp');
const target = process.argv[2] || join(OUT_DIR, 'rocket-delivery.html');

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });

await build({
  entryPoints: { app: 'src/app/main.js' },
  bundle: true,
  // Без code splitting і як IIFE: динамічних імпортів у моковій гілці немає,
  // а вбудований <script> має бути одним самодостатнім шматком
  splitting: false,
  format: 'iife',
  minify: true,
  sourcemap: false,
  target: ['es2022', 'safari16'],
  outdir: TMP,
  define: publicEnvDefine(),
  alias: { '#adapter': resolve('src/lib/adapters/mock.js') },
});

const js = await readFile(join(TMP, 'app.js'), 'utf8');
const css = await readFile(join(TMP, 'app.css'), 'utf8');

const html = `<title>Rocket Delivery — курʼєрський застосунок cstllife</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">

<style>
${css}
</style>

<div id="app"></div>

<script>
${js}
</script>
`;

await mkdir(resolve(target, '..'), { recursive: true });
await writeFile(target, html, 'utf8');
await rm(TMP, { recursive: true, force: true });

const kb = (new TextEncoder().encode(html).length / 1024).toFixed(1);
console.log(`✅ Самодостатній файл готовий → ${target} (${kb} КБ)`);
