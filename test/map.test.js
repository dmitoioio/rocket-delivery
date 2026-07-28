/**
 * Тести проєкції координат.
 *
 * Схематична карта без тайлів має право бути схематичною, але не має
 * права брехати: якщо клієнт на північ від закладу — пін мусить бути
 * вище, а не там, де його поставив дизайнер.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../src/features/shared/map.js';

const OLYKA = { lat: 50.7192, lng: 25.8125 };

test('усі точки лишаються в межах контейнера', () => {
  const pts = project([OLYKA, { lat: 50.7592, lng: 25.9125 }, { lat: 50.6892, lng: 25.7525 }]);

  for (const p of pts) {
    assert.ok(p.x >= 0 && p.x <= 100, `x у межах: ${p.x}`);
    assert.ok(p.y >= 0 && p.y <= 100, `y у межах: ${p.y}`);
  }
});

test('північ угорі: більша широта дає меншу координату Y', () => {
  const [south, north] = project([OLYKA, { lat: OLYKA.lat + 0.05, lng: OLYKA.lng }]);
  assert.ok(north.y < south.y, `${north.y} має бути вище за ${south.y}`);
});

test('схід праворуч: більша довгота дає більшу координату X', () => {
  const [west, east] = project([OLYKA, { lat: OLYKA.lat, lng: OLYKA.lng + 0.05 }]);
  assert.ok(east.x > west.x);
});

test('рух строго на північ не зміщує точку по горизонталі', () => {
  const [a, b] = project([OLYKA, { lat: OLYKA.lat + 0.05, lng: OLYKA.lng }]);
  assert.ok(Math.abs(a.x - b.x) < 0.01, 'напрямок не має «завалюватись» набік');
});

/**
 * Головне, заради чого проєкція існує. Раніше пін стояв на `left: 14%`
 * незалежно від даних, тож сусідня вулиця й село за 12 км виглядали
 * однаково — карта показувала той самий малюнок для будь-чого.
 */
test('пропорції відстаней зберігаються: дальша точка проєктується далі', () => {
  const near = { lat: OLYKA.lat + 0.01, lng: OLYKA.lng };
  const far = { lat: OLYKA.lat + 0.05, lng: OLYKA.lng };
  const [base, n, f] = project([OLYKA, near, far]);

  const dNear = Math.hypot(n.x - base.x, n.y - base.y);
  const dFar = Math.hypot(f.x - base.x, f.y - base.y);

  assert.ok(dFar > dNear * 4, `${dFar} має бути приблизно вп'ятеро більше за ${dNear}`);
});

test('поправка на широту: градус довготи коротший за градус широти', () => {
  // Однаковий приріст у градусах, але на 50-й паралелі це різні відстані
  const [o, byLat, byLng] = project([
    OLYKA,
    { lat: OLYKA.lat + 0.05, lng: OLYKA.lng },
    { lat: OLYKA.lat, lng: OLYKA.lng + 0.05 },
  ]);

  const dLat = Math.abs(byLat.y - o.y);
  const dLng = Math.abs(byLng.x - o.x);
  // cos(50.7°) ≈ 0.633 — зміщення по довготі має бути помітно меншим
  assert.ok(dLng < dLat, `${dLng} має бути менше за ${dLat}`);
});

test('дві однакові точки не розлітаються по кутах', () => {
  const [a, b] = project([OLYKA, { ...OLYKA }]);
  assert.ok(Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01);
  assert.ok(a.x > 20 && a.x < 80, 'збіжні точки лишаються ближче до центру');
});

test('точки без координат не ламають проєкцію решти', () => {
  const pts = project([OLYKA, null, undefined, { lat: NaN, lng: 25.9 }]);
  assert.equal(pts.length, 4);
  assert.ok(pts[0]);
  assert.equal(pts[1], null);
  assert.equal(pts[2], null);
  assert.equal(pts[3], null);
});

test('порожній набір не кидає виняток', () => {
  assert.deepEqual(project([]), []);
  assert.deepEqual(project([null, undefined]), []);
});
