/**
 * Мінімальний store — docs/12-technical-design.md, розділ 4.
 *
 * Три правила:
 *  1. Мутації тільки через setState. Ніякого state.queue.push() з екрана.
 *  2. Рендер — функція від стану. Екран перемальовується цілком.
 *  3. pending і outbox — частина стану, а не деталь реалізації: інтерфейс
 *     мусить показувати «відправляється» і «чекає мережу».
 */

/**
 * @typedef {object} State
 * @property {object|null} session
 * @property {'online'|'offline'|'reconnecting'} connection
 * @property {'idle'|'loading'|'ready'|'error'} status
 * @property {import('./errors.js').AppError|null} error
 * @property {Array} queue
 * @property {Array} active
 * @property {Array} history
 * @property {object|null} courier
 * @property {Array} outbox
 * @property {string[]} pending   id обʼєктів із непідтвердженою дією
 * @property {string} route
 * @property {object|null} sheet  відкрита нижня шторка
 */

/** @type {State} */
const initial = {
  session: null,
  connection: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online',
  status: 'idle',
  error: null,
  queue: [],
  active: [],
  history: [],
  courier: null,
  admin: null,
  outbox: [],
  pending: [],
  route: '',
  sheet: null,
};

let state = { ...initial };
const listeners = new Set();

export function getState() {
  return state;
}

/**
 * @param {Partial<State>|((s: State) => Partial<State>)} patch
 */
export function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  for (const fn of listeners) fn(state);
}

/**
 * @param {(s: State) => void} fn
 * @returns {() => void} відписка
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetState() {
  state = { ...initial };
  for (const fn of listeners) fn(state);
}

/** Позначити обʼєкт як такий, що має непідтверджену дію. */
export function markPending(id) {
  if (state.pending.includes(id)) return;
  setState({ pending: [...state.pending, id] });
}

export function clearPending(id) {
  setState({ pending: state.pending.filter((x) => x !== id) });
}

export function isPending(id) {
  return state.pending.includes(id);
}
