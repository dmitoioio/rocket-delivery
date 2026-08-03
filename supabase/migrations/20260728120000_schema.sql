-- ═══════════════════════════════════════════════════════════════════════════
-- 0001 — СХЕМА ROCKET DELIVERY
--
-- Джерело: docs/04-data-model.md. Якщо документ і цей файл розійшлись —
-- це баг, і виправляти треба обидва в одному коміті.
--
-- ⚠️ ОКРЕМА СХЕМА `delivery`, НЕ `public` — ADR-0011.
-- Коротко: база спільна з cstllife (ADR-0001), їхньої схеми ми не бачили,
-- і `public.orders` цілком може бути зайнятий. Окрема схема фізично не
-- може зачепити їхні таблиці. Розділити пізніше дорожче, ніж закласти зараз.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS delivery;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ── Перелічувані типи ──────────────────────────────────────────────────────
-- Саме типи, а не text+CHECK: неможливий статус має відхилятись базою,
-- а не «перевірятись у застосунку».
DO $$ BEGIN
  CREATE TYPE delivery.order_status AS ENUM (
    'placed', 'accepted_by_business', 'preparing', 'ready',
    'courier_assigned', 'picked_up', 'on_the_way', 'delivered',
    'cancelled_by_client', 'rejected_by_business',
    'failed_delivery', 'returned_to_queue'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE delivery.payment_method AS ENUM ('online', 'cash');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE delivery.payment_status AS ENUM (
    'pending', 'paid', 'refund_needed', 'refund_processing', 'refunded', 'refund_failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE delivery.courier_status AS ENUM ('offline', 'online', 'busy');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE delivery.handoff_status AS ENUM ('declared', 'confirmed', 'disputed', 'resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE delivery.business_type AS ENUM ('sushi', 'pizza', 'grocery', 'flowers', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── businesses ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery.businesses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Міст до картки бізнесу на боці cstllife. Їхній ідентифікатор, яким би
  -- він не був — ми не робимо припущень про його форму (docs/14).
  external_ref  text UNIQUE,
  name          text NOT NULL,
  type          delivery.business_type NOT NULL DEFAULT 'other',
  address_text  text NOT NULL,
  lat           numeric(9,6) NOT NULL,
  lng           numeric(9,6) NOT NULL,
  phone         text,
  is_active     boolean NOT NULL DEFAULT true,
  -- Графік по днях тижня: {"1":{"from":10,"to":22}, ...}, 0 = неділя.
  -- Без нього замовлення падає о 23:00 у заклад, що працює до 22:00 (B34)
  working_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery_radius_km          numeric(6,2) NOT NULL DEFAULT 15,   -- hard limit (B10)
  cash_reconciliation_period  text NOT NULL DEFAULT 'daily'
    CHECK (cash_reconciliation_period IN ('daily', 'weekly', 'monthly')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── couriers ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery.couriers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Пароль зберігає Supabase Auth. У НАШИХ таблицях паролів немає ніде (B17)
  auth_user_id  uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name     text NOT NULL,
  phone         text,
  vehicle       text NOT NULL DEFAULT 'escooter',
  status        delivery.courier_status NOT NULL DEFAULT 'offline',
  max_active_orders    int NOT NULL DEFAULT 1 CHECK (max_active_orders >= 1),
  cash_on_hand         numeric(10,2) NOT NULL DEFAULT 0,
  cash_limit           numeric(10,2) NOT NULL DEFAULT 3000,
  completed_deliveries int NOT NULL DEFAULT 0,
  -- Зафіксована розбіжність при здачі готівки. Утримується з відомості
  debt                 numeric(10,2) NOT NULL DEFAULT 0,
  payout_details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  must_change_password boolean NOT NULL DEFAULT true,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ── trips (заготовка під батчинг, ADR-0006) ────────────────────────────────
-- Створюється одразу, хоч UI зʼявиться пізніше: додати колонку в живу
-- таблицю на порядок дешевше, ніж мігрувати наявні замовлення
CREATE TABLE IF NOT EXISTS delivery.trips (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id  uuid NOT NULL REFERENCES delivery.couriers(id),
  status      text NOT NULL DEFAULT 'active',
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- ── orders ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery.orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text UNIQUE NOT NULL,           -- «RD-0412», курʼєр читає вголос
  business_id   uuid NOT NULL REFERENCES delivery.businesses(id),
  courier_id    uuid REFERENCES delivery.couriers(id),
  trip_id       uuid REFERENCES delivery.trips(id),
  status        delivery.order_status NOT NULL DEFAULT 'placed',

  items         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- пише тільки cstllife
  items_total   numeric(10,2) NOT NULL CHECK (items_total >= 0),
  -- Сума на МОМЕНТ замовлення. Не читається з конфіга заднім числом:
  -- інакше зміна тарифу переписала б історію грошей
  delivery_fee  numeric(10,2) NOT NULL CHECK (delivery_fee >= 0),
  total         numeric(10,2) NOT NULL,

  payment_method delivery.payment_method NOT NULL,
  payment_status delivery.payment_status NOT NULL DEFAULT 'pending',

  client_name   text,
  client_phone  text,                     -- 🔒 тільки призначеному курʼєру (B15)
  dest_address_text text NOT NULL,
  dest_locality text,
  -- Обовʼязкові: без координат курʼєр не знайде адресу, а радіус нема від чого рахувати
  dest_lat      numeric(9,6) NOT NULL,
  dest_lng      numeric(9,6) NOT NULL,
  dest_landmark text,                     -- «зелені ворота» — у селі важливіше за номер

  delivery_pin  text,                     -- 🔒 НІКОЛИ не віддається курʼєру (B41)
  pin_bypassed  boolean NOT NULL DEFAULT false,
  proof_photo_path text,

  return_count  int NOT NULL DEFAULT 0 CHECK (return_count >= 0),
  returned_by   uuid REFERENCES delivery.couriers(id),
  returned_at   timestamptz,
  waiting_bonus numeric(10,2) NOT NULL DEFAULT 0,
  distance_km   numeric(6,2),
  idempotency_key text UNIQUE,            -- захист від подвійного тапу (B24)
  cash_handoff_id uuid,

  placed_at            timestamptz NOT NULL DEFAULT now(),
  estimated_ready_at   timestamptz,       -- ПРОГНОЗ, ставить заклад
  ready_at             timestamptz,       -- ФАКТ, кнопка «готово». Не таймер (B8)
  assigned_at          timestamptz,
  picked_up_at         timestamptz,
  on_the_way_at        timestamptz,
  delivered_at         timestamptz,
  cancelled_at         timestamptz,

  -- Інваріант 6: сума сходиться на рівні бази, а не «має сходитись»
  CONSTRAINT total_is_sum CHECK (total = items_total + delivery_fee),
  -- Інваріанти 1 і 2: «доставлено» без фото або без курʼєра неможливе
  CONSTRAINT delivered_needs_proof
    CHECK (status <> 'delivered' OR proof_photo_path IS NOT NULL),
  CONSTRAINT delivered_needs_courier
    CHECK (status <> 'delivered' OR courier_id IS NOT NULL)
);

COMMENT ON COLUMN delivery.orders.delivery_pin IS
  'Код підтвердження. Читає ТІЛЬКИ сервер при завершенні доставки. Курʼєрський клієнт не отримує його в жодній відповіді — інакше верифікація отримувача перетворюється на театр (B41).';

-- Черга курʼєрів — найгарячіший запит застосунку
CREATE INDEX IF NOT EXISTS orders_queue_idx
  ON delivery.orders (status, ready_at) WHERE courier_id IS NULL;
CREATE INDEX IF NOT EXISTS orders_courier_active_idx
  ON delivery.orders (courier_id, status)
  WHERE status IN ('courier_assigned', 'picked_up', 'on_the_way');
CREATE INDEX IF NOT EXISTS orders_business_idx
  ON delivery.orders (business_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS orders_trip_idx
  ON delivery.orders (trip_id) WHERE trip_id IS NOT NULL;

-- ── order_status_events (append-only) ──────────────────────────────────────
-- Без журналу спір «я тиснув доставлено» недоказовий (B30)
CREATE TABLE IF NOT EXISTS delivery.order_status_events (
  id          bigserial PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES delivery.orders(id) ON DELETE RESTRICT,
  from_status delivery.order_status,
  to_status   delivery.order_status NOT NULL,
  actor_id    uuid,
  actor_role  text NOT NULL,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_order_idx ON delivery.order_status_events (order_id, created_at);

-- ── courier_locations ──────────────────────────────────────────────────────
-- ТІЛЬКИ остання позиція: PRIMARY KEY на courier_id робить накопичення
-- історії неможливим за побудовою, а не «за домовленістю» (B16)
CREATE TABLE IF NOT EXISTS delivery.courier_locations (
  courier_id  uuid PRIMARY KEY REFERENCES delivery.couriers(id) ON DELETE CASCADE,
  order_id    uuid REFERENCES delivery.orders(id) ON DELETE SET NULL,
  lat         numeric(9,6) NOT NULL,
  lng         numeric(9,6) NOT NULL,
  accuracy_m  numeric(8,2),
  battery_level numeric(5,2),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── cash_handoffs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery.cash_handoffs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id      uuid NOT NULL REFERENCES delivery.couriers(id),
  business_id     uuid NOT NULL REFERENCES delivery.businesses(id),
  declared_amount numeric(10,2) NOT NULL CHECK (declared_amount > 0),
  confirmed_amount numeric(10,2),
  expected_amount numeric(10,2),
  status          delivery.handoff_status NOT NULL DEFAULT 'declared',
  -- Розбіжність рахує база. Це зафіксований борг, а не усна суперечка
  discrepancy     numeric(10,2) GENERATED ALWAYS AS
                    (COALESCE(confirmed_amount, 0) - declared_amount) STORED,
  order_ids       uuid[] NOT NULL DEFAULT '{}',
  declared_at     timestamptz NOT NULL DEFAULT now(),
  confirmed_at    timestamptz,
  auto_confirm_deadline timestamptz,      -- Q5 лишається відкритим
  resolved_by     uuid,
  resolution_note text
);

-- Зв'язок ставиться окремо: orders створюються ВИЩЕ за cash_handoffs, тож
-- на момент CREATE TABLE посилатись ще нема на що.
--
-- ⚠️ `ADD CONSTRAINT IF NOT EXISTS` у Postgres не існує — тільки DO-блок.
-- Це був єдиний рядок у всіх п'яти міграціях, що не переживав повторного
-- накату: перший прогін проходив, другий падав із `constraint
-- "orders_cash_handoff_fk" for relation "orders" already exists`. Знайдено
-- не читанням (читання його якраз пропустило), а другим прогоном підряд.
DO $$ BEGIN
  ALTER TABLE delivery.orders
    ADD CONSTRAINT orders_cash_handoff_fk
    FOREIGN KEY (cash_handoff_id) REFERENCES delivery.cash_handoffs(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── payrolls ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery.payrolls (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id   uuid NOT NULL REFERENCES delivery.couriers(id),
  period_start date NOT NULL,
  period_end   date NOT NULL,
  deliveries_count int NOT NULL DEFAULT 0,
  gross_amount numeric(10,2) NOT NULL DEFAULT 0,
  deductions   numeric(10,2) NOT NULL DEFAULT 0,
  net_amount   numeric(10,2) NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  paid_at      timestamptz
);

-- ── earnings_log ───────────────────────────────────────────────────────────
-- Пише ТІЛЬКИ сервер (тригер на delivered). Інваріант 7
CREATE TABLE IF NOT EXISTS delivery.earnings_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid NOT NULL REFERENCES delivery.couriers(id),
  order_id   uuid REFERENCES delivery.orders(id),
  amount     numeric(10,2) NOT NULL,
  reason     text NOT NULL CHECK (reason IN
               ('delivery','hourly','failed_delivery_compensation','bonus','adjustment')),
  payroll_id uuid REFERENCES delivery.payrolls(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS earnings_unpaid_idx
  ON delivery.earnings_log (courier_id) WHERE payroll_id IS NULL;

-- ── cancellations ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery.cancellations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES delivery.orders(id),
  reason_code text NOT NULL,
  reason_note text,
  cancelled_by_role text NOT NULL,
  cancelled_by_id   uuid,
  refund_needed boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── app_config ─────────────────────────────────────────────────────────────
-- Ставки живуть тут, а не в коді. Саме це робить відкладене рішення по
-- фінмоделі (Q1–Q3) дешевим: затвердження цифр = один INSERT, не реліз.
-- Версіонування по даті — історичні значення не перезаписуються.
CREATE TABLE IF NOT EXISTS delivery.app_config (
  key         text NOT NULL,
  value       jsonb NOT NULL,
  valid_from  timestamptz NOT NULL DEFAULT now(),
  note        text,
  PRIMARY KEY (key, valid_from)
);

CREATE OR REPLACE FUNCTION delivery.config(p_key text, p_at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT value FROM delivery.app_config
  WHERE key = p_key AND valid_from <= p_at
  ORDER BY valid_from DESC LIMIT 1
$$;

INSERT INTO delivery.app_config (key, value, note) VALUES
  ('delivery_fee',          '50',  'Скільки платить клієнт за доставку, ₴'),
  ('courier_per_delivery',  '35',  'Скільки отримує курʼєр з доставки, ₴'),
  ('platform_per_delivery', '15',  'Маржа платформи, ₴'),
  ('waiting_bonus_steps',   '[{"afterMin":10,"bonus":10},{"afterMin":20,"bonus":20}]',
                                   'Надбавка за висіння в черзі — протидія черрі-пікінгу (B35)'),
  ('cash_limit_default',    '3000','Ліміт готівки на руках, ₴'),
  ('cash_limit_newbie',     '1000','Знижений ліміт для новачків (B38)'),
  ('newbie_deliveries',     '10',  'Скільки доставок до зняття зниженого ліміту')
ON CONFLICT DO NOTHING;
