import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingEnv } from '../src/app/main.js';

test('missingEnv повідомляє про відсутні обовʼязкові змінні', () => {
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.VITE_SUPABASE_ANON_KEY;

  assert.deepEqual(missingEnv(), ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);
});

test('missingEnv порожній, коли все задано', () => {
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
  process.env.VITE_SUPABASE_ANON_KEY = 'anon';

  assert.deepEqual(missingEnv(), []);
});
