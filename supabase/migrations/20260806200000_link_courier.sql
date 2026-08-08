-- ═══════════════════════════════════════════════════════════════════════════
-- 0005 — ПРИВʼЯЗКА КУРʼЄРА ДО НАЯВНОГО ОБЛІКОВОГО ЗАПИСУ
--
-- Навіщо. Створення курʼєра було можливе рівно одним шляхом — через Edge
-- Function `create-courier`, бо запис у Supabase Auth вимагає ключа
-- service_role, якому не місце в браузері. Але розгорнути ту функцію може
-- лише власник проєкту, і поки він цього не зробив, кнопка в адмінці не
-- могла спрацювати НІКОЛИ. Тобто застосунок упирався в дію, яку сам
-- виконати не здатен.
--
-- Тут другий шлях, який не потребує нічого поза базою: обліковий запис
-- створюється в дашборді (Authentication → Add user — дію власник уже
-- робив, коли створював себе), а застосунок лише привʼязує до нього
-- картку курʼєра.
--
-- ⚠️ Свідомо НЕ пишемо в auth.users самі. Спокуса є, але це
-- непідтримуваний шлях: потрібні ще auth.identities, точний формат хешу
-- пароля й службові поля, а перевірити це без GoTrue неможливо. Правило
-- «не віддавати неперевірене» дорожче за зекономлений крок.
--
-- Пароль знає власник — він задав його в дашборді. Тому
-- must_change_password = false: вимагати зміну пароля, який людина щойно
-- сама придумала, це ритуал без сенсу.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION delivery.link_courier(
  p_email     text,
  p_full_name text,
  p_phone     text DEFAULT NULL
) RETURNS delivery.couriers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = delivery, public AS $$
-- ⚠️ Префікс v_ у змінних не про стиль. Локальна змінна з іменем `email`
-- зіштовхується з колонкою auth.users.email, і PL/pgSQL за замовчуванням
-- падає з «column reference is ambiguous» просто в момент виклику.
DECLARE u uuid; c delivery.couriers; v_email text; v_name text;
BEGIN
  -- Перевірка права — у базі, а не в клієнті. Клієнтська нічого не варта:
  -- запит до PostgREST можна надіслати й повз застосунок
  IF NOT delivery.is_admin() THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = 'RD001';
  END IF;

  v_email := lower(trim(COALESCE(p_email, '')));
  v_name  := trim(COALESCE(p_full_name, ''));

  IF length(v_name) < 3 THEN
    RAISE EXCEPTION 'full_name_required' USING ERRCODE = 'RD002';
  END IF;

  SELECT id INTO u FROM auth.users WHERE lower(auth.users.email) = v_email;
  IF u IS NULL THEN
    RAISE EXCEPTION 'auth_user_not_found: %', v_email USING ERRCODE = 'RD002';
  END IF;

  -- auth_user_id UNIQUE зловив би це й сам, але повідомлення бази
  -- («duplicate key value violates unique constraint») людині нічого не каже
  IF EXISTS (SELECT 1 FROM delivery.couriers WHERE auth_user_id = u) THEN
    RAISE EXCEPTION 'courier_already_linked: %', v_email USING ERRCODE = 'RD003';
  END IF;

  INSERT INTO delivery.couriers (auth_user_id, full_name, phone, must_change_password)
  VALUES (u, v_name, NULLIF(trim(COALESCE(p_phone, '')), ''), false)
  RETURNING * INTO c;

  RETURN c;
END $$;

-- ⚠️ Гуртовий GRANT ON ALL FUNCTIONS стоїть у міграції …120300, тобто
-- РАНІШЕ за цю. На функції, створені пізніше, він не поширюється — без
-- явного рядка нижче виклик падав би з «permission denied for function»
GRANT EXECUTE ON FUNCTION delivery.link_courier(text, text, text) TO authenticated;
