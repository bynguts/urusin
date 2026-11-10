import { describe, expect, it } from 'vitest';
import {
  AKSI_TERMINAL,
  AksiSchema,
  AksiSesiInternalSchema,
  AksiSesiResponseSchema,
  AmatiSesiResponseSchema,
  ButuhSesiInternalSchema,
  ElemenAmatanSchema,
  EVENT_TYPES,
  IzinkanIsiRequestSchema,
  KELAS_BOLEH_KLIK_AI,
  PendampingServerMessageSchema,
  PengamatanSchema,
  RefSchema,
  RencanaHalamanSchema,
  TUNGGU_MAKS_MS,
  TungguSesiInternalSchema,
  UrusinEventSchema,
} from './index.js';
import { bacaFixture } from './fixtures-node.js';

const SID_HASH = 'a'.repeat(64);
const HASH = 'b'.repeat(64);
const pemilik = { urusanId: 'u1', sidHash: SID_HASH };

describe('kontrak Navigator generik (ADR 0030)', () => {
  it('ref hanya e<angka> pendek', () => {
    for (const r of ['e1', 'e42', 'e9999']) expect(RefSchema.safeParse(r).success, r).toBe(true);
    for (const r of ['e', 'e10000', 'E1', '#id', 'e1;', 'button'])
      expect(RefSchema.safeParse(r).success, r).toBe(false);
  });

  it('elemen pengamatan: isian tidak pernah nilai mentah', () => {
    const dasar = { ref: 'e1', peran: 'teks', nama: 'NIK' } as const;
    expect(ElemenAmatanSchema.safeParse({ ...dasar, isian: 'kosong' }).success).toBe(true);
    expect(ElemenAmatanSchema.safeParse({ ...dasar, isian: '{{PEMOHON.NIK}}' }).success).toBe(true);
    // Nilai mentah (mis. nama atau deret angka) bukan state maupun placeholder -> ditolak.
    const angka = '3'.repeat(8) + '1'.repeat(8);
    expect(ElemenAmatanSchema.safeParse({ ...dasar, isian: angka }).success).toBe(false);
    expect(ElemenAmatanSchema.safeParse({ ...dasar, isian: 'Budi' }).success).toBe(false);
    expect(ElemenAmatanSchema.safeParse({ ...dasar, nama: 'x'.repeat(121) }).success).toBe(false);
    expect(ElemenAmatanSchema.safeParse({ ...dasar, form: 'form1' }).success).toBe(false);
  });

  it('pengamatan: jalur tanpa query, batas elemen dan teks', () => {
    const p = bacaFixture('navigator/pengamatan-formulir')!.data as Record<string, unknown>;
    expect(PengamatanSchema.safeParse(p).success).toBe(true);
    expect(PengamatanSchema.safeParse({ ...p, jalur: '/a?nik=1' }).success).toBe(false);
    expect(PengamatanSchema.safeParse({ ...p, jalur: 'a' }).success).toBe(false);
    expect(PengamatanSchema.safeParse({ ...p, v: 2 }).success).toBe(false);
    expect(PengamatanSchema.safeParse({ ...p, teks: 'x'.repeat(2501) }).success).toBe(false);
    expect(PengamatanSchema.safeParse({ ...p, host: 'https://a.go.id' }).success).toBe(false);
    const banyak = Array.from({ length: 151 }, (_, i) => ({ ref: `e${i}`, peran: 'teks', nama: 'x' }));
    expect(PengamatanSchema.safeParse({ ...p, elemen: banyak }).success).toBe(false);
  });

  it('aksi: hanya ref, placeholder, indeks opsi; tidak ada URL, teks bebas, keyboard, JS, atau kirim', () => {
    const ok = [
      { jenis: 'isi', ref: 'e1', nilai: '{{PEMOHON.NIK}}' },
      { jenis: 'pilih', ref: 'e2', nilai: { opsi: 3 } },
      { jenis: 'pilih', ref: 'e2', nilai: '{{PEMOHON.AGAMA}}' },
      { jenis: 'centang', ref: 'e3', nilai: true },
      { jenis: 'unggah', ref: 'e4', berkas: 'KTP' },
      { jenis: 'klik', ref: 'e5' },
      { jenis: 'serahkan', alasan: 'captcha' },
      { jenis: 'tidak_bisa', sebab: 'hanya_aplikasi' },
    ];
    for (const a of ok) expect(AksiSchema.safeParse(a).success, JSON.stringify(a)).toBe(true);
    const bad = [
      { jenis: 'isi', ref: 'e1', nilai: 'Budi Santoso' },
      { jenis: 'isi', ref: 'e1', nilai: '{{PEMOHON.NIK}}', url: 'https://x' },
      { jenis: 'pilih', ref: 'e2', nilai: { opsi: 40 } },
      { jenis: 'pilih', ref: 'e2', nilai: 'Islam' },
      { jenis: 'unggah', ref: 'e4', berkas: '../etc/passwd' },
      { jenis: 'klik', ref: '#kirim' },
      { jenis: 'kirim', ref: 'e5' },
      { jenis: 'tekan', tombol: 'Enter' },
      { jenis: 'js', kode: 'form.submit()' },
      { jenis: 'buka', url: 'https://contoh.go.id' },
      { jenis: 'serahkan', alasan: 'bebas' },
    ];
    for (const a of bad) {
      const r = AksiSchema.safeParse(a);
      // Kunci tambahan dibuang zod; yang penting tidak ada skema yang menerima nilai/URL di field mana pun.
      if (r.success) expect(JSON.stringify(r.data)).not.toMatch(/https|Budi|submit/);
      else expect(r.success).toBe(false);
    }
    expect(AksiSchema.safeParse({ jenis: 'isi', ref: 'e1', nilai: 'Budi Santoso' }).success).toBe(false);
  });

  it('rencana: paling banyak satu aksi terminal dan harus terakhir', () => {
    const rencana = bacaFixture('navigator/rencana-isi')!.data;
    expect(RencanaHalamanSchema.safeParse(rencana).success).toBe(true);
    const isi = { jenis: 'isi', ref: 'e1', nilai: '{{PEMOHON.NIK}}' };
    const serahkan = { jenis: 'serahkan', alasan: 'final' };
    const tidakBisa = { jenis: 'tidak_bisa', sebab: 'situs_rusak' };
    expect(RencanaHalamanSchema.safeParse({ aksi: [isi, serahkan] }).success).toBe(true);
    expect(RencanaHalamanSchema.safeParse({ aksi: [tidakBisa] }).success).toBe(true);
    expect(RencanaHalamanSchema.safeParse({ aksi: [serahkan, isi] }).success).toBe(false);
    expect(RencanaHalamanSchema.safeParse({ aksi: [serahkan, tidakBisa] }).success).toBe(false);
    expect(RencanaHalamanSchema.safeParse({ aksi: [isi, serahkan, serahkan] }).success).toBe(false);
    expect(RencanaHalamanSchema.safeParse({ aksi: [] }).success).toBe(false);
    expect(RencanaHalamanSchema.safeParse({ aksi: Array(26).fill(isi) }).success).toBe(false);
    expect(AKSI_TERMINAL).toEqual(['serahkan', 'tidak_bisa']);
    expect(KELAS_BOLEH_KLIK_AI).toEqual(['navigasi', 'ui_lokal', 'lanjut']);
  });

  it('endpoint internal amati/aksi/tunggu', () => {
    const p = bacaFixture('navigator/pengamatan-formulir')!.data;
    expect(AmatiSesiResponseSchema.safeParse({ mode: 'ai', pengamatan: p }).success).toBe(true);
    const aksi = [{ jenis: 'klik', ref: 'e7' }];
    expect(AksiSesiInternalSchema.safeParse({ ...pemilik, rencanaHash: HASH, aksi }).success).toBe(true);
    expect(AksiSesiInternalSchema.safeParse({ ...pemilik, rencanaHash: HASH, aksi, seq: 3 }).success).toBe(
      true,
    );
    expect(AksiSesiInternalSchema.safeParse({ ...pemilik, rencanaHash: 'x', aksi }).success).toBe(false);
    expect(AksiSesiInternalSchema.safeParse({ ...pemilik, rencanaHash: HASH, aksi: [] }).success).toBe(false);
    expect(
      AksiSesiResponseSchema.safeParse({
        mode: 'ai',
        hasil: [
          { indeks: 0, kode: 'ok' },
          { indeks: 1, kode: 'KELAS_DITOLAK', kelas: 'kirim' },
        ],
      }).success,
    ).toBe(true);
    expect(TungguSesiInternalSchema.safeParse({ ...pemilik, maksMs: TUNGGU_MAKS_MS }).success).toBe(true);
    expect(TungguSesiInternalSchema.safeParse({ ...pemilik, maksMs: TUNGGU_MAKS_MS + 1 }).success).toBe(
      false,
    );
    expect(TungguSesiInternalSchema.safeParse({ ...pemilik, maksMs: -1 }).success).toBe(false);
  });

  it('butuh_data.kolom dan rencanaHash opsional (aditif)', () => {
    const butuh = { placeholder: ['{{PEMOHON.NIK}}'], berkas: [], origin: 'https://contoh.go.id' };
    const kolom = [{ placeholder: '{{PEMOHON.NIK}}', labelPortal: 'No. KTP', tidakLazim: false }];
    expect(ButuhSesiInternalSchema.safeParse(butuh).success).toBe(true);
    expect(ButuhSesiInternalSchema.safeParse({ ...butuh, kolom, rencanaHash: HASH }).success).toBe(true);
    expect(PendampingServerMessageSchema.safeParse({ type: 'butuh_data', ...butuh }).success).toBe(true);
    expect(
      PendampingServerMessageSchema.safeParse({ type: 'butuh_data', ...butuh, kolom, rencanaHash: HASH })
        .success,
    ).toBe(true);
    expect(
      PendampingServerMessageSchema.safeParse({
        type: 'butuh_data',
        ...butuh,
        kolom: [{ placeholder: 'nik mentah', labelPortal: 'x' }],
      }).success,
    ).toBe(false);
    const izin = { writeList: ['{{PEMOHON.NIK}}'], targetOrigin: 'https://contoh.go.id' };
    expect(IzinkanIsiRequestSchema.safeParse(izin).success).toBe(true);
    expect(IzinkanIsiRequestSchema.safeParse({ ...izin, rencanaHash: HASH }).success).toBe(true);
  });

  it('event jejak_pendamping: terdaftar dan tidak menerima nilai/teks bebas', () => {
    expect(EVENT_TYPES).toContain('jejak_pendamping');
    const amplop = {
      type: 'jejak_pendamping',
      executionId: 'x1',
      seq: 1,
      at: '2026-11-10T00:00:00.000Z',
      chainHead: 'c',
    };
    const ok = (catatan: unknown) => UrusinEventSchema.safeParse({ ...amplop, catatan }).success;
    expect(ok({ jenis: 'amati', host: 'a.go.id', sidik: 's', elemen: 3 })).toBe(true);
    expect(
      ok({ jenis: 'blokir', metode: 'POST', host: 'a.go.id', jalurSha256: HASH, jendela: 'ai_klik' }),
    ).toBe(true);
    // Path mentah (bisa memuat NIK di query) ditolak: hanya sha256.
    expect(
      ok({
        jenis: 'blokir',
        metode: 'POST',
        host: 'a.go.id',
        jalurSha256: '/kirim?nik=1',
        jendela: 'ai_klik',
      }),
    ).toBe(false);
    expect(
      ok({ jenis: 'validasi', rencanaHash: HASH, putusan: 'tolak', aturan: ['REF_TIDAK_DIAMATI'] }),
    ).toBe(true);
    expect(ok({ jenis: 'validasi', rencanaHash: HASH, putusan: 'tolak', aturan: ['nilai bebas'] })).toBe(
      false,
    );
    expect(
      ok({
        jenis: 'klik',
        ref: 'e1',
        kelas: 'kirim',
        aturan: 4,
        fitur: ['nilai bebas 123'],
        putusan: 'tolak',
      }),
    ).toBe(false);
  });
});
