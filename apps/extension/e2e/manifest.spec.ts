import { readFileSync } from 'node:fs';
import { OFFICIAL_DOMAINS } from '@urusin/core';
import { expect, test } from '@playwright/test';

interface Manifest {
  host_permissions: string[];
  externally_connectable: { matches: string[] };
}

const manifest = JSON.parse(
  readFileSync(new URL('../.output/chrome-mv3/manifest.json', import.meta.url), 'utf8'),
) as Manifest;

const hosts = JSON.parse(
  readFileSync(new URL('../../../deploy/hosts.json', import.meta.url), 'utf8'),
) as Record<'primary' | 'fallback', { app: string; verify: string; fixtures: string }>;

const sorted = (xs: string[]) => [...xs].sort();

test('manifest memuat persis host dari deploy/hosts.json ditambah origin dev, tanpa wildcard', () => {
  const official = OFFICIAL_DOMAINS.map((d) => `https://${d.host}/*`);
  const fixtures = [
    'http://localhost:4320/*',
    'http://127.0.0.1:4320/*',
    `https://${hosts.primary.fixtures}/*`,
    `https://${hosts.fallback.fixtures}/*`,
  ];
  expect(sorted(manifest.host_permissions)).toEqual(sorted([...official, ...fixtures]));
  expect(sorted(manifest.externally_connectable.matches)).toEqual(
    sorted([`https://${hosts.primary.app}/*`, `https://${hosts.fallback.app}/*`, 'http://localhost:3000/*']),
  );
  for (const p of [...manifest.host_permissions, ...manifest.externally_connectable.matches]) {
    expect(p, p).not.toMatch(/\*\./);
    expect(p, p).not.toBe('<all_urls>');
  }
});
