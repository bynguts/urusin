const { ROUTES } = require('./perf-routes.cjs');

const PORT = process.env.PORT ?? '4173';
const median = { aggregationMethod: 'median-run' };

// Lighthouse bawaan = emulasi mobile (Moto G Power, 4G lambat). Semua pelanggaran berstatus "error".
module.exports = {
  ci: {
    collect: {
      // Topologi produksi: build di belakang proxy yang meniru PERSIS `encode zstd gzip { match ... }`
      // di deploy/Caddyfile.urusin (kompresi saja, tanpa cache/header lain). Tanpa ini HTML SSR diukur
      // tanpa kompresi, padahal warga selalu menerimanya terkompres. Lihat scripts/lhci-serve.mjs.
      startServerCommand: 'node scripts/lhci-serve.mjs',
      startServerReadyPattern: 'Listening on',
      url: ROUTES.map((r) => `http://127.0.0.1:${PORT}${r}`),
      numberOfRuns: 3,
      settings: {
        formFactor: 'mobile',
        chromeFlags: '--no-sandbox --headless=new',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9, ...median }],
        'categories:accessibility': ['error', { minScore: 0.95, ...median }],
        'resource-summary:script:size': ['error', { maxNumericValue: 70 * 1024, ...median }],
        'total-byte-weight': ['error', { maxNumericValue: 250 * 1024, ...median }],
        'total-blocking-time': ['error', { maxNumericValue: 200, ...median }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500, ...median }],
      },
    },
  },
};
