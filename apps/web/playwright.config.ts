import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// E2E akun (#43–#48b) terhadap web app hasil build (node build). Email tidak dikirim: mailer mode log menulis
// tautan ke outbox JSONL yang dibaca tes. DB di folder sementara (dibaca tes lewat node:sqlite); tiap tes
// memakai email dan IP unik sehingga DB lama aman.
const PORT = Number(process.env.WEB_E2E_PORT ?? 4390);
export const ORIGIN = `http://localhost:${PORT}`;
export const E2E_DIR = join(tmpdir(), 'urusin-web-e2e');
export const OUTBOX = join(E2E_DIR, 'outbox.jsonl');
export const DB_PATH = join(E2E_DIR, 'urusin.sqlite');
/** SHA commit sintetis (40 heks) untuk stempel versi M11 di e2e. */
export const E2E_GIT_SHA = '0123456789abcdef'.repeat(3).slice(0, 40);

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  // adapter-node 6 menurunkan origin dari header (default skema https), tidak dari env ORIGIN. Seperti di
  // compose.prod.yml (PROTOCOL_HEADER=x-forwarded-proto di belakang Caddy), skema dikirim lewat header;
  // tanpanya cek CSRF bawaan SvelteKit menolak form action di http://localhost.
  use: { baseURL: ORIGIN, locale: 'id-ID', extraHTTPHeaders: { 'x-forwarded-proto': 'http' } },
  webServer: {
    command: 'node build/index.js',
    url: `${ORIGIN}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      PROTOCOL_HEADER: 'x-forwarded-proto',
      URUSIN_PUBLIC_ORIGIN: ORIGIN,
      URUSIN_DB_PATH: DB_PATH,
      // Email mode log: tautan ditulis ke outbox JSONL (tidak ada email terkirim).
      URUSIN_EMAIL_MODE: 'log',
      URUSIN_EMAIL_OUTBOX: OUTBOX,
      // IdP OIDC tiruan (#48) dan Turnstile tiruan (#45, juri); keduanya ditolak server di produksi.
      URUSIN_OIDC_FIXTURE: '1',
      URUSIN_TURNSTILE_FIXTURE: '1',
      // IP klien dari header (seperti di belakang Caddy): tiap tes memakai IP sendiri untuk batas per IP.
      ADDRESS_HEADER: 'x-forwarded-for',
      XFF_DEPTH: '1',
      BODY_SIZE_LIMIT: '10M',
      // Disk mesin pengembang bisa hampir penuh; ambang volume diuji di vitest.
      URUSIN_VAULT_DISK_THRESHOLD: '100',
      // Stempel versi (M11) deterministik: sha 40 heks sintetis -> tautan commit di Pengaturan.
      GIT_SHA: E2E_GIT_SHA,
    },
  },
});
