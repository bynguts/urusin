import { readFileSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const PINNED_EXTENSION_ID =
  /^PUBLIC_EXTENSION_ID=(.+)$/m.exec(readFileSync('../../.env.example', 'utf8'))?.[1] ?? '';

const FIXTURES_PORT = Number(process.env.FIXTURES_PORT ?? 4320);

// E2E memuat ekstensi hasil build (.output/chrome-mv3) ke Chromium persistent context dan menjalankannya
// terhadap fixture lokal. Tidak pernah menyentuh situs pemerintah asli.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1, // satu profil Chromium, satu fixture
  fullyParallel: false,
  reporter: [['list']],
  webServer: [
    {
      command: 'node ../fixtures/dist/server.js',
      url: `http://localhost:${FIXTURES_PORT}/health`,
      reuseExistingServer: false,
      env: { FIXTURES_PROFILE: 'public', FIXTURES_PORT: String(FIXTURES_PORT) },
    },
    {
      // Web app sungguhan (hasil build) untuk menguji halaman /pair asli.
      command: 'node ../web/build/index.js',
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: false,
      env: { PORT: '3000', PUBLIC_EXTENSION_ID: PINNED_EXTENSION_ID },
    },
  ],
});
