/**
 * Смоук оболонки: вхід працює, а набране не зникає під фоновим оновленням.
 *
 * Баг, заради якого це існує. Рендер замінює розмітку цілком — разом
 * із полями введення й фокусом. Поки екранів із формами не було, це
 * нічого не коштувало. Щойно зʼявилась вкладка «Замовлення» й жива база
 * з Realtime, кожна чужа подія — курʼєр вийшов на лінію, змінився
 * статус — стирала те, що людина зараз друкує:
 *
 *   «я не можу вписати, мене просто викидає і весь текст пропадає»
 *
 * Перевіряються ЧОТИРИ речі, бо однобока перевірка тут гірша за жодну:
 * фікс, який просто вимкнув би оновлення екрана, пройшов би другу
 * перевірку й зламав дві інші. Що й сталось — перша версія фікса
 * зберегла текст і зламала вхід.
 *
 *   1. Вхід логіном і паролем узагалі працює.
 *   2. Форма заповнена → фонове оновлення НЕ чіпає ні текст, ні фокус.
 *   3. Форма порожня   → фонове оновлення таки перемальовує екран.
 *   4. Повідомлення про помилку видно ПОВЕРХ модальної шторки, а не під
 *      нею — інакше відмова сервера виглядає як зламана кнопка.
 *   5. Курʼєра можна додати без Edge Function — привʼязкою до наявного
 *      облікового запису.
 *
 * Прокрутки серед перевірок немає навмисно: я підозрював той самий баг
 * і виміряв — `.shell` має `min-height: 100dvh`, тож гортається документ,
 * а не контейнер, який замінює рендер. Позиція переживає перемальовування
 * (заміряно: 200px до, 200px після). Фікс без бага не пишеться.
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
  console.warn(`⚠️  ${message} — смоук оболонки пропущено`);
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

// Телефонний розмір: на ньому й працюють люди
const page = await browser.newPage({ viewport: { width: 390, height: 760 } });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

const problems = [];

async function finish() {
  await browser.close();
  server.close();
  if (problems.length) {
    console.error('\n❌ смоук оболонки не пройдено:');
    for (const p of problems) console.error(`   • ${p}`);
    process.exit(1);
  }
  console.log('\n✅ смоук оболонки: 5/5');
  process.exit(0);
}

/* ── 1. Вхід логіном і паролем ───────────────────────────────────────────── */
// Не демо-кнопкою: у реального курʼєра її немає, і саме цей шлях зламала
// перша версія фікса — після правильного пароля екран не перемальовувався,
// кнопка застрягала на «Вхід…», людина лишалась на екрані входу.

// У demo-збірці форма схована під розкривачкою; у продакшені вона одразу
// на екрані, бо демо-кнопок там немає взагалі
await page.evaluate(() =>
  document.querySelector('details.login__manual')?.setAttribute('open', '')
);
await page.fill('#login', 'boss-rocket');
await page.fill('#password', 'RocketBoss26');
await page.click('#login-submit');

const loggedIn = await page
  .waitForSelector('#screen', { timeout: 8000 })
  .then(() => true)
  .catch(() => false);

if (!loggedIn) {
  const stuck = (await page.textContent('#login-submit').catch(() => '')) || '';
  problems.push(`вхід не відбувся — кнопка показує ${JSON.stringify(stuck.trim())}`);
  console.log('❌ 1/5 вхід не спрацював');
  await finish();
}
console.log('✅ 1/5 вхід логіном і паролем');

await page.click('[data-tab="orders"]');
await page.waitForSelector('#no-name');

/* ── 2. Заповнена форма переживає фонове оновлення ───────────────────────── */

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

const wiped = [];
if (kept.name !== NAME) wiped.push(`імʼя стерто: ${JSON.stringify(kept.name)}`);
if (kept.phone !== PHONE) wiped.push(`телефон стерто: ${JSON.stringify(kept.phone)}`);
if (kept.street !== STREET) wiped.push(`вулицю стерто: ${JSON.stringify(kept.street)}`);
if (kept.focus !== 'no-address') wiped.push(`фокус забрано: ${kept.focus || '(нічого)'}`);

problems.push(...wiped);
console.log(wiped.length ? '❌ 2/5 набране не вціліло' : '✅ 2/5 набране й фокус на місці');

/* ── 3. Порожня форма НЕ блокує оновлення ────────────────────────────────── */

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
console.log(frozen ? '❌ 3/5 екран не перемальовується' : '✅ 3/5 екран оновлюється сам');

/* ── 4. Повідомлення видно поверх модальної шторки ───────────────────────── */
// «Кнопка не працює»: запит ішов, сервер відмовляв, пояснення малювалось
// ПІД темним тлом шторки (.toast-host мав z-index 60 проти 70 у шторки).
// Найдорожчий випадок — курʼєр під дверима тисне «Готово» без фото.
//
// Перевіряється саме видимість, а не значення z-index: `getComputedStyle`
// підтвердив би, що число дорівнює 80, і нічого не сказав би про те, чи
// людина це побачить.

await page.click('[data-tab="couriers"]');
await page.waitForSelector('[data-action="open-create-courier"]');
await page.click('[data-action="open-create-courier"]');
await page.waitForSelector('.sheet-backdrop');

// Тиснемо «Створити» з порожніми полями — застосунок відмовляє й показує
// причину. Саме цей шлях і виглядав як «кнопка не працює»
await page.click('[data-action="create-courier"]');

const shown = await page
  .waitForSelector('.toast', { timeout: 4000 })
  .then(() => true)
  .catch(() => false);

if (!shown) {
  problems.push('відмова не показала жодного повідомлення');
  console.log('❌ 4/4 повідомлення не зʼявилось');
} else {
  const onTop = await page.evaluate(() => {
    const node = document.querySelector('.toast');
    const host = node.parentElement;

    // ⚠️ У `.toast-host` стоїть `pointer-events: none` — щоб тост не
    // перехоплював натискання. Але через це `elementFromPoint` дивиться
    // КРІЗЬ нього й завжди повертає те, що під ним. Перша версія цієї
    // перевірки саме так і «знайшла» баг на вже виправленому коді.
    // Знімаємо рівно на час заміру: нас цікавить порядок шарів, а
    // hit-test — лише інструмент, яким його видно.
    const prev = host.style.pointerEvents;
    host.style.pointerEvents = 'auto';

    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

    host.style.pointerEvents = prev;

    return {
      ok: node === hit || node.contains(hit),
      hit: hit?.className || '(нічого)',
      text: node.textContent.trim(),
    };
  });

  if (!onTop.ok) {
    problems.push(`повідомлення «${onTop.text}» сховане — у його точці лежить .${onTop.hit}`);
  }
  console.log(
    onTop.ok ? `✅ 4/5 видно поверх шторки: «${onTop.text}»` : '❌ 4/5 повідомлення сховане'
  );
}

/* ── 5. Курʼєра можна додати без Edge Function ───────────────────────────── */
// Автоматичне створення вимагає розгорнутої Edge Function, і поки власник
// її не розгорнув, кнопка не могла спрацювати НІКОЛИ. Другий шлях —
// привʼязка до вже наявного облікового запису — має працювати завжди.

await page.fill('#nc-name', 'Петро Коваль');
await page.fill('#nc-email', 'kurier.petro@example.test');
await page.click('[data-action="link-courier"]');

const linked = await page
  .waitForSelector('.sheet__title:text("Курʼєра створено")', { timeout: 6000 })
  .then(() => true)
  .catch(() => false);

if (!linked) {
  const said = (await page.textContent('.toast').catch(() => '')) || '(жодного повідомлення)';
  problems.push(`привʼязка курʼєра не вдалась: ${said.trim()}`);
}
console.log(linked ? '✅ 5/5 курʼєра привʼязано без Edge Function' : '❌ 5/5 привʼязка не вдалась');

await finish();
