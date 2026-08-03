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
