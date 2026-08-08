-- ═══════════════════════════════════════════════════════════════════════════
-- ТЕСТИ ПРИВʼЯЗКИ КУРʼЄРА ДО ОБЛІКОВОГО ЗАПИСУ
--
-- Це другий шлях створення курʼєра — той, що не потребує Edge Function.
-- Перший (create-courier) перевірити тут неможливо: Deno-рантайму Supabase
-- у середовищі розробки немає. Саме тому цей шлях і зроблений SQL-ним:
-- те, що можна перевірити, треба перевіряти.
--
-- Перевіряється не «функція існує», а що вона ВІДМОВЛЯЄ там, де мусить:
-- не-адміну, невідомій пошті, повторній привʼязці. Функція, яка лише
-- вміє спрацювати, але не вміє відмовити, — дірка, а не можливість.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF cond THEN RAISE NOTICE '  ✅ %', label;
  ELSE RAISE EXCEPTION '  ❌ %', label; END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.rejects(sql text, needle text, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(needle IN SQLERRM) > 0 THEN
      RAISE NOTICE '  ✅ % (відхилено: %)', label, left(SQLERRM, 48);
      RETURN;
    END IF;
    RAISE EXCEPTION '  ❌ % — впало, але не з тієї причини: %', label, SQLERRM;
  END;
  RAISE EXCEPTION '  ❌ % — НЕ впало, хоча мало', label;
END $$;

-- ── Насіння: обліковий запис, створений «у дашборді» ───────────────────────
DO $$
DECLARE u uuid; a uuid;
BEGIN
  INSERT INTO auth.users (email) VALUES ('kurier.petro@example.test') RETURNING id INTO u;
  INSERT INTO auth.users (email, raw_app_meta_data)
    VALUES ('boss@example.test', '{"role":"admin"}'::jsonb) RETURNING id INTO a;
  PERFORM set_config('t.u', u::text, false);
  PERFORM set_config('t.admin', a::text, false);
END $$;

\echo ''
\echo '═══ Хто має право привʼязувати ═══'

-- Не адмін. Саме з цього починаємо: якби перевірка права була
-- беззмістовною, решта тестів лише підтверджувала б зручність дірки
-- ⚠️ Обидві змінні, а не одна. auth.uid() у шимі читає
-- `request.jwt.claim.sub`, а auth.jwt() — цілий `request.jwt.claims`.
-- Задаси лише другу — is_admin() працює, а current_courier_id() мовчки
-- повертає NULL, і перевірка провалюється на цілком справному коді.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('t.u'), false);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('t.u'))::text, false);
END $$;

SELECT pg_temp.rejects(
  $f$ SELECT delivery.link_courier('kurier.petro@example.test', 'Петро Коваль') $f$,
  'not_admin', 'звичайний користувач не може привʼязати курʼєра');

-- Далі — від імені адміна
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('t.admin'), false);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('t.admin'),
                      'app_metadata', json_build_object('role', 'admin'))::text, false);
END $$;

SELECT pg_temp.ok(delivery.is_admin(), 'адмін розпізнається за app_metadata');

\echo ''
\echo '═══ Відмови ═══'

SELECT pg_temp.rejects(
  $f$ SELECT delivery.link_courier('nobody@example.test', 'Іван Іванов') $f$,
  'auth_user_not_found', 'невідома пошта — привʼязувати нема до чого');

SELECT pg_temp.rejects(
  $f$ SELECT delivery.link_courier('kurier.petro@example.test', 'Пе') $f$,
  'full_name_required', 'імʼя коротше трьох символів не приймається');

\echo ''
\echo '═══ Успішна привʼязка ═══'

DO $$
DECLARE c delivery.couriers;
BEGIN
  -- Пошта з великими літерами й пробілами: у дашборді її набирає людина,
  -- і «Kurier.Petro@Example.test » має знайти той самий запис
  c := delivery.link_courier('  Kurier.Petro@Example.TEST  ', 'Петро Коваль', ' +380671112233 ');
  PERFORM set_config('t.c', c.id::text, false);

  PERFORM pg_temp.ok(c.auth_user_id = current_setting('t.u')::uuid,
    'курʼєр привʼязаний саме до того облікового запису');
  PERFORM pg_temp.ok(c.full_name = 'Петро Коваль', 'імʼя збережене без зайвих пробілів');
  PERFORM pg_temp.ok(c.phone = '+380671112233', 'телефон обрізаний по краях');
  PERFORM pg_temp.ok(c.is_active, 'курʼєр одразу активний');
  PERFORM pg_temp.ok(NOT c.must_change_password,
    'зміна пароля не вимагається — його задав адмін у дашборді');
  PERFORM pg_temp.ok(c.status = 'offline',
    'новий курʼєр не на лінії, поки сам не вийде (B36)');
END $$;

\echo ''
\echo '═══ Повтор ═══'

SELECT pg_temp.rejects(
  $f$ SELECT delivery.link_courier('kurier.petro@example.test', 'Петро Коваль') $f$,
  'courier_already_linked', 'той самий обліковий запис не привʼязується двічі');

\echo ''
\echo '═══ Курʼєр справді впізнається системою ═══'

-- Головне: привʼязка має не просто створити рядок, а зробити людину
-- курʼєром з точки зору решти правил
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('t.u'), false);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('t.u'))::text, false);
END $$;

SELECT pg_temp.ok(
  delivery.current_courier_id() = current_setting('t.c')::uuid,
  'після привʼязки auth.uid() розпізнається як цей курʼєр');

ROLLBACK;
