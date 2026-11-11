import { describe, expect, it } from 'vitest';
import { DemoProvider } from '../demo.js';
import { INJECTION_CASES } from '../injection/cases.js';
import { reportMarkdown, runEval } from './run.js';
import { INTENT_TASKS } from './tasks.js';

describe('eval harness (FakeProvider, cepat, tanpa jaringan)', () => {
  it('12 tugas intent: 4 Peristiwa Hidup + urusan umum, id unik', () => {
    expect(INTENT_TASKS).toHaveLength(12);
    expect(new Set(INTENT_TASKS.map((t) => t.id)).size).toBe(12);
    for (const j of ['kelahiran', 'kematian', 'perkawinan', 'pindah']) {
      expect(INTENT_TASKS.some((t) => t.jenis === j)).toBe(true);
    }
  });

  it('k=5 dengan model demo: pass^5 = 100%, intent 100%, tool valid 100%, grounding 100%', async () => {
    const t0 = performance.now();
    const r = await runEval({ k: 5, model: 'fake-demo', provider: () => new DemoProvider() });
    expect(performance.now() - t0).toBeLessThan(20_000);
    expect(r.ringkasan.jumlahPercobaan).toBe(60);
    expect(r.ringkasan.passHatK).toBe(1);
    expect(r.ringkasan.passAt1).toBe(1);
    expect(r.ringkasan.akurasiIntent).toBe(1);
    expect(r.ringkasan.validitasToolTanpaRetry).toBe(1);
    expect(r.ringkasan.groundingPassRate).toBe(1);
    expect(r.ringkasan.token.masuk).toBeGreaterThan(0);
    expect(r.tugas.every((t) => t.passHatK && t.k === 5)).toBe(true);
    expect(r.injeksi.ringkasan.asrTulis).toBe(0);
    expect(r.injeksi.ringkasan.total).toBe(INJECTION_CASES.length);
    // Selaras dengan batas 20 detik yang diuji di atas; bawaan vitest 5 detik gagal di runner yang sibuk.
  }, 30_000);

  it('pass^k lebih ketat daripada pass@1: satu kegagalan dari k menggugurkan tugas', async () => {
    let n = 0;
    const r = await runEval({
      k: 3,
      model: 'm',
      // Tugas tanpa kata kunci jenis (klasifikasiKataKunci), jadi intent tetap dari model.
      tasks: [INTENT_TASKS[2]!, INTENT_TASKS[5]!],
      // percobaan ke-2 salah mengklasifikasi intent
      provider: () =>
        new DemoProvider({
          intentOverride: (t) => (++n === 2 ? 'lainnya' : t.includes('menikah') ? 'perkawinan' : 'kk'),
        }),
    });
    expect(r.tugas[0]).toMatchObject({ lolos: 2, k: 3, passHatK: false });
    expect(r.tugas[1]).toMatchObject({ lolos: 3, passHatK: true });
    expect(r.ringkasan.passHatK).toBeCloseTo(0.5);
    expect(r.ringkasan.passAt1).toBeCloseTo(5 / 6);
    expect(r.ringkasan.akurasiIntent).toBeCloseTo(5 / 6);
  });

  it('biaya IDR dihitung dari usage × harga × kurs', async () => {
    const r = await runEval({
      k: 1,
      model: 'm',
      tasks: INTENT_TASKS.slice(11),
      provider: () => new DemoProvider(),
      prices: { inputPerMTok: 1_000_000, outputPerMTok: 1_000_000, audioPerMin: 0 },
      idrPerUsd: 2,
    });
    expect(r.ringkasan.biayaIdr).toBeGreaterThan(0);
    expect(r.ringkasan.biayaIdr).toBeCloseTo((r.ringkasan.token.masuk + r.ringkasan.token.keluar) * 2);
  });

  it('laporan markdown memuat semua metrik yang diminta', async () => {
    const r = await runEval({
      k: 1,
      model: 'fake-demo',
      tasks: INTENT_TASKS.slice(0, 3),
      provider: () => new DemoProvider(),
    });
    const md = reportMarkdown(r);
    for (const s of [
      'pass^1',
      'Akurasi intent',
      'Validitas tool call',
      'Grounding pass rate',
      'p50 / p95',
      'Biaya (IDR)',
      'ASR injeksi',
    ]) {
      expect(md).toContain(s);
    }
  });
});
