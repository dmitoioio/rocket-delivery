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
