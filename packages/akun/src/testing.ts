import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import { GOOGLE_ENDPOINTS, pkceChallenge } from './google.js';
import type { HttpFetch } from './mailer.js';
import type { Limiter, LimitRule } from './service.js';

export { MemoryMailer } from './mailer.js';

/**
 * Google palsu untuk tes: JWKS lokal (RS256), token endpoint yang memeriksa client secret, redirect_uri,
 * dan PKCE, serta penandatangan ID token. Dipasang sebagai `fetch` GoogleOidc; tidak ada jaringan sungguhan.
 */
export class FakeGoogle {
  readonly clientId = 'klien-uji.apps.googleusercontent.com';
  readonly clientSecret = 'rahasia-klien-uji';
  readonly issuer = 'https://accounts.google.com';
  readonly calls: { url: string; method: string }[] = [];
  /** Ubah untuk menguji kegagalan: 'jwks-500', 'token-500', 'token-tanpa-id'. */
  gangguan: 'jwks-500' | 'token-500' | 'token-tanpa-id' | null = null;
  private key!: { privateKey: CryptoKey; publicJwk: JWK };
  private readonly codes = new Map<
    string,
    { challenge: string; redirectUri: string; claims: Record<string, unknown> }
  >();

  static async create(): Promise<FakeGoogle> {
    const g = new FakeGoogle();
    await g.rotate();
    return g;
  }

  /** Ganti kunci penandatangan (kid baru) seperti rotasi kunci Google. */
  async rotate(): Promise<void> {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const publicJwk = {
      ...(await exportJWK(publicKey)),
      kid: `kid-${Math.random().toString(36).slice(2)}`,
      alg: 'RS256',
      use: 'sig',
    };
    this.key = { privateKey, publicJwk };
  }

  get kid(): string {
    return this.key.publicJwk.kid!;
  }

  /** Tanda tangani ID token dengan kunci saat ini (klaim default bisa ditimpa). */
  async sign(claims: Record<string, unknown>, opts: { key?: CryptoKey; kid?: string } = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ iss: this.issuer, aud: this.clientId, iat: now, exp: now + 3600, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: opts.kid ?? this.kid })
      .sign(opts.key ?? this.key.privateKey);
  }

  /**
   * "Warga menyetujui" di layar Google: baca parameter URL otorisasi (redirect_uri, nonce, PKCE challenge),
   * terbitkan authorization code yang menghasilkan ID token berisi `claims`.
   */
  consent(authorizationUrl: string, claims: Record<string, unknown>): { code: string; state: string } {
    const u = new URL(authorizationUrl);
    const q = u.searchParams;
    if (q.get('client_id') !== this.clientId) throw new Error('client_id salah');
    if (q.get('code_challenge_method') !== 'S256') throw new Error('PKCE wajib S256');
    if (!q.get('scope')?.split(' ').includes('openid')) throw new Error('scope tanpa openid');
    const code = `kode-${Math.random().toString(36).slice(2)}`;
    this.codes.set(code, {
      challenge: q.get('code_challenge')!,
      redirectUri: q.get('redirect_uri')!,
      claims: { nonce: q.get('nonce'), ...claims },
    });
    return { code, state: q.get('state')! };
  }

  readonly fetch: HttpFetch = async (input, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    this.calls.push({ url: input, method });
    if (input === GOOGLE_ENDPOINTS.jwks) {
      if (this.gangguan === 'jwks-500') return new Response('x', { status: 500 });
      return Response.json({ keys: [this.key.publicJwk] });
    }
    if (input === GOOGLE_ENDPOINTS.token && method === 'POST') {
      if (this.gangguan === 'token-500') return new Response('x', { status: 500 });
      const f = new URLSearchParams(String(init.body));
      const entry = this.codes.get(f.get('code') ?? '');
      this.codes.delete(f.get('code') ?? '');
      const salah = (error: string) => Response.json({ error }, { status: 400 });
      if (!entry) return salah('invalid_grant');
      if (f.get('client_id') !== this.clientId || f.get('client_secret') !== this.clientSecret)
        return salah('invalid_client');
      if (f.get('redirect_uri') !== entry.redirectUri) return salah('redirect_uri_mismatch');
      if (pkceChallenge(f.get('code_verifier') ?? '') !== entry.challenge) return salah('invalid_grant');
      if (this.gangguan === 'token-tanpa-id') return Response.json({ access_token: 'x' });
      return Response.json({
        id_token: await this.sign(entry.claims),
        access_token: 'x',
        token_type: 'Bearer',
      });
    }
    return new Response('tidak ditemukan', { status: 404 });
  };
}

/** Pembatas laju jendela-tetap sederhana untuk tes (web memakai RateLimiter miliknya). */
export function testLimiter(now: () => number = Date.now): (rule: LimitRule) => Limiter {
  return (rule) => {
    const hits = new Map<string, { n: number; reset: number }>();
    return {
      consume(key) {
        const t = now();
        let e = hits.get(key);
        if (!e || e.reset <= t) {
          e = { n: 0, reset: t + rule.windowMs };
          hits.set(key, e);
        }
        e.n++;
        return { ok: e.n <= rule.limit, retryAfterSec: Math.max(1, Math.ceil((e.reset - t) / 1000)) };
      },
    };
  };
}
