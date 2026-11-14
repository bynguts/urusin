// Menjalankan harness bash deploy/tests/*.test.sh (docker/curl palsu) dari `pnpm test:scripts`.
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const harness = (name) => fileURLToPath(new URL(`../../deploy/tests/${name}`, import.meta.url));
const hasBash = spawnSync('bash', ['--version']).status === 0;

describe(
  'skrip deploy (blue/green, rollback, provenance, retensi image, pemasangan Caddy)',
  { skip: !hasBash && 'bash tidak tersedia' },
  () => {
    // compose-config dan pendamping-isolation memakai docker sungguhan; keduanya lulus (dilewati) tanpa docker.
    for (const name of [
      'deploy.test.sh',
      'image-retention.test.sh',
      'caddy-install.test.sh',
      'compose-config.test.sh',
      'pendamping-isolation.test.sh',
      'worker-id.test.sh',
    ]) {
      it(`${name}: lulus semua kasus harness`, () => {
        const r = spawnSync('bash', [harness(name)], { encoding: 'utf8' });
        assert.equal(r.status, 0, r.stdout + r.stderr);
      });
    }
  },
);
