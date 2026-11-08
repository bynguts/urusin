// Menjalankan harness bash deploy/tests/deploy.test.sh (docker/curl palsu) dari `pnpm test:scripts`.
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../deploy/tests/deploy.test.sh', import.meta.url));
const hasBash = spawnSync('bash', ['--version']).status === 0;

describe('deploy.sh (blue/green, rollback otomatis, provenance)', { skip: !hasBash && 'bash tidak tersedia' }, () => {
  it('lulus semua kasus harness', () => {
    const r = spawnSync('bash', [script], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});
