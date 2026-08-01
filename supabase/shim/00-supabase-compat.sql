-- ═══════════════════════════════════════════════════════════════════════════
-- ШИМ SUPABASE ДЛЯ ЛОКАЛЬНОГО POSTGRES
--
-- ⚠️ ЦЕЙ ФАЙЛ НЕ Є МІГРАЦІЄЮ І НІКОЛИ НЕ ЗАПУСКАЄТЬСЯ ПРОТИ SUPABASE.
-- Там усе описане нижче вже існує; спроба створити це вдруге зламає проєкт.
--
-- Навіщо. Docker у середовищі розробки недоступний, тож `supabase start`
-- не працює. Але без реальної бази політики доступу (RLS) неможливо
-- ПЕРЕВІРИТИ — можна лише написати й сподіватись. А saме там ціна помилки
-- найвища: витік телефону клієнта або читання коду підтвердження.
--
-- Шим створює те, на що спираються політики: три ролі Supabase, схему
-- `auth` і функцію `auth.uid()`. Після цього можна підключитись «як курʼєр
-- Олег» і ДОВЕСТИ, що він не бачить контакт чужого замовлення.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Ролі ───────────────────────────────────────────────────────────────────
-- anon          — незалогінений відвідувач
-- authenticated — будь-який залогінений користувач (курʼєр, адмін, клієнт)
-- service_role  — обходить RLS; тільки Edge Functions і серверні скрипти
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

-- ── auth.users ─────────────────────────────────────────────────────────────
-- У Supabase це керована таблиця з паролями (хешованими) і метаданими.
-- Нам потрібні лише id і роль — решту не відтворюємо, щоб не вдавати,
-- ніби ми знаємо їхню схему.
CREATE TABLE IF NOT EXISTS auth.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── auth.uid() ─────────────────────────────────────────────────────────────
-- У Supabase бере `sub` із перевіреного JWT. Локально читаємо ту саму
-- налаштовувану змінну сесії, що й PostgREST — тож політики пишуться
-- один раз і працюють в обох місцях без жодного `IF local THEN`.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO authenticated, service_role;
