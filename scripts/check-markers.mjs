/**
 * Маркери демо: перевірка В ОБИДВА БОКИ.
 *
 * Що стережемо. Демо-дані, поверхні cstllife і пульт симуляції не мають
 * існувати у продакшн-бандлі навіть мертвим кодом (B18). Перевіряється це
 * пошуком рядків-маркерів.
 *
 * ⚠️ Чому цей файл узагалі зʼявився. За одну добу маркери протухли ТРИЧІ,
 * і щоразу по-різному:
 *
 *   1. «Суші Мар» не знаходився НІКОЛИ — esbuild екранував кирилицю
 *      у \uXXXX. Перевірка була зелена й порожня (виправлено charset).
 *   2. «Метельне» стало ознакою продакшену — село потрапило в довідник
 *      LOCALITIES. CI червонів на правильному коді.
 *   3. «Готово до забору» — те саме: напис на кнопці кухні в адмінці.
 *
 * Випадки 2 і 3 ловляться очима, випадок 1 — ні. Тому перевірок дві:
 *
 *   absent  — маркерів НЕМА у продакшн-збірці (те, заради чого все);
 *   present — маркери Є у demo-збірці (доказ, що вони ще щось значать).
 *
 * Маркер, якого немає ніде, мовчки проходить завжди — і саме таким був
 * випадок 1, найдорожчий, бо виглядав як робоча охорона.
 *
 *   node scripts/check-markers.mjs absent    # після продакшн-збірки
 *   node scripts/check-markers.mjs present   # після demo-збірки
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Один список замість чотирьох копій у YAML. Кожен рядок має бути таким,
 * якого в реальній системі не існує: вигаданий курʼєр, страва з демо-меню,
 * порожній стан симульованої поверхні.
 */
const GROUPS = {
  'мокові дані': ['Олег Ткачук', 'rd-oleh-07', 'О. Денисюка', 'Демо-режим'],
  'поверхні cstllife': [
    'симуляція cstllife',
    'Симуляція cstllife',
    'Філадельфія',
    'Замовлень ще немає',
    'Код для курʼєра',
    'Куди везти',
  ],
  'пульт демо': [
    'Пульт демо',
    'Генератор замовлень',
    'Автопілот кухні',
    'demo-generator',
    'demo-spawn',
    'setDemoSettings',
  ],
  'демо-вхід': ['data-demo', 'data-role', 'reset-demo'],
};

const mode = process.argv[2];
if (mode !== 'absent' && mode !== 'present') {
  console.error('Використання: node scripts/check-markers.mjs absent|present');
  process.exit(2);
}

/** Увесь текст збірки одним рядком: маркер може бути в будь-якому файлі. */
function bundleText(dir = 'dist') {
  let text = '';
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      text += bundleText(path);
      continue;
    }
    if (/\.(js|css|html|json|map)$/.test(name)) text += readFileSync(path, 'utf8');
  }
  return text;
}

const text = bundleText();
const problems = [];

for (const [group, markers] of Object.entries(GROUPS)) {
  for (const marker of markers) {
    const found = text.includes(marker);

    if (mode === 'absent' && found) {
      problems.push(`${group}: «${marker}» потрапив у продакшн-збірку`);
    }
    if (mode === 'present' && !found) {
      problems.push(
        `${group}: «${marker}» не знайдено в demo-збірці — маркер більше нічого не стереже`
      );
    }
  }
}

const total = Object.values(GROUPS).reduce((n, g) => n + g.length, 0);

if (problems.length) {
  const why =
    mode === 'absent'
      ? 'демо не має існувати в продакшн-бандлі (B18, docs/09-audit.md)'
      : 'маркер мусить бути живим, інакше перевірка «absent» проходить порожньою';
  console.error(`❌ ${why}`);
  for (const p of problems) console.error(`   • ${p}`);
  process.exit(1);
}

console.log(
  mode === 'absent'
    ? `✅ жодного з ${total} демо-маркерів у продакшн-збірці немає`
    : `✅ усі ${total} маркерів живі: вони є в demo-збірці, отже перевірка не порожня`
);
