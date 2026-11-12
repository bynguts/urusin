import { describe, expect, it } from 'vitest';
import type { Penyemat } from './klien.js';
import { peringkatKandidat } from './peringkat.js';
import { PROFIL_MODEL, profilModel } from './profil.js';
import { buatKlasifikasiPrototipe } from './prototipe.js';
import { kosinus, normalisasi } from './vektor.js';

/** Penyemat palsu: vektor dari kamus kata kunci -> sumbu, sehingga kosinus bisa dihitung tangan. */
const SUMBU = ['lahir', 'ktp', 'pindah'] as const;
function penyematKata(opsi: { mati?: boolean } = {}): Penyemat & { panggilan: number } {
  const p = {
    panggilan: 0,
    semat(teks: readonly string[]) {
      p.panggilan++;
      if (opsi.mati) return Promise.resolve(null);
      return Promise.resolve(
        teks.map((t) => normalisasi([...SUMBU.map((s) => (t.includes(s) ? 1 : 0)), 0.2])!),
      );
    },
  };
  return p;
}

const proto = { kelahiran: ['akta lahir'], ktp: ['ganti ktp'], pindah: ['surat pindah'] };
const profil = PROFIL_MODEL.harrier;

describe('buatKlasifikasiPrototipe', () => {
  it('belum panas = null tanpa menunggu, lalu memanaskan di latar belakang', async () => {
    const p = penyematKata();
    const k = buatKlasifikasiPrototipe(p, {
      prototipe: proto,
      instruksi: 'i',
      profil,
      ambang: { skor: 0.5, margin: 0.1 },
    });
    expect(await k.klasifikasi('anak lahir')).toBeNull();
    expect(await k.panaskan()).toBe(true);
    expect(await k.klasifikasi('anak lahir')).toMatchObject({ label: 'kelahiran' });
  });

  it('ambang skor dan margin: kueri ambigu (dua label sama dekat) tidak diterima', async () => {
    const k = buatKlasifikasiPrototipe(penyematKata(), {
      prototipe: proto,
      instruksi: 'i',
      profil,
      ambang: { skor: 0.5, margin: 0.1 },
    });
    await k.panaskan();
    const r = await k.klasifikasi('ktp lahir');
    expect(r).toBeNull();
    const s = await k.skor('ktp lahir');
    expect(s![0]![1] - s![1]![1]).toBeCloseTo(0, 6);
    // Kueri tanpa kata kunci: skor rendah, ditolak ambang skor.
    expect(await k.klasifikasi('resep rendang')).toBeNull();
    const ok = await k.klasifikasi('ktp ilang');
    expect(ok?.label).toBe('ktp');
    expect(ok!.skor).toBeGreaterThanOrEqual(0.5);
    expect(ok!.margin).toBeGreaterThanOrEqual(0.1);
  });

  it('fail-open: sidecar mati = null, pemanasan dicoba ulang pada panggilan berikutnya', async () => {
    const p = penyematKata({ mati: true });
    const k = buatKlasifikasiPrototipe(p, {
      prototipe: proto,
      instruksi: 'i',
      profil,
      ambang: { skor: 0, margin: 0 },
    });
    expect(await k.panaskan()).toBe(false);
    expect(await k.klasifikasi('anak lahir')).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(p.panggilan).toBe(2);
  });

  it('pemanasan bersamaan hanya satu permintaan', async () => {
    const p = penyematKata();
    const k = buatKlasifikasiPrototipe(p, {
      prototipe: proto,
      instruksi: 'i',
      profil,
      ambang: { skor: 0, margin: 0 },
    });
    await Promise.all([k.panaskan(), k.panaskan()]);
    expect(p.panggilan).toBe(1);
    await k.panaskan();
    expect(p.panggilan).toBe(1);
  });

  it('kueri memakai awalan instruksi profil, prototipe memakai awalan dokumen', async () => {
    const dilihat: string[] = [];
    const p: Penyemat = {
      semat: (t) => (dilihat.push(...t), Promise.resolve(t.map(() => normalisasi([1, 0])!))),
    };
    const k = buatKlasifikasiPrototipe(p, {
      prototipe: { a: ['proto'] },
      instruksi: 'INS',
      profil: PROFIL_MODEL.gemma,
      ambang: { skor: 0, margin: 0 },
    });
    await k.panaskan();
    await k.klasifikasi('halo');
    expect(dilihat).toEqual(['title: none | text: proto', 'task: search result | query: halo']);
  });
});

describe('peringkatKandidat', () => {
  it('mengurutkan kandidat menurut kemiripan, null bila sidecar mati', async () => {
    const r = await peringkatKandidat(penyematKata(), {
      kueri: 'pindah datang',
      kandidat: ['Akta lahir', 'Surat pindah', 'Cetak ktp'],
      instruksi: 'i',
      profil,
    });
    expect(r![0]).toMatchObject({ indeks: 1 });
    expect(
      await peringkatKandidat(penyematKata(), { kueri: 'x', kandidat: [], instruksi: 'i', profil }),
    ).toEqual([]);
    expect(
      await peringkatKandidat(penyematKata({ mati: true }), {
        kueri: 'x',
        kandidat: ['a'],
        instruksi: 'i',
        profil,
      }),
    ).toBeNull();
  });
});

describe('vektor dan profil', () => {
  it('normalisasi menolak vektor nol/non-finite; kosinus menolak dimensi beda', () => {
    expect(normalisasi([0, 0])).toBeNull();
    expect(normalisasi([1, Number.NaN])).toBeNull();
    expect(kosinus(normalisasi([3, 4])!, normalisasi([3, 4])!)).toBeCloseTo(1, 6);
    expect(() => kosinus(new Float32Array(2), new Float32Array(3))).toThrow(RangeError);
  });

  it('profilModel: nama tak dikenal = profil produksi', () => {
    expect(profilModel('qwen3').nama).toBe('qwen3');
    expect(profilModel('tidak-ada').nama).toBe(profilModel(undefined).nama);
    expect(PROFIL_MODEL.qwen3.kueri('I', 'q')).toBe('Instruct: I\nQuery:q');
    expect(PROFIL_MODEL.harrier.kueri('I', 'q')).toBe('Instruct: I\nQuery: q');
    expect(PROFIL_MODEL.harrier.dokumen('d')).toBe('d');
  });
});
