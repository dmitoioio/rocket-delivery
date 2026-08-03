/**
 * Смоук продакшн-збірки: чи вона взагалі відкривається.
 *
 * Навіщо саме це. CI перевіряв ВМІСТ продакшн-бандла — чи немає там
 * секретів, демо-доступів, мокового адаптера. І жодного разу його не
 * ВІДКРИВАВ. Тому баг, від якого застосунок падав до першого рядка
 * розмітки, проїхав усі перевірки й потрапив на живий сайт: `process`
 * у браузері не існує, а звертання `process.env[k]` збірник підставити
 * не може — імʼя приходило змінною.
 *
 * У demo цієї гілки коду немає взагалі, тож demo-збірка працювала.
 * Зламалось рівно тоді, коли сайт уперше став справжнім.
 *
 * Що робить: піднімає dist на локальному сервері В ПІДКАТАЛОЗІ (на
 * GitHub Pages застосунок живе не в корені домену — абсолютні шляхи
 * дали б ту саму білу сторінку), відкриває, і вимагає трьох речей:
 *   1. у #app щось є;
 *   2. немає помилок сторінки (pageerror);
 *   3. нічого не запитувалось повз базовий шлях.
 *
 * Мережеві помилки до бази ігноруються навмисно: ключі тут підставні,
 * до example.supabase.co застосунок не достукається — і не має.
 *
 *   node scripts/smoke-prod.mjs           fail-soft: немає браузера — попередити
 *   SMOKE_STRICT=1 node scripts/...        немає браузера — це помилка (CI)
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const DIST = 'dist';
const BASE = '/rocket-delivery/'; // такий самий підкаталог, як на Pages
const PORT = 4599;
const STRICT = process.env.SMOKE_STRICT === '1';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function softExit(message) {
  if (STRICT) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.warn(`⚠️  ${message}`);
  console.warn('   Смоук пропущено. Перевірка синтаксису й збірка від цього не залежать.');
  process.exit(0);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  softExit('playwright не встановлений');
}

const outside = [];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith(BASE)) {
    outside.push(url.pathname);
    res.writeHead(404).end();
    return;
  }
  let file = url.pathname.slice(BASE.length) || 'index.html';
  if (file.endsWith('/')) file += 'index.html';
  try {
    const body = await readFile(join(DIST, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    outside.push(`${url.pathname} (немає у dist)`);
    res.writeHead(404).end();
  }
});

await new Promise((resolve) => server.listen(PORT, resolve));

/**
 * Запасний шлях до браузера. Версія playwright у package.json і версія
 * браузера в середовищі можуть розійтись — тоді launch() шукає збірку,
 * якої немає. `PLAYWRIGHT_CHROMIUM_PATH` дозволяє показати наявну,
 * не переставляючи пакет.
 */
async function launch() {
  try {
    return await chromium.launch();
  } catch (first) {
    const path = process.env.PLAYWRIGHT_CHROMIUM_PATH;
    if (!path) throw first;
    return chromium.launch({ executablePath: path });
  }
}

let browser;
try {
  browser = await launch();
} catch (e) {
  server.close();
  softExit(`браузер не запустився: ${e.message.split('\n')[0]}`);
}

const page = await browser.newPage();
const fatal = [];

page.on('pageerror', (e) => fatal.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  const text = m.text();
  // Звернення до підставної бази впадуть — це очікувано й не є поломкою
  if (m.type() === 'error' && !/example\.supabase\.co|Failed to fetch|WebSocket/i.test(text)) {
    fatal.push(`console: ${text}`);
  }
});

await page.goto(`http://127.0.0.1:${PORT}${BASE}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

const app = (await page.$eval('#app', (el) => el.innerHTML.trim()).catch(() => '')) || '';

await browser.close();
server.close();

const problems = [];
if (!app) problems.push('#app порожній — застосунок не намалював нічого (білий екран)');
if (fatal.length) problems.push(...fatal);
if (outside.length) problems.push(`запити повз базовий шлях: ${outside.join(', ')}`);

if (problems.length) {
  console.error('❌ Продакшн-збірка не відкривається:');
  for (const p of problems) console.error(`   • ${p}`);
  process.exit(1);
}

console.log(`✅ смоук продакшену: сторінка відкрилась, розмітки ${app.length} символів, помилок 0`);
