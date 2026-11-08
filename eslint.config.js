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
const SERVER_CODE = [
  'packages/*/src/**/*.ts',
  'apps/web/src/lib/server/**/*.ts',
  'apps/web/src/routes/**/+server.ts',
  'apps/web/src/routes/**/+page.server.ts',
  'apps/web/src/routes/**/+layout.server.ts',
  'apps/web/src/hooks.server.ts',
];
const RAW_HTTP_MODULES = ['undici', 'http', 'https', 'http2', 'net', 'tls'].flatMap((m) =>
  m === 'undici' ? [m] : [m, `node:${m}`],
);

export default ts.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/build/',
      '**/.svelte-kit/',
      '**/.turbo/',
      '**/coverage/',
      '**/.wxt/',
      '**/.output/',
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
      'no-restricted-imports': ['error', { patterns: [VENDOR_SDK] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: SERVER_CODE,
    ignores: ['**/*.test.ts', 'packages/egress/src/**'],
    rules: {
      'no-restricted-globals': ['error', { name: 'fetch', message: EGRESS_MSG }],
      'no-restricted-properties': [
        'error',
        { object: 'globalThis', property: 'fetch', message: EGRESS_MSG },
        { object: 'global', property: 'fetch', message: EGRESS_MSG },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: RAW_HTTP_MODULES.map((name) => ({ name, message: EGRESS_MSG })),
          patterns: [VENDOR_SDK],
        },
      ],
    },
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
