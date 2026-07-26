import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, money, distance, plural, deliveries, countdown } from '../src/lib/format.js';

test('esc екранує все, що може прийти від людини', () => {
  assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(esc('зелені "ворота"'), 'зелені &quot;ворота&quot;');
  assert.equal(esc(null), '');
  assert.equal(esc(0), '0');
});

test('money не показує зайвих нулів', () => {
  assert.equal(money(470), '470 ₴');
  assert.equal(money(470.5), '470.50 ₴');
  assert.equal(money(0), '0 ₴');
});

test('distance перемикається на метри під кілометром', () => {
  assert.equal(distance(7.24), '7,2 км');
  assert.equal(distance(0.4), '400 м');
});

test('plural відмінює за українськими правилами', () => {
  const forms = ['доставка', 'доставки', 'доставок'];
  assert.equal(plural(1, forms), 'доставка');
  assert.equal(plural(3, forms), 'доставки');
  assert.equal(plural(5, forms), 'доставок');
  assert.equal(plural(11, forms), 'доставок');
  assert.equal(plural(21, forms), 'доставка');
  assert.equal(plural(112, forms), 'доставок');
});

test('deliveries складає число з відмінком', () => {
  assert.equal(deliveries(7), '7 доставок');
  assert.equal(deliveries(2), '2 доставки');
});

test('countdown повертає null, коли час минув', () => {
  const now = Date.now();
  assert.equal(countdown(now - 1000, now), null);
  assert.equal(countdown(now + 65000, now), '01:05');
});
