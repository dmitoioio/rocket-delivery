/** Форматери. Усі дати — Europe/Kyiv, усі суми — гривні. */

const TZ = 'Europe/Kyiv';

/**
 * Екранування перед вставкою в HTML.
 * Використовується для КОЖНОГО значення, що прийшло з бази: імена клієнтів,
 * орієнтири й коментарі вводять люди, і вони потрапляють на екран курʼєра.
 * @param {unknown} value
 * @returns {string}
 */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** @param {number} amount @returns {string} */
export function money(amount) {
  const n = Number(amount) || 0;
  const rounded = Math.round(n * 100) / 100;
  const str = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  return `${str} ₴`;
}

/** @param {number} km */
export function distance(km) {
  const n = Number(km) || 0;
  return n < 1 ? `${Math.round(n * 1000)} м` : `${n.toFixed(1).replace('.', ',')} км`;
}

/** @param {string|Date} value */
export function time(value) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('uk-UA', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** @param {string|Date} value */
export function dateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('uk-UA', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Зворотний відлік у форматі MM:SS. Повертає null, коли час минув.
 * @param {string|Date} target
 * @param {number} [now]
 */
export function countdown(target, now = Date.now()) {
  if (!target) return null;
  const diff = new Date(target).getTime() - now;
  if (diff <= 0) return null;
  const total = Math.floor(diff / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * Українське відмінювання: 1 доставка, 2 доставки, 5 доставок.
 * @param {number} n
 * @param {[string, string, string]} forms
 */
export function plural(n, forms) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

/** @param {number} n */
export function deliveries(n) {
  return `${n} ${plural(n, ['доставка', 'доставки', 'доставок'])}`;
}

/** Скільки часу минуло — для «висить 14 хв» у черзі та адмінці. */
export function elapsed(since, now = Date.now()) {
  const min = Math.floor((now - new Date(since).getTime()) / 60000);
  if (min < 1) return 'щойно';
  if (min < 60) return `${min} хв`;
  const h = Math.floor(min / 60);
  return `${h} ${plural(h, ['год', 'год', 'год'])} ${min % 60} хв`;
}
