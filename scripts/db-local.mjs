/**
 * Локальна база для розробки й тестів.
 *
 * Docker у середовищі недоступний, тож `supabase start` не працює. Але
 * без справжньої бази політики доступу неможливо ПЕРЕВІРИТИ — можна лише
 * написати й сподіватись. А саме там ціна помилки найвища: витік телефону
 * клієнта або читання коду підтвердження.
 *
 * Тому: звичайний PostgreSQL + шим, який додає те, що в Supabase уже є
 * (ролі anon/authenticated/service_role, схема auth, функція auth.uid()).
 * Політики й функції пишуться один раз і працюють в обох місцях.
 *
 *   node scripts/db-local.mjs up     підняти, накотити, засіяти
 *   node scripts/db-local.mjs reset  знести й накотити наново
 *   node scripts/db-local.mjs test   прогнати тести інваріантів
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const DB = process.env.PGDATABASE || 'rocket_delivery';
const MIGRATIONS = 'supabase/migrations';
const TESTS = 'supabase/tests';
const SHIM = 'supabase/shim/00-supabase-compat.sql';

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts });

function psql(args) {
  return run('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, ...args]);
}

/**
 * Тести читаються ІНАКШЕ, ніж міграції: `RAISE NOTICE` пише у stderr, а
 * execFileSync віддає stderr лише коли команда впала. Тобто на успішному
 * прогоні звіт був би порожній — і виглядало б, ніби тестів немає.
 * spawnSync повертає обидва потоки завжди.
 */
function psqlBoth(args) {
  const r = spawnSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, ...args], {
    encoding: 'utf8',
  });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
}

function clusterUp() {
  try {
    run('pg_isready', []);
    return;
  } catch {
    /* кластер лежить — піднімаємо */
  }
  run('pg_ctlcluster', ['16', 'main', 'start'], { stdio: 'inherit' });
}

function ensureDb() {
  const list = run('psql', [
    '-d',
    'postgres',
    '-tAc',
    `SELECT 1 FROM pg_database WHERE datname='${DB}'`,
  ]);
  if (!list.trim()) run('createdb', [DB]);
}

function sqlFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(dir, f));
}

/** Міграції накочуються ПО ПОРЯДКУ імен — саме тому вони й нумеровані. */
function migrate() {
  psql(['-f', SHIM]);
  for (const f of sqlFiles(MIGRATIONS)) {
    psql(['-f', f]);
    console.log(`  ✓ ${f}`);
  }
}

const cmd = process.argv[2] || 'up';

clusterUp();

if (cmd === 'reset') {
  // Схему зносимо цілком: часткове оновлення ховає помилки в міграціях,
  // які зʼявляться лише в чужого при першому накаті
  try {
    psql(['-c', 'DROP SCHEMA IF EXISTS delivery CASCADE']);
  } catch {
    /* бази ще немає */
  }
}

ensureDb();

if (cmd === 'test') {
  let failed = 0;
  // ⚠️ RAISE NOTICE йде у stderr, а не stdout — саме там усі ✅.
  // Читати лише stdout означало б бачити порожній звіт і вважати,
  // що тестів немає
  const clean = (s) => String(s || '').replace(/^psql.*NOTICE: {2}/gm, '');
  for (const f of sqlFiles(TESTS)) {
    const { out, code } = psqlBoth(['-f', f]);
    process.stdout.write(clean(out));
    if (code !== 0) failed++;
  }
  if (failed) {
    console.error(`\n❌ провалених файлів: ${failed}`);
    process.exit(1);
  }
  console.log('\n✅ інваріанти бази підтверджені');
} else {
  migrate();
  console.log(`✅ база ${DB} готова`);
}
