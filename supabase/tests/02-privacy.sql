-- ═══════════════════════════════════════════════════════════════════════════
-- ТЕСТИ ПРИВАТНОСТІ — найдорожча частина
--
-- Тут перевіряється не «політика написана», а «курʼєр Б справді не може
-- дістати телефон клієнта курʼєра А». Різниця між цими двома твердженнями
-- у цьому проєкті вже коштувала бага B41: перевірка коду підтвердження
-- виглядала реалізованою і була театром, бо сервер віддавав очікуваний
-- код разом із замовленням.
--
-- Метод: перемикаємось на роль `authenticated` і підставляємо різні
-- auth.uid() — рівно те, що робить Supabase із перевіреного JWT.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF cond THEN RAISE NOTICE '  ✅ %', label;
  ELSE RAISE EXCEPTION '  ❌ %', label; END IF;
END $$;

-- ── Насіння: два курʼєри з обліковими записами, одне замовлення ────────────
DO $$
DECLARE b uuid; u1 uuid; u2 uuid; c1 uuid; c2 uuid; o delivery.orders;
BEGIN
  INSERT INTO auth.users (email) VALUES ('oleh@example.test') RETURNING id INTO u1;
  INSERT INTO auth.users (email) VALUES ('vitalii@example.test') RETURNING id INTO u2;

  INSERT INTO delivery.businesses (external_ref, name, type, address_text, lat, lng)
  VALUES ('cstllife:sushi-mar', 'Суші Мар', 'sushi', 'с. Дідичі', 50.7192, 25.8125)
  RETURNING id INTO b;

  INSERT INTO delivery.couriers (auth_user_id, full_name, status, completed_deliveries)
  VALUES (u1, 'Олег Ткачук', 'online', 50) RETURNING id INTO c1;
  INSERT INTO delivery.couriers (auth_user_id, full_name, status, completed_deliveries)
  VALUES (u2, 'Віталій Кузьмич', 'online', 50) RETURNING id INTO c2;

  o := delivery.place_order('cstllife:sushi-mar', '[]'::jsonb, 320, 'cash',
        'Марія', '+380931234455', 'с. Метельне, вул. Лісова 12',
        50.7100, 25.8300, 'зелені ворота', 'с. Метельне');
  PERFORM delivery.business_mark_ready(o.id);

  PERFORM set_config('t.u1', u1::text, false);
  PERFORM set_config('t.u2', u2::text, false);
  PERFORM set_config('t.c1', c1::text, false);
  PERFORM set_config('t.c2', c2::text, false);
  PERFORM set_config('t.o',  o.id::text, false);
  PERFORM set_config('t.pin', o.delivery_pin, false);
END $$;

\echo ''
\echo '═══ Черга: що бачить курʼєр ДО взяття замовлення ═══'

DO $$
DECLARE cols text[];
BEGIN
  SELECT array_agg(column_name::text ORDER BY column_name) INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'delivery' AND table_name = 'courier_queue';

  PERFORM pg_temp.ok(NOT ('client_phone' = ANY(cols)), 'у черзі НЕМАЄ телефону клієнта (B15)');
  PERFORM pg_temp.ok(NOT ('client_name' = ANY(cols)), 'у черзі немає імені клієнта');
  PERFORM pg_temp.ok(NOT ('dest_address_text' = ANY(cols)), 'у черзі немає точної адреси');
  PERFORM pg_temp.ok(NOT ('dest_lat' = ANY(cols)), 'у черзі немає координат клієнта');
  PERFORM pg_temp.ok(NOT ('dest_landmark' = ANY(cols)), 'у черзі немає орієнтира');
  PERFORM pg_temp.ok(NOT ('delivery_pin' = ANY(cols)), 'у черзі НЕМАЄ коду підтвердження (B41)');
  PERFORM pg_temp.ok(NOT ('payment_method' = ANY(cols)),
    'у черзі немає способу оплати — інакше готівкові дискримінуються (B35)');
  PERFORM pg_temp.ok('dest_locality' = ANY(cols), 'населений пункт Є — цього досить для рішення');
  PERFORM pg_temp.ok('courier_earnings' = ANY(cols), 'заробіток курʼєра Є, а сума чека — ні');
END $$;

\echo ''
\echo '═══ Замовлення курʼєра: код підтвердження недосяжний ═══'

DO $$
DECLARE cols text[];
BEGIN
  SELECT array_agg(column_name::text) INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'delivery' AND table_name = 'my_orders';
  PERFORM pg_temp.ok(NOT ('delivery_pin' = ANY(cols)),
    'delivery_pin відсутній навіть у СВОЇХ замовленнях (B41)');
  PERFORM pg_temp.ok(NOT ('client_phone' = ANY(cols)),
    'телефон не читається таблицею — тільки через функцію під умову');
END $$;

\echo ''
\echo '═══ Контакт клієнта: хто, коли, чий ═══'

-- До взяття замовлення контакту немає ні в кого
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM delivery.get_order_contact(
    current_setting('t.o')::uuid, current_setting('t.c1')::uuid);
  PERFORM pg_temp.ok(n = 0, 'ДО взяття контакт не видається навіть майбутньому курʼєру');
END $$;

DO $$
BEGIN
  PERFORM delivery.accept_order(current_setting('t.o')::uuid, current_setting('t.c1')::uuid);
END $$;

DO $$
DECLARE r record; n int;
BEGIN
  SELECT * INTO r FROM delivery.get_order_contact(
    current_setting('t.o')::uuid, current_setting('t.c1')::uuid);
  PERFORM pg_temp.ok(r.client_phone = '+380931234455',
    'ПІСЛЯ взяття призначений курʼєр отримує телефон');
  PERFORM pg_temp.ok(r.dest_landmark = 'зелені ворота', 'і орієнтир — у селі він важливіший за адресу');

  -- Головна перевірка всього файлу
  SELECT count(*) INTO n FROM delivery.get_order_contact(
    current_setting('t.o')::uuid, current_setting('t.c2')::uuid);
  PERFORM pg_temp.ok(n = 0, '🔒 ЧУЖИЙ курʼєр контакту НЕ отримує');
END $$;

DO $$
DECLARE granted int; denied int;
BEGIN
  SELECT count(*) FILTER (WHERE l.granted), count(*) FILTER (WHERE NOT l.granted)
    INTO granted, denied FROM delivery.contact_access_log l;
  PERFORM pg_temp.ok(granted = 1 AND denied = 2,
    'кожен запит контакту в журналі: видано ' || granted || ', відмовлено ' || denied);
END $$;

\echo ''
\echo '═══ Робота під роллю authenticated (як через Supabase) ═══'

-- Далі — те саме, але від імені реального користувача: роль перемкнена,
-- auth.uid() підставлений. Саме так виглядає запит із браузера
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000000';

DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', current_setting('t.u2'), true); END $$;
SET LOCAL ROLE authenticated;

DO $$
DECLARE n int;
BEGIN
  -- Курʼєр Віталій дивиться таблицю замовлень навпростець
  SELECT count(*) INTO n FROM delivery.orders;
  PERFORM pg_temp.ok(n = 0,
    '🔒 курʼєр Б не бачить ЖОДНОГО чужого замовлення в таблиці (RLS)');
END $$;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM delivery.couriers;
  PERFORM pg_temp.ok(n = 1, 'курʼєр бачить лише свій профіль, не список колег');
END $$;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM delivery.order_status_events;
  PERFORM pg_temp.ok(n = 0, 'журнал переходів курʼєру не видно');
END $$;

-- Спроба обійти правила прямим записом
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    UPDATE delivery.orders SET status = 'delivered';
  EXCEPTION WHEN insufficient_privilege OR others THEN blocked := true;
  END;
  PERFORM pg_temp.ok(blocked OR NOT FOUND,
    '🔒 прямий UPDATE замовлення курʼєром не проходить — тільки через функції');
END $$;

DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    DELETE FROM delivery.order_status_events;
  EXCEPTION WHEN OTHERS THEN blocked := true;
  END;
  PERFORM pg_temp.ok(blocked, '🔒 журнал не видаляється — append-only (B30)');
END $$;

RESET ROLE;

\echo ''
\echo '═══ Сторінка клієнта: код бачить той, хто його називатиме ═══'

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM delivery.client_order_status(
    (SELECT code FROM delivery.orders WHERE id = current_setting('t.o')::uuid),
    '+380931234455');
  PERFORM pg_temp.ok(r.delivery_pin = current_setting('t.pin'),
    'клієнт бачить свій код — інакше верифікація неможлива з обох боків');
  PERFORM pg_temp.ok(r.courier_name = 'Олег Ткачук', 'і імʼя курʼєра, який везе');
END $$;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM delivery.client_order_status(
    (SELECT code FROM delivery.orders WHERE id = current_setting('t.o')::uuid),
    '+380000000000');
  PERFORM pg_temp.ok(n = 0, 'чужий телефон не відкриває чуже замовлення');
END $$;

\echo ''
ROLLBACK;
