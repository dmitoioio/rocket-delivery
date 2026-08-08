-- ═══════════════════════════════════════════════════════════════════════════
-- 0006 — tick() ПЕРЕСТАЄ БУДИТИ САМ СЕБЕ
--
-- Симптом власника: «вкладка з курʼєром постійно рухається, тобто підвисає».
--
-- Замкнене коло, і воно замикається саме на живій базі:
--
--   fetchAdminOverview() → tick() → UPDATE по всіх замовленнях «готово»
--     → Realtime надсилає подію про зміну orders
--       → клієнт: scheduleReload()
--         → fetchAdminOverview() → tick() → …
--
-- Період ~1.2 секунди, нескінченно. Те саме в курʼєра: fetchQueue() теж
-- викликає tick().
--
-- Причина в одному слові — БЕЗУМОВНО. UPDATE виконувався щоразу, навіть
-- коли надбавка не змінилась ні на копійку. Для Postgres це повноцінний
-- запис (рядок переписується), а для Realtime — подія. Тобто система
-- сама собі генерувала привід перечитатись.
--
-- У демо цього не існувало за побудовою: моковий адаптер ніякого Realtime
-- не має, підписка повертає null. Зламалось рівно при переході на живу
-- базу — як і решта поломок цієї доби.
--
-- Виправлення: писати лише те, що справді змінилось. І повертати кількість
-- змінених рядків — щоб інваріант «повторний tick мовчить» можна було
-- ПЕРЕВІРИТИ, а не пообіцяти.
-- ═══════════════════════════════════════════════════════════════════════════

-- Тип результату змінюється, а CREATE OR REPLACE цього не вміє
DROP FUNCTION IF EXISTS delivery.tick();

CREATE OR REPLACE FUNCTION delivery.tick() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery AS $$
DECLARE steps jsonb; touched int;
BEGIN
  steps := delivery.config('waiting_bonus_steps');

  WITH want AS (
    SELECT o.id,
           COALESCE((
             SELECT max((s ->> 'bonus')::numeric)
               FROM jsonb_array_elements(steps) s
              WHERE extract(epoch FROM (now() - o.ready_at)) / 60 >= (s ->> 'afterMin')::numeric
           ), 0) AS bonus
      FROM delivery.orders o
     WHERE o.status = 'ready' AND o.courier_id IS NULL AND o.ready_at IS NOT NULL
  )
  UPDATE delivery.orders o
     SET waiting_bonus = want.bonus
    FROM want
   -- 🛑 Саме цей рядок і розриває коло: без нього кожен виклик — запис,
   -- кожен запис — подія Realtime, кожна подія — новий виклик
   WHERE o.id = want.id AND o.waiting_bonus IS DISTINCT FROM want.bonus;

  GET DIAGNOSTICS touched = ROW_COUNT;
  RETURN touched;
END $$;

-- Гуртовий GRANT стоїть у міграції …120300, тобто раніше за цю
GRANT EXECUTE ON FUNCTION delivery.tick() TO authenticated, service_role;
