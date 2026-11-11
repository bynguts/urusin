import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { acuanBenchmark, hostTenang, pilihRun, RASIO_SAH } from '../lhci-jalan.mjs';

const run = (bi, i) => ({ bi, file: `lhr-${i}.json` });

describe('acuanBenchmark', () => {
  it('kalibrasi terukur: benchmarkIndex kalibrasi (median sampel, dasar multiplier)', () => {
    assert.equal(
      acuanBenchmark({ source: 'calibrated', samples: [1123, 1176, 841], benchmarkIndex: 1123 }),
      1123,
    );
  });
  it('bawaan 4x / override / gagal ukur: tanpa acuan (semua run sah, perilaku = autorun)', () => {
    assert.equal(acuanBenchmark({ source: 'default', multiplier: 4 }), undefined);
    assert.equal(acuanBenchmark({ source: 'override', multiplier: 2 }), undefined);
    assert.equal(acuanBenchmark({ source: 'calibrated', multiplier: 4, warning: 'x' }), undefined);
    assert.equal(acuanBenchmark({}), undefined);
  });
  it('rasio sah tidak lebih longgar dari 0,85', () => {
    assert.ok(RASIO_SAH >= 0.85);
  });
});

describe('pilihRun', () => {
  it('semua sah: n run paling awal, tidak ada yang dibuang', () => {
    const rs = [1100, 1150, 1120, 1180, 1160].map(run);
    const { pakai, buang, sah } = pilihRun(rs, 5, 1000);
    assert.deepEqual(pakai, rs);
    assert.deepEqual(buang, []);
    assert.equal(sah, 5);
  });
  it('run sibuk diganti run ulang yang sah; urutan kronologis dipertahankan', () => {
    const rs = [1100, 700, 1120, 650, 1160, 1150, 1170].map(run);
    const { pakai, buang, sah } = pilihRun(rs, 5, 1000);
    assert.deepEqual(
      pakai.map((r) => r.bi),
      [1100, 1120, 1160, 1150, 1170],
    );
    assert.deepEqual(
      buang.map((r) => r.bi),
      [700, 650],
    );
    assert.equal(sah, 5);
  });
  it('lebih dari n run sah: tetap n run PALING AWAL (bukan yang terbaik)', () => {
    const rs = [1001, 1002, 1003, 1004, 1005, 1300].map(run);
    assert.deepEqual(
      pilihRun(rs, 5, 1000).pakai.map((r) => r.bi),
      [1001, 1002, 1003, 1004, 1005],
    );
  });
  it('sah kurang setelah ronde habis: diisi run sibuk dengan benchmarkIndex tertinggi, tidak pernah < n run', () => {
    const rs = [1100, 600, 900, 650, 1120, 800].map(run);
    const { pakai, buang, sah } = pilihRun(rs, 5, 1000);
    assert.equal(pakai.length, 5);
    assert.deepEqual(
      pakai.map((r) => r.bi),
      [1100, 1120, 900, 800, 650],
    );
    assert.deepEqual(
      buang.map((r) => r.bi),
      [600],
    );
    assert.equal(sah, 2);
  });
  it('tanpa batas (minBi undefined): n run paling awal', () => {
    const rs = [500, 600, 700].map(run);
    assert.deepEqual(
      pilihRun(rs, 2, undefined).pakai.map((r) => r.bi),
      [500, 600],
    );
  });
});

describe('hostTenang', () => {
  it('load 1 menit < jumlah CPU host (host tidak kelebihan beban)', () => {
    assert.equal(hostTenang(1.9, 2), true);
    assert.equal(hostTenang(2, 2), false);
    assert.equal(hostTenang(3.5, 2), false);
    assert.equal(hostTenang(0, 1), true); // Windows: os.loadavg() selalu 0
  });
});
