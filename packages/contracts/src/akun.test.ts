import { describe, expect, it } from 'vitest';
import {
  DataDiriSchema,
  ENDPOINT_AKUN,
  KodeGalatAkunSchema,
  MasukRequestSchema,
  SesiAkunResponseSchema,
} from './index.js';

describe('kontrak akun', () => {
  it('sesi: tamu dan masuk dibedakan oleh `masuk`', () => {
    expect(SesiAkunResponseSchema.parse({ masuk: false, metode: { email: true, google: false } }).masuk).toBe(
      false,
    );
    const masuk = {
      masuk: true,
      metode: { email: true, google: true },
      akun: {
        id: 'akun_1',
        email: 'warga@example.com',
        emailTerverifikasi: true,
        punyaSandi: true,
        terhubungGoogle: false,
        profilLengkap: false,
        dibuatPada: '2026-11-09T00:00:00.000Z',
      },
      perangkat: [],
    };
    expect(SesiAkunResponseSchema.safeParse(masuk).success).toBe(true);
    expect(SesiAkunResponseSchema.safeParse({ ...masuk, akun: undefined }).success).toBe(false);
  });

  it('Data Diri: format angka diperiksa, field tak dikenal dibuang', () => {
    const nik = ['1234', '5678', '9012', '3456'].join('');
    const r = DataDiriSchema.parse({ nik, rt: '001', kodePos: '12345', lain: 'x' });
    expect(r).toEqual({ nik, rt: '001', kodePos: '12345' });
    expect(DataDiriSchema.safeParse({ nik: '123' }).success).toBe(false);
    expect(DataDiriSchema.safeParse({ tanggalLahir: '1990-02-30x' }).success).toBe(false);
  });

  it('masuk: next opsional; kode galat dan endpoint terdaftar', () => {
    expect(MasukRequestSchema.safeParse({ email: 'a@example.com', sandi: 'x' }).success).toBe(true);
    expect(KodeGalatAkunSchema.options).toContain('TERKUNCI');
    expect(ENDPOINT_AKUN.googleCallback.path).toBe('/auth/google/callback');
  });
});
