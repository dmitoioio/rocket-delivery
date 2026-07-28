/**
 * Штамп збірки — щоб було видно, чи оновилось те, що відкрито в браузері.
 *
 * Питання «чи доїхав деплой» інакше не має відповіді: сторінка виглядає
 * так само, а Service Worker і кеш браузера цілком можуть віддавати
 * вчорашній бандл. Номер збірки на екрані відповідає за секунду.
 *
 * Значення підставляє esbuild через `define` (scripts/config.mjs).
 * Запасні варіанти потрібні для тестів і dev-режиму, де `define`
 * не застосовується — інакше модуль не імпортувався б у node.
 */

/* global __BUILD_NUMBER__, __BUILD_SHA__, __BUILD_AT__ */

export const buildNumber = typeof __BUILD_NUMBER__ === 'string' ? __BUILD_NUMBER__ : 'dev';
export const buildSha = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'local';
export const buildAt = typeof __BUILD_AT__ === 'string' ? __BUILD_AT__ : '';

/** Дата збірки, а не поточна: питання саме про те, коли зібрано. */
function stampDate() {
  if (!buildAt) return '';
  const d = new Date(buildAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Один рядок: «збірка 34 · 7e655e8 · 28.07, 21:15». */
export const versionLabel = [`збірка ${buildNumber}`, buildSha, stampDate()]
  .filter(Boolean)
  .join(' · ');
