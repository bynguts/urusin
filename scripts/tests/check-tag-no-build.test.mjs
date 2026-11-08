import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findTagBuilds } from '../check-tag-no-build.mjs';

const wf = (job) => `name: x\non: push\njobs:\n${job}`;

describe('findTagBuilds', () => {
  it('job tag dengan build-push-action gagal', () => {
    const t = wf(
      `  promote:\n    if: \${{ github.ref_type == 'tag' }}\n    steps:\n      - uses: docker/build-push-action@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v6\n`,
    );
    assert.deepEqual(
      findTagBuilds(t).map((v) => v.job),
      ['promote'],
    );
  });
  it('job tag dengan docker buildx build di run gagal', () => {
    const t = wf(
      `  promote:\n    if: github.ref_type == 'tag'\n    steps:\n      - run: docker buildx build .\n`,
    );
    assert.equal(findTagBuilds(t).length, 1);
  });
  it('build pada job non-tag lolos, imagetools create pada job tag lolos', () => {
    const t = wf(
      `  images:\n    if: github.ref_type != 'tag'\n    steps:\n      - uses: docker/build-push-action@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n` +
        `  promote:\n    if: github.ref_type == 'tag'\n    steps:\n      - run: docker buildx imagetools create -t a b\n`,
    );
    assert.deepEqual(findTagBuilds(t), []);
  });
  it('komentar yang menyebut build tidak dihitung', () => {
    const t = wf(
      `  promote:\n    if: github.ref_type == 'tag'\n    steps:\n      # tidak docker build ulang\n      - run: echo ok\n`,
    );
    assert.deepEqual(findTagBuilds(t), []);
  });
  it('release.yml nyata lolos', () => {
    const text = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
    assert.deepEqual(findTagBuilds(text), []);
  });
});
