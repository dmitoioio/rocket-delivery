/**
 * Склеює міграції в один файл для вставки в SQL Editor Supabase.
 *
 * Навіщо. Автонакат через інтеграцію з GitHub має два «якщо»: гілка
 * має бути змерджена в бойову, а інтеграція — доступна на тарифі.
 * Обидва «якщо» вже спрацювали проти нас: база лишилась порожньою, і
 * перший же запит відповів `relation "delivery.businesses" does not exist`.
 * Вставити один файл руками — шлях без жодного «якщо».
 *
 * Порядок склейки той самий, що й у `scripts/db-local.mjs`: сортування за
 * іменем файлу. Інакше «що накотиться в Supabase» і «що перевіряють
 * 60 тестів» були б різними речами, а тести — беззмістовними.
 *
 *   node scripts/bundle-sql.mjs           записати supabase/SETUP.sql
 *   node scripts/bundle-sql.mjs --check    порівняти, нічого не писати
 *
 * Результат комітиться, бо його відкриває людина. А щоб комітнутий файл
 * не розійшовся з міграціями — `--check` викликається з тестів.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = 'supabase/migrations';
export const BUNDLE = 'supabase/SETUP.sql';

const line = '═'.repeat(75);

/** Файли накату в порядку застосування. Тільки .sql: у теці ще .gitkeep. */
export function migrationFiles() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

export function buildBundle() {
  const files = migrationFiles();

  const head = `-- ${line}
-- ROCKET DELIVERY — ПОВНЕ ВСТАНОВЛЕННЯ БАЗИ
--
-- Згенеровано з ${MIGRATIONS}/ командою \`npm run db:bundle\`.
-- ⚠️ Руками НЕ правити: правка загубиться при наступній генерації,
--    а тест у test/migrations.test.js одразу почервоніє. Правити треба
--    міграцію, з якої цей рядок прийшов.
--
-- ЯК КОРИСТУВАТИСЬ
--   Supabase → SQL Editor → New query → вставити весь файл → Run.
--
-- Запускати можна скільки завгодно разів: кожен крок ідемпотентний
-- (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP POLICY IF EXISTS, насіння під WHERE NOT EXISTS). Тому пізніший
-- автонакат тих самих міграцій із гілки main пройде поверх без конфлікту.
--
-- ЧОГО ТУТ НЕМАЄ: supabase/shim/ — він створює ролі anon, authenticated,
-- service_role і схему auth, які в Supabase УЖЕ Є. Шим потрібен лише
-- локальному Postgres; накат його в реальний проєкт зламав би проєкт.
--
-- Файлів у складі: ${files.length}
-- ${line}

`;

  const body = files
    .map((f) => {
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8').trimEnd();
      return `-- ${line}\n-- ▼ ${f}\n-- ${line}\n\n${sql}\n`;
    })
    .join('\n');

  return `${head}${body}
-- ${line}
-- Кінець. Перевірка, що все стало на місце:
--
--   SELECT name, delivery_radius_km FROM delivery.businesses;
--
-- Має відповісти одним рядком: Суші Мар · 15
-- ${line}
`;
}

/* ── Запуск ──────────────────────────────────────────────────────────────── */

const isEntry = process.argv[1]?.endsWith('bundle-sql.mjs');

if (isEntry) {
  const bundle = buildBundle();

  if (process.argv.includes('--check')) {
    const current = readFileSync(BUNDLE, 'utf8');
    if (current !== bundle) {
      console.error(`❌ ${BUNDLE} розійшовся з міграціями. Полагодити: npm run db:bundle`);
      process.exit(1);
    }
    console.log(`✅ ${BUNDLE} збігається з ${migrationFiles().length} міграціями`);
  } else {
    writeFileSync(BUNDLE, bundle);
    const kb = Math.round(bundle.length / 1024);
    console.log(`✅ ${BUNDLE} — ${migrationFiles().length} міграцій, ~${kb} КБ`);
  }
}
