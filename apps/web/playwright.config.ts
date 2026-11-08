import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// E2E akun terhadap web app hasil build (node build). Email tidak dikirim: mailer dev menulis tautan ke
// outbox JSONL yang dibaca tes. DB di folder sementara; tiap tes memakai email unik sehingga DB lama aman.
const PORT = Number(process.env.WEB_E2E_PORT ?? 4390);
export const ORIGIN = `http://localhost:${PORT}`;
export const E2E_DIR = join(tmpdir(), 'urusin-web-e2e');
export const OUTBOX = join(E2E_DIR, 'outbox.jsonl');

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
      URUSIN_DB_PATH: join(E2E_DIR, 'urusin.sqlite'),
      AUTH_EMAIL_DEV: '1',
      AUTH_EMAIL_OUTBOX: OUTBOX,
    },
  },
});
