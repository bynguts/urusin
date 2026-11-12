import { RencanaHalamanSchema } from '@urusin/contracts';
import { strictSchemaFor } from '@urusin/llm';
import { describe, expect, it } from 'vitest';
import { mintaRencana, pesanRencana } from './prompt.js';
import { ProviderSkrip, halamanForm } from './testing.js';
import { PIKIR_MAKS, RencanaKetatSchema, validasiRencana } from './validasi.js';

const AKSI = [
  { jenis: 'isi', ref: 'e2', nilai: '{{PEMOHON.NAMA}}' },
  { jenis: 'klik', ref: 'e11' },
];
const PIKIR = 'Halaman formulir KK; nama belum diisi, isi lalu Lanjut.';

describe('penalaran singkat (pikir)', () => {
  it('skema strict: pikir field PERTAMA, wajib di JSON schema tetapi boleh null; properti lain tetap ditolak', () => {
    const s = strictSchemaFor(RencanaKetatSchema).json as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(Object.keys(s.properties)).toEqual(['pikir', 'aksi']);
    expect(s.required).toEqual(['pikir', 'aksi']);
    expect(s.additionalProperties).toBe(false);
    expect(RencanaKetatSchema.safeParse({ aksi: AKSI, catatan: 'x' }).success).toBe(false);
    expect(RencanaKetatSchema.safeParse({ aksi: AKSI }).success).toBe(true);
  });

  it('validator membuang pikir: rencana, hash, dan kontrak sama dengan rencana tanpa pikir', () => {
    const p = halamanForm();
    const dengan = validasiRencana({ pikir: PIKIR, aksi: AKSI }, p);
    const tanpa = validasiRencana({ aksi: AKSI }, p);
    expect(dengan.ok && tanpa.ok).toBe(true);
    if (!dengan.ok || !tanpa.ok) return;
    expect(dengan.rencanaHash).toBe(tanpa.rencanaHash);
    expect(dengan.rencana).toEqual(tanpa.rencana);
    expect(JSON.stringify(dengan)).not.toContain('pikir');
    expect(RencanaHalamanSchema.safeParse(dengan.rencana).success).toBe(true);
  });

  it('pikir terlalu panjang atau bukan teks = SKEMA_TIDAK_SAH', () => {
    const p = halamanForm();
    const panjang = validasiRencana({ pikir: 'x'.repeat(PIKIR_MAKS + 1), aksi: AKSI }, p);
    expect(panjang).toMatchObject({ ok: false, aturan: ['SKEMA_TIDAK_SAH'] });
    expect(validasiRencana({ pikir: 3, aksi: AKSI }, p)).toMatchObject({ ok: false });
  });

  it('model menjawab pikir null (strict) atau tanpa pikir: keduanya sah', async () => {
    for (const jawab of [{ pikir: null, aksi: AKSI }, { aksi: AKSI }, { pikir: PIKIR, aksi: AKSI }]) {
      const provider = new ProviderSkrip(() => jawab);
      const r = await mintaRencana(
        { provider, model: 'fake', caps: { json_schema_strict: true, tools: false } },
        { pengamatan: halamanForm(), tujuan: 'KK' },
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(validasiRencana(r.rencana, halamanForm()).ok).toBe(true);
      // Batas token dinaikkan untuk pikir.
      expect(provider.calls[0]?.max_tokens).toBe(1600);
    }
  });

  it('aturan sistem meminta pikir singkat sebelum aksi dan menjelaskan RIWAYAT/PERIKSA HASIL', () => {
    const sys = String(pesanRencana({ pengamatan: halamanForm(), tujuan: 'KK' })[0]?.content);
    expect(sys).toContain('{"pikir":"...","aksi":[...]}');
    expect(sys).toMatch(/"pikir".*SEBELUM memilih aksi.*maks 300 karakter/);
    expect(sys).toMatch(/RIWAYAT = fakta sistem/);
    expect(sys).toMatch(/PERIKSA HASIL = situs menolak/);
  });

  it('satu perbaikan terstruktur di anak tangga json_object', async () => {
    let n = 0;
    const provider = new ProviderSkrip(() => (n++ === 0 ? 'bukan json' : { pikir: PIKIR, aksi: AKSI }));
    const r = await mintaRencana(
      { provider, model: 'fake', caps: { json_schema_strict: false, tools: false } },
      { pengamatan: halamanForm(), tujuan: 'KK' },
    );
    expect(r).toMatchObject({ ok: true, panggilan: 2 });
    const gagal = new ProviderSkrip(() => 'tetap bukan json');
    const r2 = await mintaRencana(
      { provider: gagal, model: 'fake', caps: { json_schema_strict: false, tools: false } },
      { pengamatan: halamanForm(), tujuan: 'KK' },
    );
    expect(r2).toMatchObject({ ok: false, panggilan: 2 });
  });
});
