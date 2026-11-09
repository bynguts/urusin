import { describe, expect, it } from 'vitest';
import {
  DataDiriSchema,
  ENDPOINT_AKUN,
  KodeGalatAkunSchema,
  MasukRequestSchema,
  SesiAkunResponseSchema,
  TerkirimResponseSchema,
  UKURAN_DOKUMEN_MAKS,
  VaultResponseSchema,
  VerifikasiEmailRequestSchema,
} from './index.js';

const metode = { email: true, google: false, juri: true };
const email = { mode: 'resend', tertunda: false };

describe('kontrak akun', () => {
  it('sesi: tamu dan masuk dibedakan oleh `masuk`; jenis akun/demo, sinkron, status email', () => {
    expect(SesiAkunResponseSchema.parse({ masuk: false, metode, email }).masuk).toBe(false);
    const masuk = {
      masuk: true,
      metode,
      email: { mode: 'log', tertunda: true },
      akun: {
        id: 'akun_1',
        jenis: 'akun',
        email: 'warga@example.com',
        emailTerverifikasi: false,
        punyaSandi: true,
        terhubungGoogle: false,
        profilLengkap: false,
        sinkron: false,
        dibuatPada: '2026-11-09T00:00:00.000Z',
      },
      perangkat: [],
    };
    expect(SesiAkunResponseSchema.safeParse(masuk).success).toBe(true);
    const demo = { ...masuk, akun: { ...masuk.akun, jenis: 'demo', email: null, sinkron: true } };
    expect(SesiAkunResponseSchema.safeParse(demo).success).toBe(true);
    expect(
      SesiAkunResponseSchema.safeParse({ ...masuk, akun: { ...masuk.akun, jenis: 'tamu' } }).success,
    ).toBe(false);
    expect(SesiAkunResponseSchema.safeParse({ ...masuk, akun: undefined }).success).toBe(false);
  });

  it('Data Diri: format angka diperiksa, field tak dikenal dibuang', () => {
    const nik = ['1234', '5678', '9012', '3456'].join('');
    const r = DataDiriSchema.parse({ nik, rt: '001', kodePos: '12345', lain: 'x' });
    expect(r).toEqual({ nik, rt: '001', kodePos: '12345' });
    expect(DataDiriSchema.safeParse({ nik: '123' }).success).toBe(false);
    expect(DataDiriSchema.safeParse({ tanggalLahir: '1990-02-30x' }).success).toBe(false);
  });

  it('masuk, verifikasi (butuh sandi), terkirim (tertunda), vault tanpa nilai; endpoint terdaftar', () => {
    expect(MasukRequestSchema.safeParse({ email: 'a@example.com', sandi: 'x' }).success).toBe(true);
    expect(VerifikasiEmailRequestSchema.safeParse({ token: 't' }).success).toBe(false);
    expect(TerkirimResponseSchema.safeParse({ terkirim: true }).success).toBe(false);
    expect(TerkirimResponseSchema.safeParse({ terkirim: true, tertunda: true }).success).toBe(true);
    expect(
      VaultResponseSchema.safeParse({
        pemilik: 'tamu',
        sinkron: false,
        dataDiri: { ada: true, diubahPada: '2026-11-09T00:00:00.000Z' },
        dokumen: [],
        batas: { berkas: 10, ukuranBerkas: UKURAN_DOKUMEN_MAKS },
      }).success,
    ).toBe(true);
    expect(UKURAN_DOKUMEN_MAKS).toBe(9 * 1024 * 1024);
    for (const k of ['TERKUNCI', 'TURNSTILE_WAJIB', 'PERLU_MASUK_ULANG', 'GOOGLE_PERLU_SANDI'])
      expect(KodeGalatAkunSchema.options).toContain(k);
    expect(ENDPOINT_AKUN.googleCallback.path).toBe('/auth/google/callback');
    expect(ENDPOINT_AKUN.unduhDokumen.path).toBe('/api/vault/[id]');
  });
});
