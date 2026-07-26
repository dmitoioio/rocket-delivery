# 04 — Модель даних

> Це проєктна схема. Реальні міграції SQL — наступний етап, тека [`supabase/migrations/`](../supabase/migrations/).
> Префікс таблиць Rocket Delivery не використовується: таблиці живуть у спільній схемі з cstllife (див. [ADR-0001](adr/0001-shared-supabase-database.md)). Перед створенням звірити назви з наявними таблицями CSTL_NEWS, щоб не було колізій.

## Перелічувані типи

```
order_status:      placed | accepted_by_business | preparing | ready |
                   courier_assigned | picked_up | on_the_way | delivered |
                   cancelled_by_client | rejected_by_business |
                   failed_delivery | returned_to_queue

payment_method:    online | cash
payment_status:    pending | paid | refund_needed | refund_processing |
                   refunded | refund_failed
courier_status:    offline | online | busy
handoff_status:    declared | confirmed | disputed | resolved
business_type:     sushi | pizza | grocery | flowers | other
```

## Таблиці

### `businesses`

Картка бізнесу. Одна на заклад.

| Поле | Тип | Нотатки |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text` | «Суші Мар» |
| `type` | `business_type` | |
| `address_text` | `text` | |
| `lat`, `lng` | `numeric(9,6)` | Точка забору замовлення |
| `phone` | `text` | |
| `is_active` | `boolean` | Тимчасове відключення без видалення |
| `working_hours` | `jsonb` | Графік по днях тижня. Без нього замовлення падають о 23:00 у заклад, що працює до 22:00 (баг B34) |
| `delivery_radius_km` | `numeric` | Hard limit. За межами доставка недоступна (баг B10) |
| `cash_reconciliation_period` | `text` | `daily` \| `weekly` \| `monthly` — **окремо на кожен бізнес**, умови різні |
| `created_at` | `timestamptz` | |

### `orders`

Центральна таблиця. Спільна з cstllife.

| Поле | Тип | Нотатки |
|---|---|---|
| `id` | `uuid` PK | |
| `code` | `text` UNIQUE | Людський код: `RD-0412`. Курʼєр читає його вголос |
| `business_id` | `uuid` FK | |
| `courier_id` | `uuid` FK NULL | NULL, поки не взяли |
| `trip_id` | `uuid` NULL | **Закласти одразу**, навіть без батч-UI (баг B29) |
| `status` | `order_status` | |
| `items` | `jsonb` | Склад замовлення. Пише тільки cstllife |
| `items_total` | `numeric(10,2)` | Сума товару |
| `delivery_fee` | `numeric(10,2)` | 50₴ — **зберігати значення на момент замовлення**, не читати з конфіга заднім числом |
| `total` | `numeric(10,2)` | `items_total + delivery_fee` |
| `payment_method` | `payment_method` | |
| `payment_status` | `payment_status` | |
| `client_name` | `text` | |
| `client_phone` | `text` | 🔒 Тільки призначеному курʼєру, тільки поки активне (баг B15) |
| `dest_address_text` | `text` | |
| `dest_lat`, `dest_lng` | `numeric(9,6)` | **Обовʼязкові.** Без них курʼєр не знайде адресу |
| `dest_landmark` | `text` | «зелені ворота, за магазином» — критично для сіл без нумерації |
| `delivery_pin` | `text` NULL | 4 цифри, які клієнт називає курʼєру. Верифікація, якої фото не дає (баг B12) |
| `proof_photo_path` | `text` NULL | Ключ у Storage. `delivered` неможливий без нього |
| `return_count` | `int` DEFAULT 0 | Скільки разів поверталось у чергу (баг B6) |
| `distance_km` | `numeric` | Розраховується сервером при створенні |
| `idempotency_key` | `text` | Захист від подвійного тапу (баг B24) |
| `placed_at` … `cancelled_at` | `timestamptz` | Мітки всіх переходів — перелік у [03](03-order-lifecycle.md) |

**Індекси:**
```sql
-- Черга курʼєрів — найгарячіший запит
CREATE INDEX ON orders (status, ready_at) WHERE courier_id IS NULL;
-- Активні замовлення курʼєра
CREATE INDEX ON orders (courier_id, status) WHERE status IN ('courier_assigned','picked_up','on_the_way');
-- Дашборд закладу
CREATE INDEX ON orders (business_id, placed_at DESC);
CREATE INDEX ON orders (trip_id) WHERE trip_id IS NOT NULL;
```

### `order_status_events` (append-only)

Журнал переходів. Без нього спори недоказові (баг B30).

| Поле | Тип |
|---|---|
| `id` | `bigserial` PK |
| `order_id` | `uuid` FK |
| `from_status`, `to_status` | `order_status` |
| `actor_id` | `uuid` — хто |
| `actor_role` | `text` |
| `created_at` | `timestamptz` |
| `meta` | `jsonb` — координати, пристрій, причина |

Тільки `INSERT`. Ні `UPDATE`, ні `DELETE` — жодній ролі, включно з адміном.

### `couriers`

| Поле | Тип | Нотатки |
|---|---|---|
| `id` | `uuid` PK | |
| `auth_user_id` | `uuid` FK → `auth.users` | Пароль зберігає Supabase Auth. **Ніде в наших таблицях паролів немає** (баг B17) |
| `full_name`, `phone` | `text` | |
| `vehicle` | `text` | `escooter` |
| `status` | `courier_status` | |
| `max_active_orders` | `int` DEFAULT 1 | Конфігурований ліміт замість жорсткого «одне» |
| `cash_on_hand` | `numeric(10,2)` | Скільки чужої готівки зараз на руках |
| `cash_limit` | `numeric(10,2)` | Досяг ліміту → не може брати нові cash-замовлення (баг B2) |
| `must_change_password` | `boolean` | Примусова зміна при першому вході |
| `is_active` | `boolean` | Звільнення без видалення історії |

### `courier_locations`

**Тільки остання позиція.** `UPSERT` по `courier_id`, а не `INSERT` кожні 5 секунд (баг B16).

| Поле | Тип |
|---|---|
| `courier_id` | `uuid` PK |
| `order_id` | `uuid` NULL — активне замовлення |
| `lat`, `lng` | `numeric(9,6)` |
| `accuracy_m` | `numeric` |
| `battery_level` | `numeric` NULL — знати, що телефон сідає, корисно |
| `updated_at` | `timestamptz` |

Живий рух на карті йде через **Realtime Broadcast**, не через записи в таблицю. Таблиця — це «остання відома точка» на випадок перезавантаження сторінки.

Розріджений трек-лог (для розборів) — окрема таблиця `courier_location_history` з партиціонуванням по місяцях і автоочисткою через 30 днів.

### `cash_handoffs`

Двостороннє підтвердження здачі готівки.

| Поле | Тип | Нотатки |
|---|---|---|
| `id` | `uuid` PK | |
| `courier_id`, `business_id` | `uuid` FK | |
| `declared_amount` | `numeric(10,2)` | Курʼєр: «здав N₴» |
| `confirmed_amount` | `numeric(10,2)` NULL | Заклад: «прийняв M₴» |
| `status` | `handoff_status` | |
| `discrepancy` | `numeric(10,2)` GENERATED | `confirmed − declared`. Зафіксований борг, а не усна суперечка |
| `order_ids` | `uuid[]` | Які замовлення покриває здача |
| `declared_at`, `confirmed_at` | `timestamptz` | |
| `auto_confirm_deadline` | `timestamptz` | Якщо заклад мовчить — що робимо? Відкрите питання Q5 (баг B4) |
| `resolved_by`, `resolution_note` | `uuid`, `text` | Хто закрив спір |

### `earnings_log`

Один рядок = один заробіток курʼєра. Пише **тільки сервер**.

| Поле | Тип | Нотатки |
|---|---|---|
| `id` | `uuid` PK | |
| `courier_id`, `order_id` | `uuid` FK | |
| `amount` | `numeric(10,2)` | Ставка **на момент доставки**, не поточна з конфіга |
| `reason` | `text` | `delivery` \| `failed_delivery_compensation` \| `bonus` \| `adjustment` |
| `payroll_id` | `uuid` NULL | Заповнюється при виплаті |
| `created_at` | `timestamptz` | |

### `payrolls`

| Поле | Тип |
|---|---|
| `id` | `uuid` PK |
| `courier_id` | `uuid` FK |
| `period_start`, `period_end` | `date` |
| `deliveries_count` | `int` |
| `gross_amount` | `numeric(10,2)` |
| `deductions` | `numeric(10,2)` — незакриті борги по готівці |
| `net_amount` | `numeric(10,2)` |
| `status` | `text` — `draft` \| `approved` \| `paid` |
| `paid_at` | `timestamptz` |

### `cancellations`

| Поле | Тип |
|---|---|
| `id` | `uuid` PK |
| `order_id` | `uuid` FK |
| `reason_code` | `text` |
| `reason_note` | `text` |
| `cancelled_by_role` | `text` |
| `cancelled_by_id` | `uuid` |
| `refund_needed` | `boolean` |
| `created_at` | `timestamptz` |

### `trips` (заготовка під батчинг)

Створити таблицю одразу, навіть якщо UI зʼявиться пізніше. Дешевше, ніж мігрувати живі дані.

| Поле | Тип |
|---|---|
| `id` | `uuid` PK |
| `courier_id` | `uuid` FK |
| `status` | `text` |
| `started_at`, `finished_at` | `timestamptz` |

## Ключові інваріанти (перевіряти тригерами, не в UI)

1. `status = 'delivered'` ⟹ `proof_photo_path IS NOT NULL`
2. `status = 'delivered'` ⟹ `courier_id IS NOT NULL`
3. `courier_id` встановлюється тільки з `ready` і тільки якщо він був `NULL`
4. Кількість активних замовлень курʼєра ≤ `couriers.max_active_orders`
5. Скасування онлайн-оплаченого замовлення ⟹ `payment_status = 'refund_needed'`
6. `total = items_total + delivery_fee`
7. Рядок в `earnings_log` створюється **тільки** тригером на `delivered`, ніколи вручну з клієнта
8. `order_status_events` не має `UPDATE`/`DELETE`-політик для жодної ролі
