import { error, redirect } from '@sveltejs/kit';
import { OIDC_FIXTURE_PATH } from '#lib/server/oidc-fixture.js';
import { getRuntime, publicOrigin } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * DEV-ONLY: layar persetujuan IdP OIDC tiruan untuk e2e #48 (aktif hanya dengan URUSIN_OIDC_FIXTURE=1, yang
 * ditolak di produksi; selain itu 404). Meniru Google: tanpa PKCE S256 → 400; kode hanya bisa ditukar dengan
 * verifier yang cocok; skenario `nonce-salah` menerbitkan ID token dengan nonce lain.
 */
async function fixture() {
  const rt = await getRuntime();
  if (!rt.oidcFixture) error(404, 'Tidak ditemukan');
  return rt.oidcFixture.google;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const GET: RequestHandler = async ({ url }) => {
  await fixture();
  if (url.searchParams.get('code_challenge_method') !== 'S256' || !url.searchParams.get('code_challenge'))
    return new Response('PKCE S256 wajib', { status: 400, headers: { 'content-type': 'text/plain' } });
  const html = `<!doctype html><meta charset="utf-8"><title>IdP tiruan</title>
<h1>IdP OIDC tiruan (e2e)</h1>
<form method="POST">
<input type="hidden" name="url" value="${esc(url.href)}">
<label>sub <input name="sub" value="sub-uji"></label>
<label>email <input name="email" value=""></label>
<label>nama <input name="nama" value="Warga Google"></label>
<label>email_verified <select name="email_verified"><option>true</option><option>false</option></select></label>
<label>skenario <select name="skenario"><option>normal</option><option>nonce-salah</option></select></label>
<button type="submit">Setujui</button>
</form>`;
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const google = await fixture();
  const f = await request.formData();
  const s = (k: string) => (typeof f.get(k) === 'string' ? (f.get(k) as string) : '');
  const auth = new URL(s('url'));
  if (auth.origin !== publicOrigin() || auth.pathname !== OIDC_FIXTURE_PATH)
    error(400, 'URL otorisasi salah');
  const redirectUri = new URL(auth.searchParams.get('redirect_uri') ?? '');
  if (redirectUri.pathname !== '/auth/google/callback') error(400, 'redirect_uri salah');
  let hasil;
  try {
    hasil = google.consent(auth.href, {
      sub: s('sub'),
      email: s('email'),
      email_verified: s('email_verified') === 'true',
      name: s('nama'),
      ...(s('skenario') === 'nonce-salah' ? { nonce: 'nonce-salah' } : {}),
    });
  } catch {
    error(400, 'Permintaan otorisasi tidak sah');
  }
  redirectUri.searchParams.set('code', hasil.code);
  redirectUri.searchParams.set('state', hasil.state);
  redirect(303, redirectUri.href, { external: [redirectUri.origin] });
};
