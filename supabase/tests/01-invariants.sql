-- ═══════════════════════════════════════════════════════════════════════════
-- ТЕСТИ ІНВАРІАНТІВ ПРОТИ СПРАВЖНЬОГО POSTGRES
--
-- Запуск: npm run db:test
-- Кожна перевірка або мовчить, або кидає виняток — файл виконується
-- з ON_ERROR_STOP=1, тож перша ж провалена зупиняє все.
--
-- Це не «схема виглядає правильно». Це прогін тих самих правил, які
-- описує моковий адаптер, по реальній базі з реальними обмеженнями.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF cond THEN RAISE NOTICE '  ✅ %', label;
  ELSE RAISE EXCEPTION '  ❌ %', label; END IF;
END $$;

-- Перевіряє, що виклик ВПАВ із очікуваним текстом. Тест на заборону
-- має падати — інакше він нічого не доводить
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

-- ── Насіння ────────────────────────────────────────────────────────────────
DO $$
DECLARE b uuid; c1 uuid; c2 uuid;
BEGIN
  INSERT INTO delivery.businesses (external_ref, name, type, address_text, lat, lng,
                                   delivery_radius_km, working_hours)
  VALUES ('cstllife:sushi-mar', 'Суші Мар', 'sushi', 'с. Дідичі, вул. Центральна 1',
          50.7192, 25.8125, 15, '{}'::jsonb)
  RETURNING id INTO b;

  INSERT INTO delivery.couriers (full_name, status, completed_deliveries)
  VALUES ('Олег Ткачук', 'online', 50) RETURNING id INTO c1;
  INSERT INTO delivery.couriers (full_name, status, completed_deliveries)
  VALUES ('Віталій Кузьмич', 'online', 50) RETURNING id INTO c2;

  PERFORM set_config('test.biz', b::text, false);
  PERFORM set_config('test.c1', c1::text, false);
  PERFORM set_config('test.c2', c2::text, false);
END $$;

\echo ''
\echo '═══ Створення замовлення ═══'

-- Радіус: Луцьк за 33.6 км при ліміті 15
SELECT pg_temp.rejects(
  format($f$ SELECT delivery.place_order('cstllife:sushi-mar', '[]'::jsonb, 300, 'cash',
    'Тест', '+380000000000', 'м. Луцьк, вул. Соборності 1', 50.7472, 25.3254) $f$),
  'out_of_radius', 'замовлення за межами радіуса не створюється (B10)');

SELECT pg_temp.rejects(
  format($f$ SELECT delivery.place_order('НЕМАЄ-ТАКОГО', '[]'::jsonb, 300, 'cash',
    'Тест', '+380000000000', 'с. Метельне', 50.7100, 25.8300) $f$),
  'business_not_found', 'невідома картка бізнесу відхиляється');

DO $$
DECLARE o delivery.orders;
BEGIN
  o := delivery.place_order('cstllife:sushi-mar', '[{"name":"Філадельфія","qty":1}]'::jsonb,
        320, 'cash', 'Марія', '+380931234455', 'с. Метельне, вул. Лісова 12',
        50.7100, 25.8300, 'зелені ворота', 'с. Метельне', 'idem-1');
  PERFORM set_config('test.o1', o.id::text, false);
  PERFORM pg_temp.ok(o.code LIKE 'RD-%', 'код замовлення згенеровано: ' || o.code);
  PERFORM pg_temp.ok(o.total = 370, 'сума сходиться: 320 + 50 = ' || o.total);
  PERFORM pg_temp.ok(o.delivery_pin ~ '^\d{4}$', 'код підтвердження згенеровано');
  PERFORM pg_temp.ok(o.distance_km > 0 AND o.distance_km < 15,
    'відстань порахована з координат: ' || o.distance_km || ' км');
  PERFORM pg_temp.ok(o.status = 'placed', 'починає зі статусу placed, а не «готово»');
END $$;

-- Ідемпотентність: той самий ключ не створює друге замовлення (B24)
DO $$
DECLARE o delivery.orders; n int;
BEGIN
  o := delivery.place_order('cstllife:sushi-mar', '[]'::jsonb, 320, 'cash', 'Марія',
        '+380931234455', 'с. Метельне, вул. Лісова 12', 50.7100, 25.8300, NULL, NULL, 'idem-1');
  SELECT count(*) INTO n FROM delivery.orders WHERE idempotency_key = 'idem-1';
  PERFORM pg_temp.ok(n = 1, 'повтор із тим самим ключем не створює дубль (B24)');
END $$;

\echo ''
\echo '═══ Заклад: готовність — дія людини, не таймер (B8) ═══'

DO $$
DECLARE o delivery.orders; oid uuid := current_setting('test.o1')::uuid;
BEGIN
  o := delivery.business_accept_order(oid, 10);
  PERFORM pg_temp.ok(o.status = 'preparing' AND o.estimated_ready_at IS NOT NULL,
    'заклад прийняв і поставив ПРОГНОЗ готовності');
  PERFORM pg_temp.ok(o.ready_at IS NULL, 'ready_at ще порожній — це ФАКТ, не прогноз');

  o := delivery.business_mark_ready(oid);
  PERFORM pg_temp.ok(o.status = 'ready' AND o.ready_at IS NOT NULL,
    'кнопка «готово» зробила ready_at фактом');
END $$;

\echo ''
\echo '═══ Гонка двох курʼєрів за одне замовлення (B25) ═══'

DO $$
DECLARE oid uuid := current_setting('test.o1')::uuid;
        c1 uuid := current_setting('test.c1')::uuid;
        c2 uuid := current_setting('test.c2')::uuid;
        won int := 0; lost int := 0;
BEGIN
  BEGIN PERFORM delivery.accept_order(oid, c1); won := won + 1;
  EXCEPTION WHEN OTHERS THEN lost := lost + 1; END;
  BEGIN PERFORM delivery.accept_order(oid, c2); won := won + 1;
  EXCEPTION WHEN OTHERS THEN lost := lost + 1; END;

  PERFORM pg_temp.ok(won = 1 AND lost = 1,
    'замовлення дістається рівно одному: виграв ' || won || ', програв ' || lost);
END $$;

SELECT pg_temp.rejects(
  format('SELECT delivery.accept_order(%L, %L)',
         current_setting('test.o1'), current_setting('test.c2')),
  'already_taken', 'другий курʼєр отримує «вже зайняте», а не тихий збій');

\echo ''
\echo '═══ Онлайн-гейт і ліміт готівки ═══'

DO $$
DECLARE c2 uuid := current_setting('test.c2')::uuid;
BEGIN
  PERFORM delivery.set_courier_status(c2, 'offline');
END $$;

DO $$
DECLARE o delivery.orders;
BEGIN
  o := delivery.place_order('cstllife:sushi-mar', '[]'::jsonb, 200, 'cash', 'Петро',
        '+380931111111', 'с. Романів', 50.6900, 25.8000, NULL, NULL, 'idem-2');
  PERFORM delivery.business_mark_ready(o.id);
  PERFORM set_config('test.o2', o.id::text, false);
END $$;

SELECT pg_temp.rejects(
  format('SELECT delivery.accept_order(%L, %L)',
         current_setting('test.o2'), current_setting('test.c2')),
  'not_online', 'офлайн-курʼєр не бере замовлень — сервер відмовляє сам');

\echo ''
\echo '═══ Завершення доставки: фото і код ═══'

DO $$
DECLARE oid uuid := current_setting('test.o1')::uuid;
        c1 uuid := current_setting('test.c1')::uuid;
BEGIN
  PERFORM delivery.advance_status(oid, c1, 'picked_up');
  PERFORM delivery.advance_status(oid, c1, 'on_the_way');
END $$;

SELECT pg_temp.rejects(
  format('SELECT delivery.complete_delivery(%L, %L, NULL, %L)',
         current_setting('test.o1'), current_setting('test.c1'), '0000'),
  'photo_required', 'без фото доставку завершити неможливо');

SELECT pg_temp.rejects(
  format('SELECT delivery.complete_delivery(%L, %L, %L, %L)',
         current_setting('test.o1'), current_setting('test.c1'), 'proofs/o1.jpg', '9999'),
  'wrong_pin', 'невірний код відхиляється СЕРВЕРОМ');

DO $$
DECLARE oid uuid := current_setting('test.o1')::uuid;
        c1 uuid := current_setting('test.c1')::uuid;
        pin text; o delivery.orders; earned numeric; cash numeric;
BEGIN
  SELECT delivery_pin INTO pin FROM delivery.orders WHERE id = oid;
  o := delivery.complete_delivery(oid, c1, 'proofs/o1.jpg', pin);
  PERFORM pg_temp.ok(o.status = 'delivered', 'вірний код завершує доставку');

  SELECT sum(amount) INTO earned FROM delivery.earnings_log WHERE order_id = oid;
  PERFORM pg_temp.ok(earned = 35, 'заробіток нарахував ТРИГЕР, не клієнт: ' || earned || ' ₴');

  SELECT cash_on_hand INTO cash FROM delivery.couriers WHERE id = c1;
  PERFORM pg_temp.ok(cash = 370, 'готівка лягла на руки курʼєру: ' || cash || ' ₴');
END $$;

\echo ''
\echo '═══ Обмеження бази, які не можна обійти взагалі ═══'

-- Ціляти треба точно: у замовлення без курʼєра першим спрацює ІНШЕ
-- обмеження, і тест «пройде» з хибної причини. Беремо вже доставлене
-- замовлення й прибираємо фото — так перевіряється саме інваріант 1
SELECT pg_temp.rejects(
  format($f$ UPDATE delivery.orders SET proof_photo_path=NULL WHERE id=%L $f$,
         current_setting('test.o1')),
  'delivered_needs_proof', '«доставлено» без фото відхиляє САМА БАЗА (інваріант 1)');

SELECT pg_temp.rejects(
  format($f$ UPDATE delivery.orders SET status='delivered', courier_id=NULL WHERE id=%L $f$,
         current_setting('test.o2')),
  'delivered_needs_courier', '«доставлено» без курʼєра відхиляє база (інваріант 2)');

SELECT pg_temp.rejects(
  $f$ INSERT INTO delivery.orders (code, business_id, items_total, delivery_fee, total,
        payment_method, dest_address_text, dest_lat, dest_lng)
      SELECT 'RD-BAD', id, 100, 50, 999, 'cash', 'десь', 50.7, 25.8
        FROM delivery.businesses LIMIT 1 $f$,
  'total_is_sum', 'сума, що не сходиться, відхиляється базою (інваріант 6)');

\echo ''
\echo '═══ Готівка і зарплата ═══'

DO $$
DECLARE c1 uuid := current_setting('test.c1')::uuid; h delivery.cash_handoffs; c delivery.couriers;
BEGIN
  h := delivery.declare_cash_handoff(c1, 370);
  PERFORM pg_temp.ok(array_length(h.order_ids, 1) = 1,
    'здача привʼязана до КОНКРЕТНОГО замовлення, а не до абстрактної суми');
  PERFORM pg_temp.ok(h.expected_amount = 370, 'сервер знає, скільки мало бути');

  h := delivery.confirm_handoff(h.id, 300);   -- заклад прийняв менше
  PERFORM pg_temp.ok(h.status = 'disputed', 'розбіжність зафіксована як спір');
  PERFORM pg_temp.ok(h.discrepancy = -70, 'різницю порахувала база: ' || h.discrepancy);

  SELECT * INTO c FROM delivery.couriers WHERE id = c1;
  PERFORM pg_temp.ok(c.debt = 70, 'розбіжність стала боргом: ' || c.debt || ' ₴');
  PERFORM pg_temp.ok(c.cash_on_hand = 0, 'готівка списана з рук');
END $$;

DO $$
DECLARE c1 uuid := current_setting('test.c1')::uuid; p delivery.payrolls;
BEGIN
  p := delivery.create_payroll(c1);
  PERFORM pg_temp.ok(p.gross_amount = 35, 'нараховано: ' || p.gross_amount);
  PERFORM pg_temp.ok(p.deductions = 35, 'борг утримано (не більше нарахованого)');
  PERFORM pg_temp.ok(p.net_amount = 0, 'до виплати: ' || p.net_amount);

  p := delivery.pay_payroll(p.id);
  PERFORM pg_temp.ok(p.status = 'paid', 'виплату проведено');
END $$;

\echo ''
\echo '═══ Журнал ═══'

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM delivery.order_status_events
   WHERE order_id = current_setting('test.o1')::uuid;
  PERFORM pg_temp.ok(n >= 6, 'кожен перехід записаний тригером: ' || n || ' подій');
END $$;

\echo ''
\echo '═══ Локація ═══'

DO $$
DECLARE c1 uuid := current_setting('test.c1')::uuid; n int;
BEGIN
  PERFORM delivery.update_courier_location(c1, 50.7255, 25.8301, 12);
  PERFORM delivery.update_courier_location(c1, 50.7300, 25.8350, 10);
  SELECT count(*) INTO n FROM delivery.courier_locations WHERE courier_id = c1;
  PERFORM pg_temp.ok(n = 1, 'зберігається лише ОСТАННЯ точка, історія не росте (B16)');

  PERFORM delivery.set_courier_status(c1, 'offline');
  SELECT count(*) INTO n FROM delivery.courier_locations WHERE courier_id = c1;
  PERFORM pg_temp.ok(n = 0, 'вихід зі зміни стирає позицію — це не стеження');
END $$;

\echo ''
ROLLBACK;
