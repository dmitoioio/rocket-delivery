/**
 * Сторож накату міграцій.
 *
 * Ці перевірки не про SQL — його перевіряє `npm run db:test` на живому
 * Postgres. Вони про те, ЩО САМЕ Supabase піде накочувати, коли інтеграція
 * з GitHub спрацює сама, без людини поруч. Помилка тут коштує не червоного
 * тесту, а зламаного проєкту бази, який доведеться створювати наново.
 *
 * Дві речі, задля яких файл існує:
 *
 * 1. Шим (`supabase/shim/`) створює ролі anon, authenticated, service_role
 *    і схему `auth` — усе те, що в Supabase УЖЕ Є. Локальному Postgres це
 *    потрібно, реальному проєкту — фатально. План казав «закріпити
 *    перевіркою, а не сподіванням»: сподівання полягало в тому, що файл
 *    просто лежить в іншій теці, і одне необережне переміщення його зняло б.
 *
 * 2. Supabase відстежує накочене за міткою часу в імені файлу. Наші перші
 *    імена були `0001_schema.sql` — під таку назву накат або пропускається,
 *    або робиться вдруге. Обидва варіанти тихі.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildBundle, BUNDLE } from '../scripts/bundle-sql.mjs';

const MIGRATIONS = 'supabase/migrations';
const SHIM = 'supabase/shim/00-supabase-compat.sql';

// Тільки .sql: у теці лежить ще .gitkeep, і Supabase його не бачить
const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const sql = (f) => readFileSync(join(MIGRATIONS, f), 'utf8');

test('міграції взагалі є', () => {
  assert.ok(files.length >= 5, `знайдено ${files.length} файлів у ${MIGRATIONS}`);
});

test('імена у форматі Supabase: <14 цифр>_назва.sql', () => {
  for (const f of files) {
    assert.match(f, /^\d{14}_[a-z0-9_]+\.sql$/, `${f} — Supabase не впізнає таке ім'я`);
  }
});

test('мітки часу унікальні — інакше порядок накату невизначений', () => {
  const stamps = files.map((f) => f.slice(0, 14));
  assert.equal(new Set(stamps).size, stamps.length, `дублі: ${stamps.join(', ')}`);
});

test('алфавітний порядок = хронологічний', () => {
  const stamps = files.map((f) => f.slice(0, 14));
  assert.deepEqual(stamps, [...stamps].sort(), 'сортування імен має збігатися з порядком міток');
});

/**
 * 🛑 Головна перевірка файлу. Ролі й схему `auth` у Supabase створює сам
 * Supabase. Спроба зробити це вдруге міграцією — не помилка «щось не
 * застосувалось», а зламаний проєкт.
 */
test('жодна міграція не створює ролі Supabase і схему auth', () => {
  for (const f of files) {
    const body = sql(f);
    assert.doesNotMatch(body, /CREATE\s+ROLE/i, `${f} створює роль — це робота Supabase, не наша`);
    assert.doesNotMatch(
      body,
      /CREATE\s+SCHEMA(\s+IF\s+NOT\s+EXISTS)?\s+auth\b/i,
      `${f} створює схему auth — у Supabase вона вже є`
    );
    assert.doesNotMatch(
      body,
      /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+auth\./i,
      `${f} перевизначає функцію в auth — там живе автентифікація Supabase`
    );
  }
});

test('шим лежить поза теками накату', () => {
  assert.ok(existsSync(SHIM), 'шим потрібен локальним тестам RLS');
  assert.ok(
    !files.some((f) => f.includes('shim') || f.includes('compat')),
    "шим не має потрапляти в migrations ні під яким ім'ям"
  );
});

/**
 * Порожня база — не «майже готова». Перший же виклик place_order падає
 * з business_not_found, і виглядає це як баг застосунку, а не як
 * незаповнений довідник.
 */
test('насіння закладу є: після накату база не порожня', () => {
  const seeded = files.some((f) => /INSERT\s+INTO\s+delivery\.businesses/i.test(sql(f)));
  assert.ok(seeded, 'жодна міграція не додає заклад — черга курʼєра буде порожня назавжди');
});

/**
 * `supabase/SETUP.sql` — те, що Дмитро вставляє в SQL Editor руками. Це
 * копія міграцій, а копія рано чи пізно розходиться з оригіналом (Розділ 1).
 * Розходження тут особливо підле: файл виглядає свіжим, накат «успішний»,
 * а в базі стара схема.
 */
test('SETUP.sql збігається з міграціями', () => {
  assert.equal(
    readFileSync(BUNDLE, 'utf8'),
    buildBundle(),
    `${BUNDLE} відстав від міграцій — перегенерувати: npm run db:bundle`
  );
});

/**
 * Ідемпотентність накату. Прогін проти живого Postgres перевіряє це
 * по-справжньому, але він не в `npm test` (потрібен кластер), тож тут —
 * дешевий сторож на найчастішу пастку.
 *
 * `ADD CONSTRAINT IF NOT EXISTS` у Postgres НЕ ІСНУЄ. Рівно один такий
 * рядок пережив і рев'ю, і читання очима, і впав на другому прогоні
 * підряд: `constraint "orders_cash_handoff_fk" already exists`.
 */
test('ADD CONSTRAINT загорнутий у DO-блок — інакше повторний накат падає', () => {
  for (const f of files) {
    // Коментарі геть: слова «ADD CONSTRAINT IF NOT EXISTS не існує» у
    // поясненні поруч — не команда. Перша версія цього тесту ловила саме
    // їх і показувала червоне на правильному коді
    const code = sql(f).replace(/--[^\n]*/g, '');

    for (const m of code.matchAll(/ADD\s+CONSTRAINT\s+(\w+)/gi)) {
      assert.match(
        code.slice(Math.max(0, m.index - 300), m.index),
        /DO\s+\$\$\s*BEGIN/i,
        `${f}: ADD CONSTRAINT ${m[1]} без DO-блоку з EXCEPTION WHEN duplicate_object`
      );
    }
  }
});
