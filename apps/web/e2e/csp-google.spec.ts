import { expect, test } from '@playwright/test';

// Regresi prod 2026-11-12: tombol "Daftar dengan Google" diam karena CSP form-action 'self' memblokir pengalihan
// /auth/google -> accounts.google.com (Chrome menegakkan form-action pada pengalihan formulir).
test('CSP form-action mengizinkan pengalihan formulir ke Google', async ({ request }) => {
  const res = await request.get('/daftar');
  const csp = res.headers()['content-security-policy'] ?? '';
  const formAction = csp.split(';').find((d) => d.trim().startsWith('form-action')) ?? '';
  expect(formAction).toContain("'self'");
  expect(formAction).toContain('https://accounts.google.com');
});
