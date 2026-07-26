/**
 * Класифікація помилок — docs/12-technical-design.md, розділ 10.
 *
 * Сире повідомлення Supabase користувачу не показується НІКОЛИ.
 * Кожна помилка зводиться до одного з класів нижче.
 */

/** @typedef {'network'|'conflict'|'permission'|'validation'|'limit'|'auth'|'server'} ErrorKind */

const MESSAGES = {
  network: 'Немає звʼязку',
  conflict: 'Встиг інший',
  permission: 'Немає доступу',
  validation: 'Перевір дані',
  limit: 'Ліміт вичерпано',
  auth: 'Потрібно увійти знову',
  server: 'Щось пішло не так',
};

/** Які класи має сенс повторювати автоматично. */
const RETRYABLE = new Set(['network', 'server']);

export class AppError extends Error {
  /**
   * @param {ErrorKind} kind
   * @param {string} [message] повідомлення для користувача
   * @param {object} [meta]
   */
  constructor(kind, message, meta = {}) {
    super(message || MESSAGES[kind] || MESSAGES.server);
    this.name = 'AppError';
    this.kind = kind;
    this.meta = meta;
    this.retryable = RETRYABLE.has(kind);
  }
}

export const err = {
  network: (m) => new AppError('network', m),
  conflict: (m) => new AppError('conflict', m),
  permission: (m) => new AppError('permission', m),
  validation: (m) => new AppError('validation', m),
  limit: (m) => new AppError('limit', m),
  auth: (m) => new AppError('auth', m),
  server: (m, meta) => new AppError('server', m, meta),
};

/**
 * Зводить будь-що спіймане до AppError.
 * @param {unknown} e
 * @returns {AppError}
 */
export function toAppError(e) {
  if (e instanceof AppError) return e;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return err.network();
  }

  const code = e?.code || e?.status;
  if (code === 401 || code === 403 || code === '42501') return err.permission();
  if (code === 409) return err.conflict();
  if (typeof e?.message === 'string' && /fetch|network/i.test(e.message)) return err.network();

  return err.server(undefined, { original: e?.message });
}

/**
 * Помилки доступу мають бути голосними: за правильних RLS-політик курʼєр
 * не має їх отримувати взагалі. Якщо зʼявились — політика надто вузька
 * або хтось пробує те, чого не має.
 * @param {AppError} error
 * @param {string} context
 */
export function report(error, context) {
  if (error.kind === 'permission') {
    console.error('[RLS] Відмова в доступі:', context, error.meta);
  } else if (error.kind === 'server') {
    console.error('[server]', context, error.meta);
  }
}
