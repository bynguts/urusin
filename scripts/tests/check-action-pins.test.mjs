import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findUnpinned } from '../check-action-pins.mjs';

const sha = '3d3c42e5aac5ba805825da76410c181273ba90b1';

describe('findUnpinned', () => {
  it('meloloskan action yang dipin SHA dengan komentar versi', () => {
    assert.deepEqual(findUnpinned(`      - uses: actions/checkout@${sha} # v7.0.1`), []);
  });
  it('menolak tag, cabang, dan SHA pendek', () => {
    const text = [
      '      - uses: actions/checkout@v7',
      '      - uses: actions/setup-node@main',
      '    uses: org/repo/.github/workflows/x.yml@3d3c42e',
    ].join('\n');
    assert.equal(findUnpinned(text).length, 3);
  });
  it('mengabaikan action lokal dan menuntut digest untuk docker://', () => {
    assert.deepEqual(findUnpinned('uses: ./.github/actions/x'), []);
    assert.equal(findUnpinned('uses: docker://alpine:3').length, 1);
  });
});
