/**
 * Rocket Delivery — точка входу.
 *
 * Каркас. Реальна логіка переноситься з prototype/rocket-delivery-app.html
 * на етапі 5 дорожньої карти (docs/10-roadmap.md).
 */

const REQUIRED_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

/**
 * Падати голосно й одразу, а не через три екрани з незрозумілою помилкою.
 * @returns {string[]} перелік відсутніх змінних
 */
export function missingEnv() {
  return REQUIRED_ENV.filter((k) => !process.env[k]);
}

function boot() {
  const root = document.getElementById('app');
  if (!root) return;

  const missing = missingEnv();
  if (missing.length) {
    root.innerHTML =
      `<pre>Не задані змінні середовища: ${missing.join(', ')}\n` +
      `Скопіюй .env.example у .env і заповни.</pre>`;
    return;
  }

  root.innerHTML = '<pre>Каркас Rocket Delivery. Див. docs/10-roadmap.md, етап 5.</pre>';
}

if (typeof document !== 'undefined') {
  boot();
}
