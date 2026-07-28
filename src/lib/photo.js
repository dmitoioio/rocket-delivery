/**
 * Захоплення й стиснення фото підтвердження доставки.
 *
 * Стиснення обовʼязкове: оригінал із сучасного телефона — 3–5 МБ, і на 3G
 * у селі це хвилина завантаження, під час якої курʼєр стоїть під дверима.
 */

const MAX_SIDE = 1280;
const QUALITY = 0.7;

/** Скільки чекати після повернення фокуса, перш ніж вважати вибір скасованим. */
const CANCEL_GRACE_MS = 1000;

/**
 * Відкрити камеру й отримати файл.
 *
 * @returns {Promise<File|null>} null, якщо курʼєр закрив камеру
 */
export function capture() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    // Задня камера одразу, без проміжного екрана вибору
    input.capture = 'environment';
    input.style.display = 'none';

    let settled = false;
    const finish = (file) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };

    input.addEventListener('change', () => finish(input.files?.[0] || null));

    /**
     * Скасування вибору не дає події `change` у частині браузерів, тож
     * потрібен запасний вихід — інакше промис не розвʼязується ніколи
     * і кнопка «Зробити фото» просто перестає відповідати.
     *
     * ⚠️ Розвʼязуємо тим, що фактично лежить в input, а не жорстким null:
     * на повільних телефонах `change` приходить ПІСЛЯ `focus`, і поспішне
     * прибирання елемента губило б уже зняте фото. Курʼєр стоїть під
     * дверима — перезнімати він буде не вдруге, а втретє.
     */
    window.addEventListener(
      'focus',
      () => setTimeout(() => finish(input.files?.[0] || null), CANCEL_GRACE_MS),
      { once: true }
    );

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Стиснути в JPEG ~150–300 КБ.
 * @param {File} file
 * @returns {Promise<{dataUrl: string, bytes: number}>}
 */
export async function compress(file) {
  const bitmap = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);

  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
  bitmap.close?.();
  return { dataUrl, bytes: Math.round((dataUrl.length * 3) / 4) };
}

/**
 * Мініатюра з уже стисненого dataURL.
 *
 * Повне фото — сотні кілобайт; у демо воно лягає в localStorage, де на
 * весь домен ~5 МБ. Мініатюра 320 px — це десятки кілобайт, і для того,
 * що з нею роблять (упізнати пакет під дверима), цього досить.
 *
 * @param {string} dataUrl
 */
export async function thumbnail(dataUrl, side = 320, quality = 0.55) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });

  const scale = Math.min(1, side / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

function loadImage(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/**
 * У продакшені тут завантаження в приватний бакет Storage
 * (`delivery-proofs/<business_id>/<order_id>.jpg`, TTL 90 днів — B13).
 * Поки бекенду немає — повертаємо локальний шлях.
 */
export async function upload(orderId, dataUrl) {
  return { path: `local/${orderId}.jpg`, preview: dataUrl };
}
