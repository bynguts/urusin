const { ROUTES } = require('./perf-routes.cjs');

const PORT = process.env.PORT ?? '4173';
const median = { aggregationMethod: 'median-run' };

// Lighthouse bawaan = emulasi mobile (Moto G Power, 4G lambat). Semua pelanggaran berstatus "error".
module.exports = {
  ci: {
    collect: {
      startServerCommand: 'node apps/web/build',
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
