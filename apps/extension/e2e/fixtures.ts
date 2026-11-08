import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as base, chromium, type BrowserContext } from '@playwright/test';

export const EXTENSION_PATH = resolve(import.meta.dirname, '../.output/chrome-mv3');
// Port debug dipakai tes untuk mematikan service worker (Target.closeTarget) di tengah eksekusi.
export const CDP_PORT = Number(process.env.E2E_CDP_PORT ?? 9333);
export const APP_ORIGIN = 'http://localhost:3000';
export const FIXTURE_ORIGIN = `http://localhost:${process.env.FIXTURES_PORT ?? 4320}`;

export const PINNED_EXTENSION_ID = /^PUBLIC_EXTENSION_ID=(.+)$/m.exec(
  readFileSync(resolve(import.meta.dirname, '../../../.env.example'), 'utf8'),
)?.[1];

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern -- sintaks fixture Playwright
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', // headless baru: mendukung ekstensi
      args: [
        `--remote-debugging-port=${CDP_PORT}`,
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    await use(worker.url().split('/')[2] ?? '');
  },
});

export { expect } from '@playwright/test';
