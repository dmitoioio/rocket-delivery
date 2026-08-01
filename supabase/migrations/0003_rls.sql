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
