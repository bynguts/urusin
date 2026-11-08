import { createHash } from 'node:crypto';
import {
  createLocalJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JSONWebKeySet,
  type JWSHeaderParameters,
  type FlattenedJWSInput,
} from 'jose';
import type { HttpFetch } from './mailer.js';
import { safeEqual } from './token.js';

/** Endpoint Google OpenID Connect (dari https://accounts.google.com/.well-known/openid-configuration). */
export const GOOGLE_ENDPOINTS = Object.freeze({
  authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  jwks: 'https://www.googleapis.com/oauth2/v3/certs',
});

/** Host yang dihubungi server untuk Google (masuk ke allowlist egress). */
export const GOOGLE_EGRESS_HOSTS: readonly string[] = Object.freeze([
  'oauth2.googleapis.com',
  'www.googleapis.com',
  'accounts.google.com',
]);

export const GOOGLE_ISSUERS: readonly string[] = Object.freeze([
  'https://accounts.google.com',
  'accounts.google.com',
]);

export type GoogleOidcOptions = {
  clientId: string;
  clientSecret: string;
  /** Persis `${origin}/auth/google/callback` (didaftarkan di Google Cloud). */
  redirectUri: string;
  fetch: HttpFetch;
  endpoints?: Partial<Record<keyof typeof GOOGLE_ENDPOINTS, string>>;
  /** Issuer yang diterima (default Google); diganti hanya oleh Google palsu di tes. */
  issuers?: readonly string[];
  now?: () => number;
  /** Umur cache JWKS (default 1 jam). */
  jwksTtlMs?: number;
};

export type GoogleClaims = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
};

export class GoogleError extends Error {
  constructor(readonly alasan: string) {
    super(`login Google gagal: ${alasan}`);
    this.name = 'GoogleError';
  }
}

export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/**
 * Klien OIDC Google minimal: Authorization Code + PKCE (S256) + state + nonce. Verifikasi ID token
 * (tanda tangan via JWKS, iss, aud, exp, nonce) memakai `jose`; semua HTTP lewat `fetch` yang disuntikkan.
 */
export class GoogleOidc {
  private readonly ep: Record<keyof typeof GOOGLE_ENDPOINTS, string>;
  private readonly now: () => number;
  private jwksCache: { set: ReturnType<typeof createLocalJWKSet>; at: number } | undefined;

  constructor(private readonly opts: GoogleOidcOptions) {
    this.ep = { ...GOOGLE_ENDPOINTS, ...opts.endpoints };
    this.now = opts.now ?? Date.now;
  }

  authorizationUrl(p: { state: string; nonce: string; codeVerifier: string }): string {
    const u = new URL(this.ep.authorization);
    u.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.opts.clientId,
      redirect_uri: this.opts.redirectUri,
      scope: 'openid email profile',
      state: p.state,
      nonce: p.nonce,
      code_challenge: pkceChallenge(p.codeVerifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return u.href;
  }

  /** Tukar authorization code menjadi ID token (dengan PKCE verifier dan client secret). */
  async exchangeCode(code: string, codeVerifier: string): Promise<string> {
    let res: Response;
    try {
      res = await this.opts.fetch(this.ep.token, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: this.opts.clientId,
          client_secret: this.opts.clientSecret,
          redirect_uri: this.opts.redirectUri,
          code_verifier: codeVerifier,
        }).toString(),
      });
    } catch {
      throw new GoogleError('token endpoint tidak terjangkau');
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new GoogleError(`token endpoint HTTP ${res.status}`);
    }
    const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
    if (typeof body?.id_token !== 'string') throw new GoogleError('respons token tanpa id_token');
    return body.id_token;
  }

  private async jwks(force: boolean): Promise<ReturnType<typeof createLocalJWKSet>> {
    const ttl = this.opts.jwksTtlMs ?? 3_600_000;
    const c = this.jwksCache;
    if (c && !force && this.now() - c.at < ttl) return c.set;
    let res: Response;
    try {
      res = await this.opts.fetch(this.ep.jwks, { headers: { accept: 'application/json' } });
    } catch {
      throw new GoogleError('JWKS tidak terjangkau');
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new GoogleError(`JWKS HTTP ${res.status}`);
    }
    const json = (await res.json().catch(() => null)) as JSONWebKeySet | null;
    if (!json || !Array.isArray(json.keys)) throw new GoogleError('JWKS tidak valid');
    const set = createLocalJWKSet(json);
    this.jwksCache = { set, at: this.now() };
    return set;
  }

  /** Verifikasi ID token. Melempar GoogleError bila tanda tangan/klaim tidak sah. */
  async verifyIdToken(idToken: string, expectedNonce: string): Promise<GoogleClaims> {
    const getKey = async (header: JWSHeaderParameters, token: FlattenedJWSInput) => {
      const set = await this.jwks(false);
      try {
        return await set(header, token);
      } catch (e) {
        // Rotasi kunci Google: kid belum ada di cache → ambil ulang sekali (paling sering 1x per menit).
        const c = this.jwksCache;
        if (e instanceof joseErrors.JWKSNoMatchingKey && c && this.now() - c.at > 60_000) {
          return (await this.jwks(true))(header, token);
        }
        throw e;
      }
    };
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(idToken, getKey, {
        issuer: [...(this.opts.issuers ?? GOOGLE_ISSUERS)],
        audience: this.opts.clientId,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'sub', 'nonce'],
        currentDate: new Date(this.now()),
        clockTolerance: 30,
      }));
    } catch (e) {
      if (e instanceof GoogleError) throw e;
      throw new GoogleError(`ID token ditolak (${(e as { code?: string }).code ?? 'tidak sah'})`);
    }
    if (typeof payload.nonce !== 'string' || !safeEqual(payload.nonce, expectedNonce))
      throw new GoogleError('nonce tidak cocok');
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new GoogleError('sub kosong');
    if (typeof payload.email !== 'string') throw new GoogleError('email tidak ada (scope email?)');
    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      ...(typeof payload.name === 'string' && payload.name ? { name: payload.name } : {}),
    };
  }
}
