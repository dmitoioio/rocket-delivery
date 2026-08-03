-- ═══════════════════════════════════════════════════════════════════════════
-- ROCKET DELIVERY — ПОВНЕ ВСТАНОВЛЕННЯ БАЗИ
--
-- Згенеровано з supabase/migrations/ командою `npm run db:bundle`.
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
-- Файлів у складі: 5
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- ▼ 20260728120000_schema.sql
-- ═══════════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════════
-- ▼ 20260728120100_functions.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0002 — БІЗНЕС-ПРАВИЛА НА СЕРВЕРІ
--
-- Джерело: src/lib/adapters/mock.js — він писався як ВИКОНУВАНА
-- СПЕЦИФІКАЦІЯ сервера. Усе, що там працює, тут має працювати так само;
-- test/contract.test.js проганяє ті самі 54 інваріанти по обох.
--
-- Головний принцип: перевірка на клієнті захистом НЕ Є. Курʼєр із
-- інструментами розробника може надіслати будь-що. Тому радіус, графік,
-- гонка, код підтвердження й нарахування грошей живуть тут.
--
-- Усі функції SECURITY DEFINER: вони самі вирішують, що можна, і тому
-- працюють поверх RLS, а не в обхід правил.
--
-- ⚠️ КОДИ ПОМИЛОК — власний клас RD, не P0.
-- Клас P0 зарезервований PL/pgSQL, і P0004 там означає assert_failure —
-- єдиний код, який `WHEN OTHERS` НЕ ловить за визначенням. З ним помилки
-- бізнес-правил були б необробимі: жоден обробник їх не побачив би.
-- Знайдено прогоном тестів, не читанням коду.
--
--   RD001 — немає прав / не той курʼєр      → kind: 'permission'
--   RD002 — не знайдено                      → kind: 'notFound'
--   RD003 — конфлікт стану (гонка, статус)   → kind: 'conflict'
--   RD004 — правило порушено (радіус, ліміт) → kind: 'validation'
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Геометрія ──────────────────────────────────────────────────────────────
-- Формула гаверсинуса. Без PostGIS: одна функція дешевша за розширення,
-- якого більше ніде не треба.
CREATE OR REPLACE FUNCTION delivery.distance_km(
  lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric
) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT round((6371 * 2 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      power(sin(radians(lng2 - lng1) / 2), 2)
  )))::numeric, 2)
$$;

-- ── Чи відчинено ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delivery.is_open(p_business uuid, p_at timestamptz DEFAULT now())
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE h jsonb; d text; f int; t int;
BEGIN
  SELECT working_hours INTO h FROM delivery.businesses WHERE id = p_business;
  IF h IS NULL OR h = '{}'::jsonb THEN RETURN true; END IF;   -- графік не заданий = цілодобово
  d := extract(dow FROM p_at)::int::text;
  IF NOT (h ? d) THEN RETURN true; END IF;
  f := (h -> d ->> 'from')::int;
  t := (h -> d ->> 'to')::int;
  RETURN extract(hour FROM p_at)::int >= f AND extract(hour FROM p_at)::int < t;
END $$;

-- ── Код замовлення ─────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS delivery.order_code_seq START 400;

CREATE OR REPLACE FUNCTION delivery.next_order_code() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT 'RD-' || lpad(nextval('delivery.order_code_seq')::text, 4, '0')
$$;

-- ── Журнал ─────────────────────────────────────────────────────────────────
-- Тригер, а не виклик із коду: пропустити запис стає неможливо
CREATE OR REPLACE FUNCTION delivery.log_status_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO delivery.order_status_events (order_id, from_status, to_status, actor_id, actor_role, meta)
    VALUES (
      NEW.id,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
      NEW.status,
      COALESCE(NULLIF(current_setting('delivery.actor_id', true), '')::uuid, auth.uid()),
      COALESCE(NULLIF(current_setting('delivery.actor_role', true), ''), 'system'),
      jsonb_build_object('courier_id', NEW.courier_id)
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_log_status ON delivery.orders;
CREATE TRIGGER orders_log_status
  AFTER INSERT OR UPDATE OF status ON delivery.orders
  FOR EACH ROW EXECUTE FUNCTION delivery.log_status_change();

-- ── Заробіток нараховує ТІЛЬКИ тригер ──────────────────────────────────────
-- Інваріант 7 із docs/04. Ставка фіксується на момент доставки, а не
-- читається з конфіга при перегляді — інакше зміна тарифу переписала б
-- історію грошей заднім числом.
CREATE OR REPLACE FUNCTION delivery.accrue_on_delivered() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE rate numeric;
BEGIN
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    rate := (delivery.config('courier_per_delivery'))::numeric;
    INSERT INTO delivery.earnings_log (courier_id, order_id, amount, reason)
    VALUES (NEW.courier_id, NEW.id, rate + COALESCE(NEW.waiting_bonus, 0), 'delivery');

    UPDATE delivery.couriers
       SET completed_deliveries = completed_deliveries + 1,
           cash_on_hand = cash_on_hand +
             CASE WHEN NEW.payment_method = 'cash' THEN NEW.total ELSE 0 END
     WHERE id = NEW.courier_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_accrue ON delivery.orders;
CREATE TRIGGER orders_accrue
  AFTER UPDATE OF status ON delivery.orders
  FOR EACH ROW EXECUTE FUNCTION delivery.accrue_on_delivered();

-- ═══ СТВОРЕННЯ ЗАМОВЛЕННЯ ═══════════════════════════════════════════════════
-- Викликає cstllife зі своєї картки бізнесу (docs/14). Радіус і графік
-- перевіряються ТУТ: їхній чекаут не може їх обійти, навіть помилково.
CREATE OR REPLACE FUNCTION delivery.place_order(
  p_business_ref  text,
  p_items         jsonb,
  p_items_total   numeric,
  p_payment_method delivery.payment_method,
  p_client_name   text,
  p_client_phone  text,
  p_dest_address  text,
  p_dest_lat      numeric,
  p_dest_lng      numeric,
  p_dest_landmark text DEFAULT NULL,
  p_dest_locality text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS delivery.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery, public AS $$
DECLARE b delivery.businesses; d numeric; fee numeric; o delivery.orders;
BEGIN
  SELECT * INTO b FROM delivery.businesses
   WHERE external_ref = p_business_ref OR id::text = p_business_ref;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'business_not_found: %', p_business_ref USING ERRCODE = 'RD002';
  END IF;
  IF NOT b.is_active THEN
    RAISE EXCEPTION 'business_inactive' USING ERRCODE = 'RD004';
  END IF;

  -- Повтор того самого запиту не створює друге замовлення (B24)
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO o FROM delivery.orders WHERE idempotency_key = p_idempotency_key;
    IF o.id IS NOT NULL THEN RETURN o; END IF;
  END IF;

  IF NOT delivery.is_open(b.id) THEN
    RAISE EXCEPTION 'business_closed' USING ERRCODE = 'RD004';   -- B34
  END IF;

  d := delivery.distance_km(b.lat, b.lng, p_dest_lat, p_dest_lng);
  IF d > b.delivery_radius_km THEN
    RAISE EXCEPTION 'out_of_radius: % км при ліміті % км', d, b.delivery_radius_km
      USING ERRCODE = 'RD004';                                    -- B10
  END IF;

  fee := (delivery.config('delivery_fee'))::numeric;

  INSERT INTO delivery.orders (
    code, business_id, status, items, items_total, delivery_fee, total,
    payment_method, payment_status, client_name, client_phone,
    dest_address_text, dest_locality, dest_lat, dest_lng, dest_landmark,
    delivery_pin, distance_km, idempotency_key
  ) VALUES (
    delivery.next_order_code(), b.id, 'placed', p_items, p_items_total, fee,
    p_items_total + fee, p_payment_method,
    CASE WHEN p_payment_method = 'online' THEN 'paid'::delivery.payment_status
         ELSE 'pending'::delivery.payment_status END,
    p_client_name, p_client_phone,
    p_dest_address, p_dest_locality, p_dest_lat, p_dest_lng, p_dest_landmark,
    lpad((floor(random() * 10000))::int::text, 4, '0'),   -- код підтвердження
    d, p_idempotency_key
  ) RETURNING * INTO o;

  RETURN o;
END $$;

-- ═══ ОПЕРАЦІЇ ЗАКЛАДУ ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION delivery.business_accept_order(p_order uuid, p_minutes int)
RETURNS delivery.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery AS $$
DECLARE o delivery.orders;
BEGIN
  UPDATE delivery.orders
     SET status = 'preparing', estimated_ready_at = now() + (p_minutes || ' minutes')::interval
   WHERE id = p_order AND status = 'placed'
  RETURNING * INTO o;
  IF o.id IS NULL THEN RAISE EXCEPTION 'wrong_status' USING ERRCODE = 'RD003'; END IF;
  RETURN o;
END $$;

-- «Готово» — це ДІЯ ЛЮДИНИ, не таймер. Саме тут ready_at стає фактом,
-- а estimated_ready_at лишається прогнозом (B8)
CREATE OR REPLACE FUNCTION delivery.business_mark_ready(p_order uuid)
RETURNS delivery.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery AS $$
DECLARE o delivery.orders;
BEGIN
  UPDATE delivery.orders SET status = 'ready', ready_at = now()
   WHERE id = p_order AND status IN ('placed', 'accepted_by_business', 'preparing')
  RETURNING * INTO o;
  IF o.id IS NULL THEN RAISE EXCEPTION 'wrong_status' USING ERRCODE = 'RD003'; END IF;
  RETURN o;
END $$;

CREATE OR REPLACE FUNCTION delivery.business_reject_order(p_order uuid, p_reason text)
RETURNS delivery.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery AS $$
DECLARE o delivery.orders;
BEGIN
  UPDATE delivery.orders
     SET status = 'rejected_by_business', cancelled_at = now(),
         -- Інваріант 5: скасування оплаченого онлайн ⟹ потрібен рефанд
         payment_status = CASE WHEN payment_status = 'paid'
                               THEN 'refund_needed'::delivery.payment_status
                               ELSE payment_status END
   WHERE id = p_order AND status NOT IN ('delivered', 'failed_delivery')
  RETURNING * INTO o;
  IF o.id IS NULL THEN RAISE EXCEPTION 'wrong_status' USING ERRCODE = 'RD003'; END IF;

  INSERT INTO delivery.cancellations (order_id, reason_code, cancelled_by_role, refund_needed)
  VALUES (p_order, p_reason, 'business', o.payment_status = 'refund_needed');
  RETURN o;
END $$;

-- ═══ ГОНКА ЗА ЗАМОВЛЕННЯ ════════════════════════════════════════════════════
-- За відкритої черги (ADR-0009) це ОСНОВНА механіка, не крайній випадок.
-- Атомарність дає сам UPDATE ... WHERE: порожній результат = програш.
CREATE OR REPLACE FUNCTION delivery.accept_order(p_order uuid, p_courier uuid)
RETURNS delivery.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery AS $$
DECLARE c delivery.couriers; o delivery.orders; active int; cash_limit numeric;
BEGIN
  SELECT * INTO c FROM delivery.couriers WHERE id = p_courier;
  IF c.id IS NULL OR NOT c.is_active THEN
    RAISE EXCEPTION 'courier_inactive' USING ERRCODE = 'RD001';
  END IF;

  -- Офлайн-курʼєр не бере замовлень. Раніше це був лише напис у профілі
  IF c.status <> 'online' THEN
    RAISE EXCEPTION 'not_online' USING ERRCODE = 'RD004';
  END IF;

  SELECT count(*) INTO active FROM delivery.orders
   WHERE courier_id = p_courier AND status IN ('courier_assigned','picked_up','on_the_way');
  IF active >= c.max_active_orders THEN
    RAISE EXCEPTION 'too_many_active' USING ERRCODE = 'RD004';
  END IF;

  SELECT * INTO o FROM delivery.orders WHERE id = p_order;
  IF o.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'RD002'; END IF;

  -- Ліміт готівки на руках (B2, B38): новачкам знижений
  IF o.payment_method = 'cash' THEN
    cash_limit := CASE
      WHEN c.completed_deliveries < (delivery.config('newbie_deliveries'))::int
      THEN (delivery.config('cash_limit_newbie'))::numeric
      ELSE c.cash_limit END;
    IF c.cash_on_hand + o.total > cash_limit THEN
      RAISE EXCEPTION 'cash_limit_reached' USING ERRCODE = 'RD004';
    END IF;
  END IF;

  -- Щойно повернене цим самим курʼєром — 3 хвилини недоступне (B6)
  IF o.returned_by = p_courier AND o.returned_at > now() - interval '3 minutes' THEN
    RAISE EXCEPTION 'recently_returned' USING ERRCODE = 'RD003';
  END IF;

  UPDATE delivery.orders
     SET courier_id = p_courier, status = 'courier_assigned', assigned_at = now()
   WHERE id = p_order AND status = 'ready' AND courier_id IS NULL
  RETURNING * INTO o;

  IF o.id IS NULL THEN
    RAISE EXCEPTION 'already_taken' USING ERRCODE = 'RD003';   -- гонку програно
  END IF;
  RETURN o;
END $$;

CREATE OR REPLACE FUNCTION delivery.advance_status(
  p_order uuid, p_courier uuid, p_to delivery.order_status
) RETURNS delivery.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery AS $$
DECLARE o delivery.orders;
BEGIN
  UPDATE delivery.orders
     SET status = p_to,
         picked_up_at  = CASE WHEN p_to = 'picked_up'  THEN now() ELSE picked_up_at END,
         on_the_way_at = CASE WHEN p_to = 'on_the_way' THEN now() ELSE on_the_way_at END
   WHERE id = p_order AND courier_id = p_courier
     AND status IN ('courier_assigned','picked_up','on_the_way')
     AND p_to IN ('picked_up','on_the_way')
  RETURNING * INTO o;
  IF o.id IS NULL THEN RAISE EXCEPTION 'wrong_status' USING ERRCODE = 'RD003'; END IF;
  RETURN o;
END $$;

-- ═══ ЗАВЕРШЕННЯ ДОСТАВКИ ════════════════════════════════════════════════════
-- Звірка коду відбувається ТУТ і ніде більше. Курʼєрський клієнт коду не
-- отримує в жодній відповіді (B41) — саме тому перевірка чогось варта.
CREATE OR REPLACE FUNCTION delivery.complete_delivery(
  p_order uuid, p_courier uuid, p_photo_path text,
  p_pin text DEFAULT NULL, p_pin_bypassed boolean DEFAULT false
) RETURNS delivery.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery AS $$
DECLARE o delivery.orders;
BEGIN
  SELECT * INTO o FROM delivery.orders WHERE id = p_order AND courier_id = p_courier;
  IF o.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'RD001'; END IF;
  IF o.status <> 'on_the_way' THEN RAISE EXCEPTION 'wrong_status' USING ERRCODE = 'RD003'; END IF;
  IF p_photo_path IS NULL OR p_photo_path = '' THEN
    RAISE EXCEPTION 'photo_required' USING ERRCODE = 'RD004';
  END IF;
  IF NOT p_pin_bypassed AND o.delivery_pin IS NOT NULL
     AND p_pin IS DISTINCT FROM o.delivery_pin THEN
    RAISE EXCEPTION 'wrong_pin' USING ERRCODE = 'RD004';
  END IF;

  UPDATE delivery.orders
     SET status = 'delivered', delivered_at = now(),
         proof_photo_path = p_photo_path, pin_bypassed = p_pin_bypassed
   WHERE id = p_order
  RETURNING * INTO o;
  RETURN o;   -- заробіток нарахує тригер, не цей код
END $$;

CREATE OR REPLACE FUNCTION delivery.cancel_order(
  p_order uuid, p_courier uuid, p_reason text, p_note text DEFAULT NULL
) RETURNS delivery.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery AS $$
DECLARE o delivery.orders; to_status delivery.order_status;
BEGIN
  SELECT * INTO o FROM delivery.orders WHERE id = p_order AND courier_id = p_courier;
  IF o.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'RD001'; END IF;

  IF p_reason = 'return_to_queue' THEN
    UPDATE delivery.orders
       SET status = 'ready', courier_id = NULL, assigned_at = NULL,
           return_count = return_count + 1, returned_by = p_courier, returned_at = now()
     WHERE id = p_order RETURNING * INTO o;
  ELSE
    to_status := 'failed_delivery';
    UPDATE delivery.orders
       SET status = to_status, cancelled_at = now(),
           payment_status = CASE WHEN payment_status = 'paid'
                                 THEN 'refund_needed'::delivery.payment_status
                                 ELSE payment_status END
     WHERE id = p_order RETURNING * INTO o;

    -- Курʼєр відпрацював поїздку — компенсація нараховується (рекомендація Q4)
    INSERT INTO delivery.earnings_log (courier_id, order_id, amount, reason)
    VALUES (p_courier, p_order,
            (delivery.config('courier_per_delivery'))::numeric / 2,
            'failed_delivery_compensation');
  END IF;

  INSERT INTO delivery.cancellations (order_id, reason_code, reason_note, cancelled_by_role,
                                      cancelled_by_id, refund_needed)
  VALUES (p_order, p_reason, p_note, 'courier', p_courier, o.payment_status = 'refund_needed');
  RETURN o;
END $$;

-- ═══ ГОТІВКА ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION delivery.declare_cash_handoff(p_courier uuid, p_amount numeric)
RETURNS delivery.cash_handoffs LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery AS $$
DECLARE h delivery.cash_handoffs; ids uuid[]; expected numeric; biz uuid;
BEGIN
  -- Здача привʼязується до КОНКРЕТНИХ замовлень, а не до абстрактної суми:
  -- інакше список «з чого складається» вигаданий і повторюється щоразу
  -- (array_agg(...))[1], а не min(): для uuid агрегату min не існує
  SELECT array_agg(id), COALESCE(sum(total), 0), (array_agg(business_id))[1]
    INTO ids, expected, biz
    FROM delivery.orders
   WHERE courier_id = p_courier AND status = 'delivered'
     AND payment_method = 'cash' AND cash_handoff_id IS NULL;

  IF ids IS NULL THEN RAISE EXCEPTION 'nothing_to_hand_off' USING ERRCODE = 'RD004'; END IF;

  INSERT INTO delivery.cash_handoffs (courier_id, business_id, declared_amount,
                                      expected_amount, order_ids)
  VALUES (p_courier, biz, p_amount, expected, ids)
  RETURNING * INTO h;

  UPDATE delivery.orders SET cash_handoff_id = h.id WHERE id = ANY(ids);
  RETURN h;
END $$;

CREATE OR REPLACE FUNCTION delivery.confirm_handoff(p_handoff uuid, p_amount numeric)
RETURNS delivery.cash_handoffs LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery AS $$
DECLARE h delivery.cash_handoffs;
BEGIN
  UPDATE delivery.cash_handoffs
     SET confirmed_amount = p_amount, confirmed_at = now(),
         status = CASE WHEN p_amount = declared_amount THEN 'confirmed'::delivery.handoff_status
                                                       ELSE 'disputed'::delivery.handoff_status END
   WHERE id = p_handoff AND status = 'declared'
  RETURNING * INTO h;
  IF h.id IS NULL THEN RAISE EXCEPTION 'wrong_status' USING ERRCODE = 'RD003'; END IF;

  -- Готівка списується з рук курʼєра; розбіжність стає зафіксованим боргом
  UPDATE delivery.couriers
     SET cash_on_hand = greatest(0, cash_on_hand - h.declared_amount),
         debt = debt + greatest(0, -h.discrepancy)
   WHERE id = h.courier_id;
  RETURN h;
END $$;

-- ═══ ЗАРПЛАТА ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION delivery.create_payroll(p_courier uuid)
RETURNS delivery.payrolls LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery AS $$
DECLARE p delivery.payrolls; gross numeric; cnt int; debt numeric;
BEGIN
  SELECT COALESCE(sum(amount), 0), count(*) FILTER (WHERE reason = 'delivery')
    INTO gross, cnt
    FROM delivery.earnings_log WHERE courier_id = p_courier AND payroll_id IS NULL;
  IF gross = 0 THEN RAISE EXCEPTION 'nothing_to_pay' USING ERRCODE = 'RD004'; END IF;

  SELECT couriers.debt INTO debt FROM delivery.couriers WHERE id = p_courier;

  INSERT INTO delivery.payrolls (courier_id, period_start, period_end, deliveries_count,
                                 gross_amount, deductions, net_amount, status)
  VALUES (p_courier, current_date - 7, current_date, cnt, gross,
          least(debt, gross), gross - least(debt, gross), 'approved')
  RETURNING * INTO p;

  UPDATE delivery.earnings_log SET payroll_id = p.id
   WHERE courier_id = p_courier AND payroll_id IS NULL;
  RETURN p;
END $$;

CREATE OR REPLACE FUNCTION delivery.pay_payroll(p_payroll uuid)
RETURNS delivery.payrolls LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery AS $$
DECLARE p delivery.payrolls;
BEGIN
  UPDATE delivery.payrolls SET status = 'paid', paid_at = now()
   WHERE id = p_payroll AND status <> 'paid' RETURNING * INTO p;
  IF p.id IS NULL THEN RAISE EXCEPTION 'wrong_status' USING ERRCODE = 'RD003'; END IF;

  UPDATE delivery.couriers SET debt = greatest(0, debt - p.deductions)
   WHERE id = p.courier_id;
  RETURN p;
END $$;

-- ═══ ЛОКАЦІЯ ════════════════════════════════════════════════════════════════
-- UPSERT, не INSERT: історія переміщень людини не накопичується (B16)
CREATE OR REPLACE FUNCTION delivery.update_courier_location(
  p_courier uuid, p_lat numeric, p_lng numeric, p_accuracy numeric DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM delivery.couriers WHERE id = p_courier AND status = 'online') THEN
    RETURN;   -- поза зміною позиція не зберігається взагалі
  END IF;
  INSERT INTO delivery.courier_locations (courier_id, lat, lng, accuracy_m, updated_at)
  VALUES (p_courier, p_lat, p_lng, p_accuracy, now())
  ON CONFLICT (courier_id) DO UPDATE
    SET lat = excluded.lat, lng = excluded.lng,
        accuracy_m = excluded.accuracy_m, updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION delivery.set_courier_status(p_courier uuid, p_status delivery.courier_status)
RETURNS delivery.couriers LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery AS $$
DECLARE c delivery.couriers;
BEGIN
  UPDATE delivery.couriers SET status = p_status WHERE id = p_courier RETURNING * INTO c;
  IF p_status = 'offline' THEN
    DELETE FROM delivery.courier_locations WHERE courier_id = p_courier;
  END IF;
  RETURN c;
END $$;

-- ═══ НАДБАВКА ЗА ОЧІКУВАННЯ І WATCHDOG ══════════════════════════════════════
-- Викликається за розкладом (pg_cron) або при читанні черги.
-- У моці це робив tickServer; тут — те саме, але на сервері.
CREATE OR REPLACE FUNCTION delivery.tick() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery AS $$
DECLARE steps jsonb;
BEGIN
  steps := delivery.config('waiting_bonus_steps');

  UPDATE delivery.orders o
     SET waiting_bonus = COALESCE((
       SELECT max((s ->> 'bonus')::numeric) FROM jsonb_array_elements(steps) s
        WHERE extract(epoch FROM (now() - o.ready_at)) / 60 >= (s ->> 'afterMin')::numeric
     ), 0)
   WHERE o.status = 'ready' AND o.courier_id IS NULL AND o.ready_at IS NOT NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ▼ 20260728120200_rls.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0003 — ПРИВАТНІСТЬ І ДОСТУП
--
-- Джерело: docs/05-roles-auth-rls.md.
--
-- ⚠️ Головне, чого RLS НЕ робить: вона фільтрує РЯДКИ, а не КОЛОНКИ.
-- Якщо курʼєр має право прочитати рядок замовлення в черзі — він читає
-- і телефон клієнта, і точну адресу, ще до того як узяв замовлення.
-- І читатиме їх через рік після доставки. Це баг B15, і він структурний:
-- політикою «дозволити читати чергу» його не закрити.
--
-- Тому черга — це VIEW із обмеженим набором колонок, а контакт клієнта
-- видається окремою функцією під умову й із записом у журнал.
-- ═══════════════════════════════════════════════════════════════════════════

-- Хто зараз питає. У Supabase auth.uid() — це `sub` із перевіреного JWT;
-- звʼязка з нашою таблицею курʼєрів іде через couriers.auth_user_id
CREATE OR REPLACE FUNCTION delivery.current_courier_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = delivery AS $$
  SELECT id FROM delivery.couriers WHERE auth_user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION delivery.is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
$$;

-- ── Черга: VIEW без приватних даних ────────────────────────────────────────
-- Курʼєр бачить достатньо, щоб вирішити «беру / не беру»: заклад, скільки
-- заробить, відстань, населений пункт. Точна адреса, орієнтир і телефон
-- зʼявляються ТІЛЬКИ після взяття.
--
-- Способу оплати тут теж немає навмисно: інакше готівкові замовлення
-- дискримінуються системно й висять, поки клієнт не скасує (B35).
CREATE OR REPLACE VIEW delivery.courier_queue
WITH (security_invoker = true) AS
SELECT
  o.id,
  o.code,
  o.business_id,
  o.status,
  o.estimated_ready_at,
  o.ready_at,
  o.distance_km,
  o.dest_locality,
  o.waiting_bonus,
  -- Заробіток курʼєра, а НЕ сума чека: сума розкриває спосіб оплати
  -- непрямо (кругле число = готівка) і курʼєру не потрібна
  (delivery.config('courier_per_delivery'))::numeric + COALESCE(o.waiting_bonus, 0)
    AS courier_earnings,
  b.name AS business_name,
  b.lat  AS pickup_lat,
  b.lng  AS pickup_lng
FROM delivery.orders o
JOIN delivery.businesses b ON b.id = o.business_id
WHERE o.status IN ('ready', 'preparing') AND o.courier_id IS NULL;

-- ── Контакт клієнта — тільки через функцію ─────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery.contact_access_log (
  id         bigserial PRIMARY KEY,
  order_id   uuid NOT NULL,
  courier_id uuid,
  granted    boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION delivery.get_order_contact(p_order uuid, p_courier uuid DEFAULT NULL)
RETURNS TABLE (
  client_name text, client_phone text,
  dest_address_text text, dest_lat numeric, dest_lng numeric, dest_landmark text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery AS $$
DECLARE cid uuid; allowed boolean;
BEGIN
  cid := COALESCE(p_courier, delivery.current_courier_id());

  -- Право рахується ЯВНО, а не через FOUND після RETURN QUERY: там воно
  -- залежить від тонкощів виконання, і журнал доступу мовчки писав би
  -- «відмовлено» на кожну успішну видачу
  SELECT EXISTS (
    SELECT 1 FROM delivery.orders o
     WHERE o.id = p_order
       AND o.courier_id = cid                                    -- саме цей курʼєр
       AND o.status IN ('courier_assigned','picked_up','on_the_way')  -- саме зараз
  ) INTO allowed;

  -- Логуємо і видачу, і відмову: спроба дістати чужий контакт — це подія,
  -- про яку треба знати, а не тихий порожній результат
  INSERT INTO delivery.contact_access_log (order_id, courier_id, granted)
  VALUES (p_order, cid, allowed);

  IF NOT allowed THEN RETURN; END IF;

  RETURN QUERY
  SELECT o.client_name, o.client_phone, o.dest_address_text,
         o.dest_lat, o.dest_lng, o.dest_landmark
    FROM delivery.orders o WHERE o.id = p_order;
END $$;

-- ── Замовлення курʼєра: повний рядок, але БЕЗ коду підтвердження ───────────
-- Функція, а не VIEW із політикою: так неможливо випадково додати колонку
-- delivery_pin через `SELECT *` при майбутній правці (B41)
CREATE OR REPLACE VIEW delivery.my_orders
WITH (security_invoker = true) AS
SELECT
  o.id, o.code, o.business_id, o.courier_id, o.status,
  o.items, o.items_total, o.delivery_fee, o.total,
  o.payment_method, o.payment_status,
  o.dest_address_text, o.dest_locality, o.dest_lat, o.dest_lng, o.dest_landmark,
  o.client_name,
  o.proof_photo_path, o.pin_bypassed, o.return_count, o.waiting_bonus, o.distance_km,
  o.placed_at, o.estimated_ready_at, o.ready_at, o.assigned_at,
  o.picked_up_at, o.on_the_way_at, o.delivered_at, o.cancelled_at,
  b.name AS business_name, b.lat AS pickup_lat, b.lng AS pickup_lng
FROM delivery.orders o
JOIN delivery.businesses b ON b.id = o.business_id;
-- ⚠️ delivery_pin і client_phone у цьому переліку відсутні НАВМИСНО.
-- Телефон видає get_order_contact під умову; код не видається нікому.

-- ── Сторінка статусу для клієнта на боці cstllife ──────────────────────────
-- Тут код підтвердження Є — це єдине місце, де він показується, і
-- показується тому, хто його називатиме
CREATE OR REPLACE FUNCTION delivery.client_order_status(p_order_code text, p_phone text)
RETURNS TABLE (
  code text, status delivery.order_status, total numeric,
  estimated_ready_at timestamptz, delivered_at timestamptz,
  delivery_pin text, courier_name text
) LANGUAGE sql SECURITY DEFINER SET search_path = delivery AS $$
  SELECT o.code, o.status, o.total, o.estimated_ready_at, o.delivered_at,
         CASE WHEN o.status IN ('delivered','failed_delivery','rejected_by_business')
              THEN NULL ELSE o.delivery_pin END,
         c.full_name
    FROM delivery.orders o
    LEFT JOIN delivery.couriers c ON c.id = o.courier_id
   WHERE o.code = p_order_code AND o.client_phone = p_phone
$$;

-- ═══ RLS ════════════════════════════════════════════════════════════════════
ALTER TABLE delivery.orders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery.couriers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery.businesses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery.order_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery.courier_locations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery.cash_handoffs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery.earnings_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery.payrolls            ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery.cancellations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery.contact_access_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery.app_config          ENABLE ROW LEVEL SECURITY;

-- Правило нуль (docs/05): таблиця без політик закрита для всіх, окрім
-- service_role. Забути політику = закрити доступ, а не відкрити.

DROP POLICY IF EXISTS orders_read_own ON delivery.orders;
CREATE POLICY orders_read_own ON delivery.orders FOR SELECT TO authenticated
  USING (courier_id = delivery.current_courier_id() OR delivery.is_admin());

DROP POLICY IF EXISTS orders_admin_write ON delivery.orders;
CREATE POLICY orders_admin_write ON delivery.orders FOR UPDATE TO authenticated
  USING (delivery.is_admin()) WITH CHECK (delivery.is_admin());

DROP POLICY IF EXISTS couriers_read_self ON delivery.couriers;
CREATE POLICY couriers_read_self ON delivery.couriers FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR delivery.is_admin());

DROP POLICY IF EXISTS businesses_read ON delivery.businesses;
CREATE POLICY businesses_read ON delivery.businesses FOR SELECT TO authenticated
  USING (true);           -- назва й координати закладу не приватні

DROP POLICY IF EXISTS config_read ON delivery.app_config;
CREATE POLICY config_read ON delivery.app_config FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS events_read ON delivery.order_status_events;
CREATE POLICY events_read ON delivery.order_status_events FOR SELECT TO authenticated
  USING (delivery.is_admin());

DROP POLICY IF EXISTS earnings_read_own ON delivery.earnings_log;
CREATE POLICY earnings_read_own ON delivery.earnings_log FOR SELECT TO authenticated
  USING (courier_id = delivery.current_courier_id() OR delivery.is_admin());

DROP POLICY IF EXISTS payrolls_read_own ON delivery.payrolls;
CREATE POLICY payrolls_read_own ON delivery.payrolls FOR SELECT TO authenticated
  USING (courier_id = delivery.current_courier_id() OR delivery.is_admin());

DROP POLICY IF EXISTS handoffs_read_own ON delivery.cash_handoffs;
CREATE POLICY handoffs_read_own ON delivery.cash_handoffs FOR SELECT TO authenticated
  USING (courier_id = delivery.current_courier_id() OR delivery.is_admin());

DROP POLICY IF EXISTS locations_admin ON delivery.courier_locations;
CREATE POLICY locations_admin ON delivery.courier_locations FOR SELECT TO authenticated
  USING (delivery.is_admin() OR courier_id = delivery.current_courier_id());

-- ── Журнал append-only ─────────────────────────────────────────────────────
-- Політик на UPDATE і DELETE немає ЖОДНОЇ — навіть для адміна. Плюс явне
-- відкликання прав: без цього спір «я тиснув доставлено» недоказовий (B30)
REVOKE UPDATE, DELETE, TRUNCATE ON delivery.order_status_events FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON delivery.order_status_events FROM authenticated, anon;
REVOKE UPDATE, DELETE, TRUNCATE ON delivery.contact_access_log  FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON delivery.contact_access_log  FROM authenticated, anon;

-- ── Права ──────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA delivery TO anon, authenticated, service_role;

-- Прямий запис у таблиці заборонений усім, крім service_role: усі зміни
-- проходять через функції, які тримають правила. Інакше правило «фото
-- обовʼязкове» обходиться одним UPDATE
GRANT SELECT ON ALL TABLES IN SCHEMA delivery TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA delivery FROM authenticated, anon;
GRANT ALL ON ALL TABLES IN SCHEMA delivery TO service_role;
GRANT SELECT ON delivery.courier_queue, delivery.my_orders TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA delivery TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ▼ 20260728120300_auth_realtime.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0004 — ОБЛІКОВІ ЗАПИСИ Й СИНХРОНІЗАЦІЯ
--
-- Самореєстрації немає (ADR-0004): курʼєра заводить адмін. Це не
-- зручність, а вимога — застосунок дає доступ до телефонів клієнтів
-- і чужої готівки.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Первинний пароль ───────────────────────────────────────────────────────
-- Генерує сервер, показує адміну ОДИН раз, у наших таблицях не зберігає
-- ніде (B17). Хеш тримає Supabase Auth.
CREATE OR REPLACE FUNCTION delivery.generate_password() RETURNS text
LANGUAGE sql VOLATILE AS $$
  -- Без схожих символів (0/O, 1/l/I): пароль диктують голосом по телефону,
  -- і «нуль чи о» коштує дзвінка
  SELECT string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789',
           (floor(random() * 54) + 1)::int, 1), '')
  FROM generate_series(1, 8)
$$;

-- ── Логін курʼєра ──────────────────────────────────────────────────────────
-- `rd-oleh-07` — читається вголос і вводиться на телефоні без помилок.
-- Пошта потрібна лише Supabase Auth, тому синтетична.
CREATE OR REPLACE FUNCTION delivery.build_login(p_full_name text) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE base text; n int;
BEGIN
  base := lower(split_part(trim(p_full_name), ' ', 1));
  -- Транслітерація: логін мають набирати на латинській розкладці
  base := translate(base,
    'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя',
    'abvhgdeezzyiiyklmnoprstufhccss´ua');
  base := regexp_replace(base, '[^a-z]', '', 'g');
  IF base = '' THEN base := 'courier'; END IF;
  SELECT count(*) + 1 INTO n FROM delivery.couriers;
  RETURN 'rd-' || base || '-' || lpad(n::text, 2, '0');
END $$;

-- ── Зміна пароля при першому вході ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION delivery.mark_password_changed(p_courier uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = delivery AS $$
  UPDATE delivery.couriers SET must_change_password = false WHERE id = p_courier
$$;

-- ── Синхронізація ──────────────────────────────────────────────────────────
-- Realtime у Supabase роздає лише те, що входить у публікацію
-- `supabase_realtime`. Локально її немає — тому вся секція під умовою,
-- інакше міграція падала б на стенді розробки.
--
-- ⚠️ Realtime ПОВАЖАЄ RLS: підписник отримує лише ті рядки, які й так
-- має право прочитати. Курʼєр не побачить чужого замовлення й через
-- канал — це та сама політика, а не друга, узгоджена вручну (docs/05).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE delivery.orders;
    ALTER PUBLICATION supabase_realtime ADD TABLE delivery.couriers;
    ALTER PUBLICATION supabase_realtime ADD TABLE delivery.cash_handoffs;
  ELSE
    RAISE NOTICE 'публікації supabase_realtime немає — локальний стенд, пропускаємо';
  END IF;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'таблиці вже в публікації';
END $$;

-- ── Watchdog (B7) ──────────────────────────────────────────────────────────
-- Прапорці, а не статуси: замовлення може бути вже `delivered` і при
-- цьому простроченим. Статус описує, де воно; прапорець — що з ним не так.
CREATE OR REPLACE FUNCTION delivery.watchdog_flags(p_order delivery.orders)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN p_order.status = 'ready' AND p_order.courier_id IS NULL
           AND p_order.ready_at < now() - interval '15 minutes'
         THEN 'unclaimed' END,
    CASE WHEN p_order.status = 'on_the_way'
           AND p_order.on_the_way_at < now() - interval '60 minutes'
         THEN 'stuck' END,
    CASE WHEN p_order.delivered_at IS NOT NULL AND p_order.estimated_ready_at IS NOT NULL
           AND p_order.delivered_at > p_order.estimated_ready_at + interval '45 minutes'
         THEN 'late' END,
    CASE WHEN p_order.return_count >= 2
           AND p_order.status NOT IN ('delivered', 'failed_delivery')
         THEN 'bounced' END
  ], NULL)
$$;

-- Черга «потребує уваги» — те, що система не змогла вирішити сама
CREATE OR REPLACE VIEW delivery.attention
WITH (security_invoker = true) AS
SELECT o.id, o.code, o.status, o.dest_locality, o.courier_id,
       o.ready_at, o.placed_at, o.cancelled_at, o.payment_status,
       delivery.watchdog_flags(o.*) AS watchdog
FROM delivery.orders o
WHERE array_length(delivery.watchdog_flags(o.*), 1) > 0
   OR o.payment_status = 'refund_needed';

GRANT SELECT ON delivery.attention TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA delivery TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ▼ 20260728120400_seed_business.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- НАСІННЯ: пілотний заклад
--
-- Без цього рядка база після накату порожня, і ПЕРШИЙ ЖЕ виклик
-- place_order падає з `business_not_found`. Тобто застосунок виглядав би
-- зламаним одразу після успішного встановлення.
--
-- Це міграція, а не разовий скрипт, навмисно: заклад має зʼявитись і в
-- продакшені, і на staging, і в будь-якій новій копії — без ручного кроку,
-- який колись забудуть.
--
-- ⚠️ external_ref заповнюється ПІЗНІШЕ, коли cstllife дасть свій
-- ідентифікатор картки. Поки NULL — place_order знаходить заклад за id.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO delivery.businesses (
  name, type, address_text, lat, lng, phone,
  delivery_radius_km, working_hours, cash_reconciliation_period
)
SELECT
  'Суші Мар',
  'sushi',
  'с. Дідичі, вул. Незалежності 19А',
  50.75083,
  25.80328,
  NULL,
  15,               -- радіус: далі електроскутер просто не доїде (B10)
  '{}'::jsonb,      -- графік не заданий = цілодобово; реальний виставить власник
  'weekly'
WHERE NOT EXISTS (SELECT 1 FROM delivery.businesses);

-- ── Як призначити себе адміном ─────────────────────────────────────────────
--
-- Обліковий запис створюється в дашборді Supabase (Authentication → Users →
-- Add user). Роль зберігається в app_metadata, і саме її читає delivery.is_admin().
-- Виконати ОДИН раз у SQL Editor, підставивши свою пошту:
--
--   UPDATE auth.users
--      SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
--                              || '{"role":"admin"}'::jsonb
--    WHERE email = 'ваша@пошта'
--   RETURNING email, raw_app_meta_data ->> 'role' AS role;
--
-- ⚠️ RETURNING тут не для краси. Без нього SQL Editor на БУДЬ-ЯКИЙ UPDATE
-- відповідає «Success. No rows returned» — і однаково виглядають випадок
-- «роль призначено» та «пошта не збіглась, не призначено нічого».
-- З RETURNING порожня відповідь означає рівно одне: не спрацювало.
--
-- Після цього треба вийти й зайти знову: роль потрапляє в токен при вході.

-- ═══════════════════════════════════════════════════════════════════════════
-- Кінець. Перевірка, що все стало на місце:
--
--   SELECT name, delivery_radius_km FROM delivery.businesses;
--
-- Має відповісти одним рядком: Суші Мар · 15
-- ═══════════════════════════════════════════════════════════════════════════
