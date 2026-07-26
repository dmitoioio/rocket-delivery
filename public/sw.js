/**
 * Service worker.
 *
 * Кешуємо ТІЛЬКИ оболонку застосунку. Дані — ніколи: несвіжий статус
 * замовлення гірший за відсутність даних. Курʼєр, який бачить закешовану
 * чергу пʼятихвилинної давності, поїде за замовленням, якого вже немає.
 */

const CACHE = 'rocket-shell-v1';
const SHELL = ['/', '/index.html', '/app.js', '/app.css', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Запити до API не кешуються за жодних умов
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) return;

  // Оболонка: спершу мережа, кеш як фолбек — щоб не залипнути на старій версії
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('/index.html')))
  );
});
