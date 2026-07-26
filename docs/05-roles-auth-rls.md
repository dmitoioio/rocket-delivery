# 05 — Ролі, авторизація і RLS

> 🔴 **Контекст, який не можна ігнорувати.** У проєкті вже був витік через RLS на приватних повідомленнях. Це означає, що проблема не в одному пропущеному рядку політики, а у відсутності процесу. Цей документ описує процес, а не тільки правила.

## Правило нуль

**Deny by default.** На кожній таблиці:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;
```

Без жодної політики таблиця недоступна нікому, крім `service_role`. Далі політики додають доступ точково. Ніколи не навпаки.

## Правило одне: жодна таблиця не мержиться без тесту доступу

У тому ж PR, що створює таблицю, має бути тест, який доводить:

1. **анонім** не читає нічого;
2. **чужий курʼєр** не читає чужі замовлення;
3. **клієнт** не читає чужі замовлення;
4. **заклад** не читає замовлення іншого закладу;
5. запис у поля, яких роль не має права торкатись, **відхиляється базою**, а не приховується в UI.

Тест, що перевіряє «кнопки немає в інтерфейсі» — це не тест безпеки.

## Ролі

Роль зберігається в **`app_metadata`**, не в `user_metadata`.

> `user_metadata` користувач може редагувати сам через `supabase.auth.updateUser()`. Роль там = будь-який курʼєр робить себе адміном одним запитом із консолі браузера. `app_metadata` пише лише `service_role`.

```
app_metadata: {
  role: 'client' | 'business' | 'courier' | 'admin',
  business_id: uuid,   -- для role='business'
  courier_id:  uuid    -- для role='courier'
}
```

Хелпери для політик:

```sql
CREATE FUNCTION auth_role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'anon');
$$;

CREATE FUNCTION auth_courier_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt() -> 'app_metadata' ->> 'courier_id', '')::uuid;
$$;

CREATE FUNCTION auth_business_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt() -> 'app_metadata' ->> 'business_id', '')::uuid;
$$;
```

## Матриця доступу до `orders`

| Роль | Читає | Пише |
|---|---|---|
| Клієнт | Тільки свої замовлення | Нічого напряму (тільки скасування через RPC) |
| Заклад | Тільки замовлення свого `business_id` | `status` у межах своєї частини машини, `estimated_ready_at`, `ready_at` |
| Курʼєр | Черга (`ready`, без курʼєра) — **обмежений набір колонок** + свої призначені замовлення повністю | `status` у своїй частині машини, `proof_photo_path` |
| Адмін | Усе | Через RPC із логуванням |
| Анонім | Нічого | Нічого |

## 🔒 Телефон і адреса клієнта — найгостріше місце

**Проблема, яку RLS не вирішує сама по собі.** RLS фільтрує *рядки*, не *колонки*. Якщо курʼєр має право прочитати рядок замовлення в черзі — він читає й `client_phone`, і точну адресу, ще до того як узяв замовлення. Ба більше, він читатиме їх і через рік після доставки.

Це баг B15, і він структурний.

### Рішення: черга — це VIEW без приватних даних

```sql
CREATE VIEW courier_queue AS
SELECT
  o.id, o.code, o.business_id, o.items_total, o.delivery_fee, o.total,
  o.payment_method, o.status, o.estimated_ready_at, o.ready_at,
  o.distance_km,
  -- НЕ точна адреса: тільки населений пункт і приблизна зона
  o.dest_locality,
  -- НІ телефону, НІ dest_lat/lng, НІ landmark, НІ client_name
  b.name AS business_name, b.lat AS pickup_lat, b.lng AS pickup_lng
FROM orders o
JOIN businesses b ON b.id = o.business_id
WHERE o.status = 'ready' AND o.courier_id IS NULL;
```

Курʼєр бачить у черзі достатньо, щоб вирішити «беру / не беру»: заклад, суму, спосіб оплати, відстань, населений пункт. **Точна адреса, орієнтир і телефон зʼявляються тільки після взяття.**

### Контакт видається через RPC, а не читається з таблиці

```sql
CREATE FUNCTION get_order_contact(p_order_id uuid)
RETURNS TABLE (client_name text, client_phone text,
               dest_lat numeric, dest_lng numeric, dest_landmark text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT o.client_name, o.client_phone, o.dest_lat, o.dest_lng, o.dest_landmark
  FROM orders o
  WHERE o.id = p_order_id
    AND o.courier_id = auth_courier_id()          -- саме цей курʼєр
    AND o.status IN ('courier_assigned','picked_up','on_the_way');  -- саме зараз
  -- Кожен виклик логується — хто, коли, чий контакт запитав
END $$;
```

Після `delivered` контакт закривається. Курʼєр в історії бачить код замовлення й суму, не телефон.

## Фото доставок — це персональні дані

Фото під дверима клієнта містить його адресу, іноді обличчя, іноді інтерʼєр. Це не «просто картинка».

| Вимога | Реалізація |
|---|---|
| Приватний бакет | Storage bucket `delivery-proofs`, `public = false` |
| Доступ | Signed URL із коротким TTL, видається тільки адміну й закладу-власнику замовлення |
| Курʼєр | Може завантажити фото, **не може прочитати чуже** |
| Строк зберігання | 90 днів, далі автовидалення фонової задачі |
| Шлях | `delivery-proofs/<business_id>/<order_id>.jpg` — щоб політика могла фільтрувати за префіксом |

Без TTL це накопичувальна база фотографій домівок жителів села. Баг B13.

## Облікові записи курʼєрів

Самореєстрації немає. Адмін створює обліковий запис через Edge Function із `service_role`.

**Що робити правильно:**
- пароль генерується на сервері, **показується адміну один раз** і більше ніде не зберігається у відкритому вигляді;
- у наших таблицях паролів немає взагалі — тільки в Supabase Auth (баг B17);
- `must_change_password = true` при створенні, застосунок не пускає далі до зміни;
- деактивація курʼєра (`is_active = false`) миттєво розриває сесію.

**Що зробити не можна:** зберігати згенерований пароль у таблиці, «щоб адмін міг подивитись пізніше». Це створює базу відкритих паролів.

## Демо-креденшели

У прототипі захардкожені `rd-oleh-07 / Skuter2607` і `boss-rocket / RocketBoss26`. Вони зараз лежать у публічному JS на Netlify.

**До продакшену:** видалити з коду повністю. Не «сховати за прапорцем» — видалити. Якщо потрібен демо-режим для показу, він працює на окремому seed-даних у staging-середовищі, а не на константах у бандлі. Баг B18.

## Realtime теж під RLS

Підписки Supabase Realtime **успадковують RLS** тільки якщо це явно налаштовано в публікації. Помилка «RLS на таблиці є, а через WebSocket тече все» — типова. Перевіряти окремим тестом: підписатись анонімом на `orders` і переконатись, що не приходить нічого.

## Чек-лист перед мержем міграції

- [ ] `ENABLE` + `FORCE ROW LEVEL SECURITY`
- [ ] Політики окремо на `SELECT`, `INSERT`, `UPDATE`, `DELETE` (не одна на `ALL`)
- [ ] Приватні колонки не віддаються через VIEW чи прямий `SELECT`
- [ ] Realtime-підписка перевірена анонімом
- [ ] Тест доступу для всіх 4 ролей + аноніма в тому ж PR
- [ ] `service_role`-ключ не зʼявився у фронтенд-бандлі (`grep` по `dist/`)
