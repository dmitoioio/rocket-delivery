/**
 * Захоплення й стиснення фото підтвердження доставки.
 *
 * Стиснення обовʼязкове: оригінал із сучасного телефона — 3–5 МБ, і на 3G
 * у селі це хвилина завантаження, під час якої курʼєр стоїть під дверима.
 */

const MAX_SIDE = 1280;
const QUALITY = 0.7;

/** Відкрити камеру й отримати файл. */
export function capture() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    // Задня камера одразу, без проміжного екрана вибору
    input.capture = 'environment';
    input.style.display = 'none';

    input.addEventListener('change', () => {
      resolve(input.files?.[0] || null);
      input.remove();
    });
    // Скасування вибору не дає події change у частині браузерів —
    // прибираємо елемент при поверненні фокуса
    window.addEventListener(
      'focus',
      () => setTimeout(() => input.isConnected && input.remove(), 500),
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
