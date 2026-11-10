import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calibratedMultiplier, median, officialMultiplier, resolveCpu, resolveMode } from '../lhci-cpu.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

describe('officialMultiplier (kalkulator resmi Lighthouse)', () => {
  it('titik acuan kalkulator: 150=1x, 800=2x, 1300=3x, 1533=4x, 2000~6x', () => {
    near(officialMultiplier(150), 1);
    near(officialMultiplier(800), 2);
    near(officialMultiplier(1300), 3);
    near(officialMultiplier(1533), 4);
    near(officialMultiplier(1766), 5);
    near(officialMultiplier(2000), 3 + 700 / 233);
  });
  it('linear di dalam tiap segmen', () => {
    near(officialMultiplier(475), 1.5);
    near(officialMultiplier(1050), 2.5);
  });
  it('< 150 atau bukan angka -> undefined (terlalu lambat / tidak valid)', () => {
    assert.equal(officialMultiplier(149.9), undefined);
    assert.equal(officialMultiplier(NaN), undefined);
    assert.equal(officialMultiplier(Infinity), undefined);
  });
});

describe('calibratedMultiplier (bulat ke atas 0,1, clamp [1, 4])', () => {
  it('host kencang tidak pernah melebihi 4x (jalur GitHub)', () => {
    assert.equal(calibratedMultiplier(1533), 4);
    assert.equal(calibratedMultiplier(2500), 4);
  });
  it('host lambat: dibulatkan ke atas, tidak pernah lebih longgar dari rumus', () => {
    assert.equal(calibratedMultiplier(1272.5), 3); // 2.945 -> 3.0
    assert.equal(calibratedMultiplier(800), 2); // tepat 2, tidak naik ke 2.1
    assert.equal(calibratedMultiplier(801), 2.1);
    assert.equal(calibratedMultiplier(600), 1.7); // 1.692 -> 1.7
  });
  it('terlalu lambat (< 150) -> 1x', () => {
    assert.equal(calibratedMultiplier(100), 1);
  });
});

describe('median', () => {
  it('ganjil, genap, tidak mengubah input', () => {
    const xs = [3, 1, 2];
    assert.equal(median(xs), 2);
    assert.deepEqual(xs, [3, 1, 2]);
    assert.equal(median([4, 1, 3, 2]), 2.5);
  });
});

describe('resolveMode', () => {
  it('GitHub-hosted dan lokal: bawaan 4x', () => {
    assert.deepEqual(resolveMode({ RUNNER_ENVIRONMENT: 'github-hosted', CI: 'true' }), { mode: 'default' });
    assert.deepEqual(resolveMode({}), { mode: 'default' });
    assert.deepEqual(resolveMode({ CI: 'false' }), { mode: 'default' });
  });
  it('CI tanpa RUNNER_ENVIRONMENT (kontainer ci-docker pw) atau self-hosted: kalibrasi', () => {
    assert.deepEqual(resolveMode({ CI: 'true' }), { mode: 'calibrate' });
    assert.deepEqual(resolveMode({ CI: 'true', RUNNER_ENVIRONMENT: 'self-hosted' }), { mode: 'calibrate' });
  });
  it('override LHCI_CPU_SLOWDOWN: angka [1, 4] atau auto, menang atas runner', () => {
    assert.deepEqual(resolveMode({ LHCI_CPU_SLOWDOWN: '2.5', RUNNER_ENVIRONMENT: 'github-hosted' }), {
      mode: 'override',
      multiplier: 2.5,
    });
    assert.deepEqual(resolveMode({ LHCI_CPU_SLOWDOWN: ' 4 ' }), { mode: 'override', multiplier: 4 });
    assert.deepEqual(resolveMode({ LHCI_CPU_SLOWDOWN: 'auto' }), { mode: 'calibrate' });
    assert.deepEqual(resolveMode({ LHCI_CPU_SLOWDOWN: '' }), { mode: 'default' });
  });
  it('override tidak valid ditolak', () => {
    for (const v of ['0.5', '5', '-1', 'abc', '1e1', '0x2', 'NaN', 'Infinity', '2,5']) {
      assert.throws(() => resolveMode({ LHCI_CPU_SLOWDOWN: v }), /LHCI_CPU_SLOWDOWN/, v);
    }
  });
});

describe('resolveCpu', () => {
  const never = () => assert.fail('tidak boleh mengukur');

  it('default/override tidak mengukur', async () => {
    assert.deepEqual(await resolveCpu({ mode: 'default' }, never), { source: 'default', multiplier: 4 });
    assert.deepEqual(await resolveCpu({ mode: 'override', multiplier: 1.5 }, never), {
      source: 'override',
      multiplier: 1.5,
    });
  });
  it('kalibrasi: median sampel valid -> rumus resmi', async () => {
    const r = await resolveCpu({ mode: 'calibrate' }, async () => [1606, 1272.5, NaN, 1147]);
    assert.equal(r.source, 'calibrated');
    assert.equal(r.benchmarkIndex, 1272.5);
    assert.deepEqual(r.samples, [1606, 1272.5, 1147]);
    assert.equal(r.multiplier, 3);
    assert.equal(r.officialMultiplier, 2.945);
    assert.equal(r.warning, undefined);
  });
  it('host terlalu lambat: 1x dengan peringatan', async () => {
    const r = await resolveCpu({ mode: 'calibrate' }, async () => [120, 130, 110]);
    assert.equal(r.multiplier, 1);
    assert.equal(r.officialMultiplier, null);
    assert.match(r.warning, /terlalu lambat/);
  });
  it('pengukuran gagal atau kosong: 4x (paling ketat) dengan peringatan', async () => {
    const gagal = await resolveCpu({ mode: 'calibrate' }, async () => {
      throw new Error('Command failed\nRuntime error encountered: NO_FCP');
    });
    assert.equal(gagal.multiplier, 4);
    assert.equal(gagal.warning, 'pengukuran gagal: Runtime error encountered: NO_FCP; memakai 4x');
    const kosong = await resolveCpu({ mode: 'calibrate' }, async () => [NaN, 0]);
    assert.equal(kosong.multiplier, 4);
    assert.match(kosong.warning, /tidak ada sampel/);
  });
});
