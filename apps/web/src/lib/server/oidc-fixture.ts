import { GoogleOidc } from '@urusin/akun';
import { FakeGoogle } from '@urusin/akun/testing';

/**
 * IdP OIDC tiruan untuk e2e #48 (`URUSIN_OIDC_FIXTURE=1`; server menolak boot dengan flag ini di produksi).
 * Endpoint token + JWKS dilayani di dalam proses (FakeGoogle: memeriksa client secret, redirect_uri, PKCE S256,
 * kode sekali pakai); layar persetujuan di `/dev/oidc/authorize`. Klien OIDC yang dipakai SAMA dengan produksi
 * (GoogleOidc): hanya endpoint otorisasi dan fetch yang diganti.
 */
export const OIDC_FIXTURE_PATH = '/dev/oidc/authorize';

export type OidcFixture = { google: Promise<FakeGoogle> };

export function buatOidcFixture(
  publicOrigin: string,
  redirectUri: string,
): { fixture: OidcFixture; oidc: GoogleOidc } {
  const google = FakeGoogle.create();
  const oidc = new GoogleOidc({
    clientId: 'klien-uji.apps.googleusercontent.com',
    clientSecret: 'rahasia-klien-uji',
    redirectUri,
    fetch: async (url, init) => (await google).fetch(url, init),
    endpoints: { authorization: new URL(OIDC_FIXTURE_PATH, publicOrigin).href },
  });
  return { fixture: { google }, oidc };
}
