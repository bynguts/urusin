import { readFileSync } from 'node:fs';
import { OFFICIAL_DOMAINS } from '@urusin/core';
import { defineConfig } from 'wxt';
import { appOrigins, fixtureOrigins, toMatchPattern } from './src/lib/origins';

// Kunci publik (SPKI DER base64) dipin di repo supaya ID ekstensi identik di semua mesin.
// Kunci privat TIDAK ada di repo (lihat README). Turunan ID: `pnpm key:id`.
const MANIFEST_KEY = readFileSync(new URL('./manifest-key.pub', import.meta.url), 'utf8').trim();

const app = appOrigins(process.env);
const fixtures = fixtureOrigins(process.env);

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Urusin',
    description: 'Urusin membantu warga mengurus layanan publik langsung di peramban warga sendiri.',
    key: MANIFEST_KEY,
    ...(process.env.GIT_SHA ? { version_name: process.env.GIT_SHA.slice(0, 7) } : {}),
    minimum_chrome_version: '120',
    // Tanpa <all_urls>, cookies, webRequest, debugger, tabs (rencana §3.5 butir 7).
    permissions: ['storage', 'scripting'],
    host_permissions: [
      ...OFFICIAL_DOMAINS.map((d) => toMatchPattern(`https://${d.host}`)),
      ...fixtures.map(toMatchPattern),
    ],
    externally_connectable: { matches: app.map(toMatchPattern) },
    action: { default_title: 'Urusin' },
  },
  vite: () => ({
    define: {
      __URUSIN_FIXTURE_ORIGINS__: JSON.stringify(fixtures),
    },
  }),
});
