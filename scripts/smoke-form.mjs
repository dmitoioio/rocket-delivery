/**
 * Смоук форми: набране не зникає під фоновим оновленням.
 *
 * Баг, заради якого це існує. Рендер замінює розмітку цілком — разом
 * із полями введення й фокусом. Поки екранів із формами не було, це
 * нічого не коштувало. Щойно зʼявилась вкладка «Замовлення» й жива база
 * з Realtime, кожна чужа подія — курʼєр вийшов на лінію, змінився
 * статус — стирала те, що людина зараз друкує:
 *
 *   «я не можу вписати, мене просто викидає і весь текст пропадає»
 *
 * Перевіряються ОБИДВА напрямки, бо однобока перевірка тут гірша за
 * жодну: фікс, який просто вимкнув би оновлення екрана, пройшов би
 * першу половину й зламав застосунок.
 *
 *   1. Форма заповнена → фонове оновлення НЕ чіпає ні текст, ні фокус.
 *   2. Форма порожня   → фонове оновлення таки перемальовує екран.
 *
 * Працює на demo-збірці: перевіряється механіка оболонки, а не бекенд.
 * Запуск: npm run build (VITE_APP_ENV=demo), потім npm run smoke:form
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const DIST = 'dist';
const PORT = 4601;
const STRICT = process.env.SMOKE_STRICT === '1';
// Таймер фонового перечитування в shell.js — 15 с без Realtime
const TICK_MS = 17000;

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
  console.warn(`⚠️  ${message} — смоук форми пропущено`);
  process.exit(0);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  softExit('playwright не встановлений');
}

const server = createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\//, '') || 'index.html';
  try {
    const body = await readFile(join(DIST, p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(PORT, resolve));

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

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

// Демо-вхід адміном: кнопка адміна — темна
await page.click('.btn-role.btn-dark[data-demo]');
await page.waitForTimeout(600);
await page.click('[data-tab="orders"]');
await page.waitForSelector('#no-name');

const problems = [];

/* ── 1. Заповнена форма переживає фонове оновлення ───────────────────────── */

const NAME = 'Марина Коваль';
const PHONE = '+380671112233';
const STREET = 'вул. Лісова 12';

await page.fill('#no-name', NAME);
await page.fill('#no-phone', PHONE);
await page.focus('#no-address');
await page.type('#no-address', STREET, { delay: 15 });

await page.waitForTimeout(TICK_MS);

const kept = await page.evaluate(() => ({
  name: document.getElementById('no-name')?.value ?? '',
  phone: document.getElementById('no-phone')?.value ?? '',
  street: document.getElementById('no-address')?.value ?? '',
  focus: document.activeElement?.id || '',
}));

if (kept.name !== NAME) problems.push(`імʼя стерто: ${JSON.stringify(kept.name)}`);
if (kept.phone !== PHONE) problems.push(`телефон стерто: ${JSON.stringify(kept.phone)}`);
if (kept.street !== STREET) problems.push(`вулицю стерто: ${JSON.stringify(kept.street)}`);
if (kept.focus !== 'no-address') problems.push(`фокус забрано: ${kept.focus || '(нічого)'}`);

console.log(problems.length ? '❌ 1/2 набране не вціліло' : '✅ 1/2 набране й фокус на місці');

/* ── 2. Порожня форма НЕ блокує оновлення ────────────────────────────────── */

await page.evaluate(() => {
  for (const el of document.querySelectorAll('input, textarea')) el.value = '';
  document.activeElement?.blur();
  document.querySelector('#screen').dataset.probe = 'ще тут';
});

await page.waitForTimeout(TICK_MS);

const frozen = await page.evaluate(
  () => document.querySelector('#screen')?.dataset.probe === 'ще тут'
);
if (frozen) problems.push('екран завмер: порожня форма зупинила фонове оновлення');

console.log(frozen ? '❌ 2/2 екран не перемальовується' : '✅ 2/2 екран оновлюється сам');

await browser.close();
server.close();

if (problems.length) {
  console.error('\n❌ смоук форми не пройдено:');
  for (const p of problems) console.error(`   • ${p}`);
  process.exit(1);
}
console.log('\n✅ смоук форми: 2/2');
