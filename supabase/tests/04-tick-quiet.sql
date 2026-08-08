-- ═══════════════════════════════════════════════════════════════════════════
-- ТЕСТ: tick() НЕ БУДИТЬ САМ СЕБЕ
--
-- Найдорожчий інваріант усієї синхронізації, і водночас найменш очевидний.
--
-- Клієнт перечитує дані, коли база повідомляє про зміну. Якщо саме
-- перечитування щось ЗАПИСУЄ — база повідомляє про зміну знову, і система
-- крутиться сама на собі. У власника це виглядало так: «вкладка постійно
-- рухається, тобто підвисає».
--
-- Перевіряється не «код виглядає правильно», а число: скільки рядків
-- переписав повторний виклик. Має бути нуль.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF cond THEN RAISE NOTICE '  ✅ %', label;
  ELSE RAISE EXCEPTION '  ❌ %', label; END IF;
END $$;

-- ── Насіння: замовлення, яке чекає курʼєра ────────────────────────────────
DO $$
DECLARE o delivery.orders;
BEGIN
  INSERT INTO delivery.businesses (external_ref, name, type, address_text, lat, lng)
  VALUES ('cstllife:tick-test', 'Суші Мар', 'sushi', 'с. Дідичі', 50.7192, 25.8125);

  o := delivery.place_order('cstllife:tick-test', '[]'::jsonb, 300, 'cash',
        'Тест', '+380000000001', 'с. Метельне, вул. Лісова 1',
        50.7100, 25.8300, NULL, 'с. Метельне');
  PERFORM delivery.business_mark_ready(o.id);
  PERFORM set_config('t.o', o.id::text, false);
END $$;

\echo ''
\echo '═══ Скільки рядків переписує tick ═══'

-- Перший виклик має право щось змінити: замовлення щойно стало «готовим»,
-- надбавка ще не рахована
DO $$
DECLARE first_run int; second_run int; third_run int;
BEGIN
  first_run  := delivery.tick();
  second_run := delivery.tick();
  third_run  := delivery.tick();

  RAISE NOTICE '  перший виклик: % рядків · другий: % · третій: %',
    first_run, second_run, third_run;

  -- 🛑 Ось воно. Раніше тут було «1, 1, 1» — і кожна одиниця означала
  -- подію Realtime, тобто новий привід перечитати дані, тобто новий tick
  PERFORM pg_temp.ok(second_run = 0, 'повторний tick не переписує нічого');
  PERFORM pg_temp.ok(third_run = 0, 'і третій теж — коло розірване');
END $$;

\echo ''
\echo '═══ Але потрібне tick усе одно робить ═══'

-- Інакше «нічого не пише» можна було б забезпечити порожньою функцією
DO $$
DECLARE changed int; bonus numeric;
BEGIN
  -- Відсуваємо час готовності на пів години назад: надбавка має зрости
  UPDATE delivery.orders SET ready_at = now() - interval '30 minutes'
   WHERE id = current_setting('t.o')::uuid;

  changed := delivery.tick();
  SELECT waiting_bonus INTO bonus FROM delivery.orders
   WHERE id = current_setting('t.o')::uuid;

  PERFORM pg_temp.ok(changed = 1, 'коли надбавка справді змінилась — рядок переписується');
  PERFORM pg_temp.ok(bonus > 0, format('надбавка нарахована: %s ₴', bonus));
  PERFORM pg_temp.ok(delivery.tick() = 0, 'і одразу після цього знову тиша');
END $$;

ROLLBACK;
