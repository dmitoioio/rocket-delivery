/**
 * Створення облікового запису курʼєра.
 *
 * ⚠️ ЄДИНЕ МІСЦЕ В ПРОЄКТІ, ДЕ ВИКОРИСТОВУЄТЬСЯ `service_role`.
 * Цей ключ обходить усі політики доступу — у фронтенді він не зʼявляється
 * ніколи й ні за яких умов (docs/05-roles-auth-rls.md).
 *
 * Навіщо функція, а не форма в адмінці: створення користувача в Supabase
 * Auth вимагає адмінських прав. Дати їх браузеру означало б дати
 * браузеру всю базу.
 *
 * Пароль генерує сервер і повертає РІВНО ОДИН РАЗ. Ніде не зберігається:
 * ні в наших таблицях, ні в логах (B17). Загубив — адмін скидає новий.
 *
 * Деплой: supabase functions deploy create-courier
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

interface Body {
  fullName?: string;
  phone?: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // ── Хто просить ──────────────────────────────────────────────────────────
  // Перевіряємо ТОКЕН ТОГО, ХТО ВИКЛИКАЄ, окремим клієнтом на anon-ключі.
  // Якби ми перевіряли роль сервісним клієнтом, перевірка була б
  // беззмістовна: він проходить будь-що.
  const authHeader = req.headers.get('Authorization') ?? '';
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: me } = await caller.auth.getUser();
  if (me?.user?.app_metadata?.role !== 'admin') {
    return json({ error: 'Тільки адміністратор може створювати курʼєрів' }, 403);
  }

  // ── Дані ─────────────────────────────────────────────────────────────────
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Некоректний запит' }, 400);
  }

  const fullName = (body.fullName ?? '').trim();
  if (fullName.length < 3) return json({ error: 'Вкажи повне імʼя курʼєра' }, 400);

  const admin = createClient(url, serviceKey, { db: { schema: 'delivery' } });

  const { data: login, error: loginErr } = await admin.rpc('build_login', {
    p_full_name: fullName,
  });
  if (loginErr) return json({ error: loginErr.message }, 500);

  const { data: password, error: pwdErr } = await admin.rpc('generate_password');
  if (pwdErr) return json({ error: pwdErr.message }, 500);

  // Пошта синтетична: Supabase Auth вимагає її, курʼєру вона не потрібна
  const email = `${login}@rocket.local`;

  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: 'courier' },
  });
  if (authErr) return json({ error: authErr.message }, 400);

  const { data: courier, error: rowErr } = await admin
    .from('couriers')
    .insert({
      auth_user_id: created.user.id,
      full_name: fullName,
      phone: body.phone ?? null,
      must_change_password: true,
    })
    .select()
    .single();

  if (rowErr) {
    // Інакше в Auth лишиться користувач без курʼєра — увійти зможе,
    // працювати ні, і причина буде незрозуміла
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: rowErr.message }, 500);
  }

  // Пароль тут і тільки тут. Далі його не існує ніде
  return json({ id: courier.id, fullName, login, password });
});
