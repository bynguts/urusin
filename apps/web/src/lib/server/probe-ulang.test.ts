import { ALL_OFF, CAPABILITIES, type CapabilityFlags, type CapabilityReport } from '@urusin/llm';
import { afterEach, describe, expect, it } from 'vitest';
import { JEDA_PROBE_MS, aturStatusProbe, pantauProbe, probeGalat, statusProbe } from './probe-ulang.js';

/** Laporan probe: kapabilitas di `ok` lolos, di `galat` melempar (timeout/SSE rusak), sisanya jawaban "tidak". */
function laporan(ok: string[], galat: string[] = []): CapabilityReport {
  const details = Object.fromEntries(
    CAPABILITIES.map((c) => [
      c,
      ok.includes(c)
        ? { ok: true, ms: 1 }
        : galat.includes(c)
          ? { ok: false, ms: 1, error: 'This operation was aborted' }
          : { ok: false, ms: 1 },
    ]),
  ) as CapabilityReport['details'];
  const flags = Object.fromEntries(CAPABILITIES.map((c) => [c, details[c].ok])) as CapabilityFlags;
  return { key: 'k', baseURL: 'http://x', model: 'm', probedAt: '2026-11-11T00:00:00Z', flags, details };
}

const INTI = ['tools', 'parallel_tool_calls', 'json_schema_strict', 'streaming_tools'];

/** Jadwal palsu: simpan callback + jeda, jalankan manual. */
function jadwalPalsu() {
  const antre: { fn: () => void; ms: number }[] = [];
  return {
    antre,
    jadwal: (fn: () => void, ms: number) => void antre.push({ fn, ms }),
    async jalankan() {
      const t = antre.shift();
      if (!t) throw new Error('tidak ada probe terjadwal');
      t.fn();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

afterEach(() => aturStatusProbe(undefined));

describe('probeGalat', () => {
  it('probe melempar seluruhnya = semua kapabilitas inti galat', () => {
    expect(probeGalat(null)).toEqual(INTI);
  });
  it('jawaban "tidak didukung" dan kapabilitas tak dikonfigurasi bukan galat', () => {
    const l = laporan(['tools']);
    l.details.vision = { ok: false, ms: 0, skipped: true, error: 'model tidak dikonfigurasi' };
    expect(probeGalat(l)).toEqual([]);
  });
  it('hanya kapabilitas inti yang dihitung', () => {
    expect(probeGalat(laporan(INTI, ['embeddings', 'vision']))).toEqual([]);
    expect(probeGalat(laporan(['tools'], ['streaming_tools']))).toEqual(['streaming_tools']);
  });
});

describe('pantauProbe', () => {
  const opts = (
    caps: CapabilityFlags,
    l: CapabilityReport | null,
    probe: () => Promise<CapabilityReport>,
  ) => {
    const j = jadwalPalsu();
    pantauProbe({ caps, laporan: l, probe, jadwal: j.jadwal, now: () => 0, catat: () => {} });
    return j;
  };

  it('probe boot sukses: status ok, tanpa probe ulang', () => {
    const caps = { ...ALL_OFF, ...laporan(INTI).flags };
    const j = opts(caps, laporan(INTI), () => Promise.reject(new Error('tak boleh dipanggil')));
    expect(j.antre).toHaveLength(0);
    expect(statusProbe()).toEqual({ status: 'ok', percobaan: 1 });
  });

  it('jawaban "tidak" yang sah tidak diulang (bukan degraded sementara)', () => {
    const j = opts({ ...ALL_OFF }, laporan([]), () => Promise.reject(new Error('x')));
    expect(j.antre).toHaveLength(0);
    expect(statusProbe()?.status).toBe('ok');
  });

  it('probe boot galat (timeout/SSE) -> mencoba_ulang -> pulih menyalakan caps runtime', async () => {
    const caps = { ...ALL_OFF };
    let panggil = 0;
    const j = opts(caps, null, async () => {
      panggil += 1;
      if (panggil === 1) throw new Error('fetch failed');
      if (panggil === 2)
        return laporan(['tools'], ['parallel_tool_calls', 'json_schema_strict', 'streaming_tools']);
      return laporan([...INTI, 'vision']);
    });
    expect(statusProbe()).toEqual({
      status: 'mencoba_ulang',
      percobaan: 1,
      berikutnyaPada: new Date(15_000).toISOString(),
      galat: INTI,
    });
    expect(caps.tools).toBe(false);

    await j.jalankan(); // percobaan 2: melempar
    expect(statusProbe()).toMatchObject({ status: 'mencoba_ulang', percobaan: 2, galat: INTI });

    await j.jalankan(); // percobaan 3: tools pulih sebagian, langsung dinyalakan
    expect(caps.tools).toBe(true);
    expect(caps.parallel_tool_calls).toBe(false);
    expect(statusProbe()).toMatchObject({ status: 'mencoba_ulang', percobaan: 3 });

    await j.jalankan(); // percobaan 4: pulih penuh
    expect(caps).toMatchObject({
      tools: true,
      parallel_tool_calls: true,
      json_schema_strict: true,
      vision: true,
    });
    expect(statusProbe()).toEqual({ status: 'ok', percobaan: 4 });
    expect(j.antre).toHaveLength(0);
  });

  it('backoff 15s, 30s, 60s, 2m, 4m lalu tertahan di 5 menit', async () => {
    const j = opts({ ...ALL_OFF }, null, () => Promise.reject(new Error('fetch failed')));
    const jeda: number[] = [];
    for (let i = 0; i < 8; i++) {
      jeda.push(j.antre[0]!.ms);
      await j.jalankan();
    }
    expect(jeda).toEqual([...JEDA_PROBE_MS, 300_000, 300_000]);
    expect(statusProbe()).toMatchObject({ status: 'mencoba_ulang', percobaan: 9 });
  });

  it('probe ulang tidak pernah mematikan kapabilitas yang sudah menyala', async () => {
    const caps = { ...ALL_OFF, tools: true };
    const j = opts(caps, laporan(['tools'], ['streaming_tools']), async () =>
      laporan([], ['streaming_tools']),
    );
    await j.jalankan();
    expect(caps.tools).toBe(true);
  });
});
