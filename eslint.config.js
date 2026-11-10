// Konfigurasi ESLint flat untuk seluruh monorepo (TS + Svelte).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

const VENDOR_SDK = {
  group: ['@anthropic-ai/*', '@anthropic-ai'],
  message: 'Gunakan @urusin/llm (SDK openai, Chat Completions). SDK vendor lain dilarang.',
};

// Egress server (review v11 B2): web berjalan di network host, jadi HTTP keluar mentah bisa menjangkau
// layanan loopback pengguna (admin Caddy :2019, dll.). Semua HTTP keluar server wajib lewat @urusin/egress.
const EGRESS_MSG = 'HTTP keluar di server wajib lewat @urusin/egress (egressFetch / sharedEgress().agent).';
// Kode yang berjalan di server, .ts maupun .js. `+page.ts`/`+layout.ts` (load universal) ikut, karena
// juga berjalan di server saat SSR; di sana pakai `fetch` dari argumen load, bukan global.
const SERVER_CODE = [
  'packages/*/src/**/*.{ts,js}',
  'apps/web/src/lib/server/**/*.{ts,js}',
  'apps/web/src/routes/**/+server.{ts,js}',
  'apps/web/src/routes/**/+page.server.{ts,js}',
  'apps/web/src/routes/**/+layout.server.{ts,js}',
  'apps/web/src/routes/**/+page.{ts,js}',
  'apps/web/src/routes/**/+layout.{ts,js}',
  'apps/web/src/hooks.server.{ts,js}',
];
const RAW_HTTP_MODULES = ['undici', 'http', 'https', 'http2', 'net', 'tls', 'child_process'].flatMap((m) =>
  m === 'undici' ? [m] : [m, `node:${m}`],
);
const EXEC_MSG = 'child_process dilarang di kode server (bisa menjalankan curl/wget melewati egress).';
// Varian dinamis dari impor yang sama: import('node:http'), require('https'), createRequire(...).
// Regex esquery tidak boleh memuat '/' atau '\': `undici/<subpath>` dicocokkan lewat kelas karakter
// (bukan huruf, '_' atau '-'), sehingga paket lain seperti `undici-types` tidak ikut.
const RAW_HTTP_RE = '/^(node:)?(https?|http2|net|tls|child_process)$|^undici($|[^a-z_-])/';
const RAW_HTTP_SYNTAX = [
  {
    selector: `ImportExpression[source.type='Literal'][source.value=${RAW_HTTP_RE}]`,
    message: EGRESS_MSG,
  },
  {
    selector: `ImportExpression[source.type!='Literal']`,
    message: `import() dinamis di kode server wajib berupa string literal (cegah lolos dari larangan impor). ${EGRESS_MSG}`,
  },
  { selector: `CallExpression[callee.name='require'] > Literal[value=${RAW_HTTP_RE}]`, message: EGRESS_MSG },
  {
    selector: `CallExpression[callee.name='createRequire'], CallExpression[callee.property.name='createRequire']`,
    message: `createRequire dilarang di kode server (require() lolos dari larangan impor). ${EGRESS_MSG}`,
  },
];

// Penyelesai nilai PII tunggal (ADR 0028, arsitek v13 #1): satu-satunya pemanggil sah adalah jalur isi
// Pendamping. Impor dari tempat lain ditolak; direktori yang diizinkan memakai blok terakhir di bawah.
const RESOLVER = {
  group: ['**/vault/resolver', '**/vault/resolver.*'],
  message: 'Penyelesai nilai PII hanya boleh dipanggil jalur isi Pendamping (src/lib/server/pendamping/**).',
};
const RESOLVER_BOLEH = ['apps/web/src/lib/server/pendamping/**', 'apps/web/src/lib/server/vault/**'];
const rawHttpImports = (extra) => [
  'error',
  {
    paths: [
      ...RAW_HTTP_MODULES.map((name) => ({
        name,
        message: name.endsWith('child_process') ? EXEC_MSG : EGRESS_MSG,
      })),
      ...['module', 'node:module'].map((name) => ({
        name,
        importNames: ['createRequire'],
        message: `createRequire dilarang di kode server. ${EGRESS_MSG}`,
      })),
    ],
    patterns: [VENDOR_SDK, { group: ['undici/*'], message: EGRESS_MSG }, ...extra],
  },
];

export default ts.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/build/',
      '**/.svelte-kit/',
      '**/.turbo/',
      '**/coverage/',
      'scripts/eval-persona/.cache/',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Gateway LLM wajib OpenAI-compatible: SDK vendor lain dilarang (rencana §3.11).
      'no-restricted-imports': ['error', { patterns: [VENDOR_SDK, RESOLVER] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: SERVER_CODE,
    ignores: ['**/*.test.{ts,js}', 'packages/egress/src/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: EGRESS_MSG },
        { name: 'WebSocket', message: EGRESS_MSG },
        { name: 'EventSource', message: EGRESS_MSG },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'globalThis', property: 'fetch', message: EGRESS_MSG },
        { object: 'global', property: 'fetch', message: EGRESS_MSG },
      ],
      'no-restricted-imports': rawHttpImports([RESOLVER]),
      'no-restricted-syntax': ['error', ...RAW_HTTP_SYNTAX],
    },
  },
  {
    // Jalur isi Pendamping dan modul vault sendiri boleh mengimpor penyelesai (aturan egress tetap).
    files: RESOLVER_BOLEH,
    ignores: ['**/*.test.{ts,js}'],
    rules: { 'no-restricted-imports': rawHttpImports([]) },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
);
