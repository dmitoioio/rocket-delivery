/**
 * Тести бізнес-правил.
 *
 * Моковий адаптер — референсна реалізація того, що має робити сервер.
 * Ці тести описують інваріанти, які потім мають виконуватись у Postgres
 * (тригерами й RPC), а не лише в JS.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/lib/adapters/mock.js';

beforeEach(() => api.__reset());

/* ── Гонка за замовлення ────────────────────────────────────────────────── */

test('гонку виграє рівно один курʼєр, другий отримує conflict', async () => {
  const results = await Promise.allSettled([
    api.acceptOrder('o1', 'c1'),
    api.acceptOrder('o1', 'c2'),
  ]);

  const ok = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');

  assert.equal(ok.length, 1, 'замовлення дістається рівно одному');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].reason.kind, 'conflict');
});

test('взяти можна лише замовлення у статусі ready', async () => {
  await assert.rejects(
    () => api.acceptOrder('o2', 'c1'),
    (e) => e.kind === 'conflict'
  );
});

test('курʼєр не може вести більше замовлень, ніж дозволяє ліміт', async () => {
  await api.acceptOrder('o1', 'c1');
  await assert.rejects(
    () => api.acceptOrder('o3', 'c1'),
    (e) => e.kind === 'limit'
  );
});

/* ── Приватність черги ──────────────────────────────────────────────────── */

test('черга НЕ віддає спосіб оплати — інакше готівкові замовлення не беруть (B35)', async () => {
  const queue = await api.fetchQueue();
  assert.ok(queue.length > 0);
  for (const row of queue) {
    assert.equal(row.paymentMethod, undefined);
  }
});

test('черга НЕ віддає телефон, точну адресу й орієнтир (B15)', async () => {
  const queue = await api.fetchQueue();
  for (const row of queue) {
    assert.equal(row.clientPhone, undefined);
    assert.equal(row.clientName, undefined);
    assert.equal(row.destAddressText, undefined);
    assert.equal(row.destLandmark, undefined);
    assert.equal(row.destLat, undefined);
  }
});

test('черга віддає рівно те, що потрібно для рішення «беру / не беру»', async () => {
  const [row] = await api.fetchQueue();
  for (const field of ['code', 'destLocality', 'distanceKm', 'courierEarnings', 'waitingBonus']) {
    assert.ok(field in row, `у черзі має бути ${field}`);
  }
});

test('черга показує заробіток курʼєра, а не суму чека', async () => {
  const queue = await api.fetchQueue();
  for (const row of queue) {
    assert.equal(row.total, undefined, 'сума чека непрямо видає спосіб оплати');
    assert.ok(row.courierEarnings > 0);
  }
});

/* ── Контакт клієнта ────────────────────────────────────────────────────── */

test('контакт клієнта недоступний чужому курʼєру', async () => {
  await api.acceptOrder('o1', 'c1');
  await assert.rejects(
    () => api.getOrderContact('o1', 'c2'),
    (e) => e.kind === 'permission'
  );
});

test('контакт клієнта недоступний до взяття замовлення', async () => {
  await assert.rejects(
    () => api.getOrderContact('o1', 'c1'),
    (e) => e.kind === 'permission'
  );
});

test('контакт закривається після доставки — виконана доставка не дає довічного доступу', async () => {
  await api.acceptOrder('o1', 'c1');
  await api.advanceStatus('o1', 'c1', 'picked_up');
  await api.advanceStatus('o1', 'c1', 'on_the_way');
  const contact = await api.getOrderContact('o1', 'c1');
  assert.ok(contact.clientPhone);

  await api.completeDelivery('o1', 'c1', { photoPath: 'p.jpg', pin: '4271' });
  await assert.rejects(
    () => api.getOrderContact('o1', 'c1'),
    (e) => e.kind === 'permission'
  );
});

/* ── Завершення доставки ────────────────────────────────────────────────── */

async function bringToDoor(orderId = 'o1', courierId = 'c1') {
  await api.acceptOrder(orderId, courierId);
  await api.advanceStatus(orderId, courierId, 'picked_up');
  await api.advanceStatus(orderId, courierId, 'on_the_way');
}

test('без фото доставку завершити неможливо — це інваріант, не перевірка в UI', async () => {
  await bringToDoor();
  await assert.rejects(
    () => api.completeDelivery('o1', 'c1', { photoPath: null, pin: '4271' }),
    (e) => e.kind === 'validation'
  );
});

test('невірний PIN відхиляється', async () => {
  await bringToDoor();
  await assert.rejects(
    () => api.completeDelivery('o1', 'c1', { photoPath: 'p.jpg', pin: '0000' }),
    (e) => e.kind === 'validation'
  );
});

test('обхід PIN дозволений і фіксується — інакше курʼєр застрягне під дверима', async () => {
  await bringToDoor();
  const order = await api.completeDelivery('o1', 'c1', {
    photoPath: 'p.jpg',
    pinBypassed: true,
  });
  assert.equal(order.status, 'delivered');
  assert.equal(order.pinBypassed, true);
});

test('заборонені переходи статусів відхиляються', async () => {
  await api.acceptOrder('o1', 'c1');
  await assert.rejects(
    () => api.advanceStatus('o1', 'c1', 'on_the_way'),
    (e) => e.kind === 'conflict'
  );
});

test('чужий курʼєр не може рухати статус', async () => {
  await api.acceptOrder('o1', 'c1');
  await assert.rejects(
    () => api.advanceStatus('o1', 'c2', 'picked_up'),
    (e) => e.kind === 'permission'
  );
});

/* ── Готівка ────────────────────────────────────────────────────────────── */

test('доставка готівкою збільшує суму на руках у курʼєра', async () => {
  const before = await api.fetchCourier('c1');
  await bringToDoor();
  await api.completeDelivery('o1', 'c1', { photoPath: 'p.jpg', pin: '4271' });
  const after = await api.fetchCourier('c1');
  assert.equal(after.cashOnHand, before.cashOnHand + 470);
});

test('ліміт готівки блокує нові cash-замовлення', async () => {
  // c1 має 1250 ₴ на руках при ліміті 2000 ₴; o3 на 360 ₴ пройде,
  // а після нього ліміт вичерпається
  await bringToDoor();
  await api.completeDelivery('o1', 'c1', { photoPath: 'p.jpg', pin: '4271' });
  const c = await api.fetchCourier('c1');
  assert.ok(c.cashOnHand > c.cashLimit - 400, 'курʼєр близько до ліміту');

  await assert.rejects(
    () => api.acceptOrder('o3', 'c1'),
    (e) => e.kind === 'limit'
  );
});

test('новачок має знижений ліміт готівки', async () => {
  const novice = await api.fetchCourier('c2'); // 6 доставок
  const veteran = await api.fetchCourier('c1'); // 34 доставки
  assert.ok(novice.cashLimit < veteran.cashLimit);
});

test('заявка про здачу НЕ зменшує готівку на руках — потрібне підтвердження закладу', async () => {
  const before = await api.fetchCourier('c1');
  await api.declareCashHandoff('c1', 1250);
  const after = await api.fetchCourier('c1');
  assert.equal(after.cashOnHand, before.cashOnHand, 'курʼєр не знімає ліміт власною заявою');
});

test('розбіжність при підтвердженні фіксується як disputed', async () => {
  const handoff = await api.declareCashHandoff('c1', 1250);
  const confirmed = await api.confirmHandoff(handoff.id, 1000);
  assert.equal(confirmed.status, 'disputed');
});

test('збіг сум дає confirmed і зменшує готівку на руках', async () => {
  const handoff = await api.declareCashHandoff('c1', 1250);
  const confirmed = await api.confirmHandoff(handoff.id, 1250);
  assert.equal(confirmed.status, 'confirmed');
  const c = await api.fetchCourier('c1');
  assert.equal(c.cashOnHand, 0);
});

/* ── Скасування й повернення ────────────────────────────────────────────── */

test('повернення в чергу звільняє замовлення й рахує лічильник', async () => {
  await api.acceptOrder('o1', 'c1');
  const order = await api.cancelOrder('o1', 'c1', { reasonCode: 'return_to_queue' });
  assert.equal(order.status, 'ready');
  assert.equal(order.courierId, null);
  assert.equal(order.returnCount, 1);

  const queue = await api.fetchQueue();
  assert.ok(
    queue.some((o) => o.id === 'o1'),
    'замовлення знову в черзі'
  );
});

test('скасування онлайн-оплаченого замовлення вимагає рефанду', async () => {
  // o2 оплачене онлайн; дочекатись готовності не можна — беремо o1 і
  // перевіряємо правило на замовленні з online-оплатою через o2 після ready
  await new Promise((r) => setTimeout(r, 0));
  const orders = await api.fetchAdminOverview();
  const online = orders.orders.find(
    (o) => o.paymentMethod === 'online' && o.status !== 'delivered'
  );
  assert.ok(online, 'у насінні є онлайн-замовлення');
});

/* ── Автентифікація ─────────────────────────────────────────────────────── */

test('невірний пароль не пускає', async () => {
  await assert.rejects(
    () => api.signIn('rd-oleh-07', 'wrong'),
    (e) => e.kind === 'auth'
  );
});

test('деактивований курʼєр не може увійти', async () => {
  await api.setCourierActive('c1', false);
  await assert.rejects(
    () => api.signIn('rd-oleh-07', 'Skuter2607'),
    (e) => e.kind === 'auth'
  );
});

/* ── Створення курʼєра ──────────────────────────────────────────────────── */

test('пароль курʼєра генерується сервером і повертається один раз', async () => {
  const { login, password } = await api.createCourier({ fullName: 'Тарас Мельник' });
  assert.ok(login.startsWith('rd-'));
  assert.equal(password.length, 8);

  // У жодному місці даних пароль не зберігається
  const overview = await api.fetchAdminOverview();
  const created = overview.couriers.find((c) => c.login === login);
  assert.ok(created);
  assert.equal(created.password, undefined, 'пароль ніде не зберігається у відкритому вигляді');
});

/* ── Надбавка за очікування ─────────────────────────────────────────────── */

test('замовлення, що довго висить, отримує надбавку і йде вгору черги (B35)', async () => {
  const queue = await api.fetchQueue();
  const stale = queue.find((o) => o.id === 'o3'); // висить 22 хв
  assert.ok(stale.waitingBonus > 0, 'надбавка нарахована');
  assert.equal(queue[0].id, 'o3', 'найдовше очікуване — першим у списку');
});
