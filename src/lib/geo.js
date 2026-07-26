/**
 * Геолокація курʼєра — docs/07-geolocation.md, docs/12, розділ 8.
 *
 * Трекінг тільки під час активного замовлення: це і економія батареї,
 * і вимога приватності — роботодавець не бачить, де курʼєр о другій ночі.
 */

const INTERVAL_MS = 8000;
const MIN_MOVE_M = 20;

let watchId = null;
let wakeLock = null;
let lastSent = null;
let lastPos = null;
let onUpdate = null;

/** Відстань між двома точками в метрах (формула гаверсинуса). */
export function distanceM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function isSupported() {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

/**
 * Стан дозволу без показу системного запиту.
 * @returns {Promise<'granted'|'denied'|'prompt'|'unknown'>}
 */
export async function permissionState() {
  if (typeof navigator === 'undefined' || !navigator.permissions) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return 'unknown';
  }
}

/**
 * Явний запит дозволу.
 * Без дозволу курʼєр не може вийти в онлайн (B22): замовлення без
 * трекінгу — це замовлення, за яким ніхто не бачить, де їжа.
 */
export function requestPermission() {
  return new Promise((resolve) => {
    if (!isSupported()) return resolve(false);
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      () => resolve(false),
      { timeout: 10000 }
    );
  });
}

/* ── Wake Lock ──────────────────────────────────────────────────────────── */

async function acquireWakeLock() {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener?.('release', () => {
      wakeLock = null;
    });
  } catch {
    wakeLock = null; // не критично — трекінг працює, поки екран увімкнений
  }
}

async function releaseWakeLock() {
  try {
    await wakeLock?.release();
  } catch {
    /* уже звільнений */
  }
  wakeLock = null;
}

/**
 * ⚠️ Найчастіша помилка реалізації: Wake Lock узяли один раз на старті
 * доставки, курʼєр відповів на дзвінок — і lock зник назавжди.
 * Система знімає його при переході у фон, тому потрібен перезапит.
 */
function handleVisibility() {
  if (document.visibilityState === 'visible' && watchId !== null && !wakeLock) {
    acquireWakeLock();
  }
}

/* ── Трекінг ────────────────────────────────────────────────────────────── */

/**
 * @param {(pos: {lat:number,lng:number,accuracy:number,at:number}) => void} handler
 */
export async function start(handler) {
  if (watchId !== null || !isSupported()) return;
  onUpdate = handler;

  await acquireWakeLock();
  document.addEventListener('visibilitychange', handleVisibility);

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const pos = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        at: Date.now(),
      };
      lastPos = pos;

      // Не слати ту саму точку, коли курʼєр стоїть на світлофорі
      const movedEnough = !lastSent || distanceM(lastSent, pos) >= MIN_MOVE_M;
      const timeEnough = !lastSent || pos.at - lastSent.at >= INTERVAL_MS;
      if (movedEnough && timeEnough) {
        lastSent = pos;
        onUpdate?.(pos);
      }
    },
    () => {
      /* тимчасова втрата сигналу — не зупиняємо watch */
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
}

export async function stop() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  document.removeEventListener('visibilitychange', handleVisibility);
  await releaseWakeLock();
  lastSent = null;
  onUpdate = null;
}

export function isTracking() {
  return watchId !== null;
}

export function lastKnown() {
  return lastPos;
}
