import { defineConfig } from '@playwright/test';

/**
 * E2E Browser Pendamping: layanan pendamping (hasil build) + fixtures lokal. Port sengaja berbeda dari
 * port dev web/fixtures (3000/4320) agar bisa berjalan paralel di turbo. Tidak pernah menyentuh situs asli.
 */
export const FIXTURES_PORT = Number(process.env.PENDAMPING_E2E_FIXTURES_PORT ?? 4331);
export const PENDAMPING_PORT = Number(process.env.PENDAMPING_E2E_PORT ?? 4332);
export const FIXTURE_ORIGIN = `http://127.0.0.1:${FIXTURES_PORT}`;
export const PENDAMPING_ORIGIN = `http://127.0.0.1:${PENDAMPING_PORT}`;
export const INTERNAL_TOKEN = 'e2e-token-bukan-rahasia-0123456789abcdef';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node ../fixtures/dist/server.js',
      url: `${FIXTURE_ORIGIN}/health`,
      reuseExistingServer: false,
      env: { FIXTURES_PROFILE: 'public', FIXTURES_PORT: String(FIXTURES_PORT) },
    },
    {
      command: 'node dist/main.js',
      url: `${PENDAMPING_ORIGIN}/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(PENDAMPING_PORT),
        HOST: '127.0.0.1',
        PENDAMPING_DEV_PAGE: '1',
        PENDAMPING_INTERNAL_TOKEN: INTERNAL_TOKEN,
        PENDAMPING_ALLOWED_ORIGINS: PENDAMPING_ORIGIN,
        PENDAMPING_PUBLIC_WS_URL: `ws://127.0.0.1:${PENDAMPING_PORT}/ws`,
        PENDAMPING_FIXTURE_ORIGINS: FIXTURE_ORIGIN,
        PENDAMPING_ORIGIN_OVERRIDES: `https://telunjuksakti.wonogirikab.go.id=${FIXTURE_ORIGIN}`,
        PENDAMPING_MAX_SESSIONS: '1',
        // Sandbox Chromium AKTIF seperti produksi, juga di CI: job E2E melonggarkan pembatasan userns AppArmor
        // runner (ci.yml), dan boot di Linux memeriksa sandbox benar-benar aktif (isolasi.ts, gagal-tertutup).
        // CI terhadap fixture saja; situs nyata selalu headed (PENDAMPING_E2E_HEADED=1 untuk uji lokal).
        ...(process.env.PENDAMPING_E2E_HEADED === '1' ? {} : { PENDAMPING_HEADLESS: '1' }),
      },
    },
  ],
});
