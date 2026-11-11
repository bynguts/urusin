import { describe, expect, it } from 'vitest';
import {
  AlasanSerahkanSchema,
  decodePendampingFrame,
  encodePendampingFrame,
  ENDPOINT,
  MulaiPendampingRequestSchema,
  MulaiSesiInternalSchema,
  PENDAMPING_WS_CLOSE,
  PendampingClientMessageSchema,
  PendampingServerMessageSchema,
  SesiPendampingSchema,
} from './index.js';

const SID_HASH = 'a'.repeat(64);

describe('kontrak pendamping', () => {
  it('pesan klien: input dan kendali', () => {
    const ok = [
      { type: 'halo', tiket: 't'.repeat(32) },
      { type: 'pointer', aksi: 'down', x: 10, y: 20, jenis: 'touch', tombol: 'left', klik: 1 },
      { type: 'wheel', x: 1, y: 2, dx: 0, dy: 120 },
      { type: 'key', aksi: 'down', key: 'Enter', code: 'Enter' },
      { type: 'text', teks: 'DEV123' },
      { type: 'ambil_alih' },
      { type: 'kembalikan' },
      { type: 'akhiri' },
      { type: 'ping', t: 1 },
    ];
    for (const m of ok) expect(PendampingClientMessageSchema.safeParse(m).success, m.type).toBe(true);
  });

  it('A-M1: perangkat tidak bisa mengirim nilai vault atau berkas lewat WS; pesan rusak ditolak', () => {
    const bad = [
      { type: 'vault', isian: { '{{PEMOHON.HP}}': '1' } },
      { type: 'berkas', nama: 'ktp', namaBerkas: 'a.png', mime: 'image/png', dataBase64: 'AAAA' },
      {
        type: 'berkas_potong',
        nama: 'ktp',
        namaBerkas: 'a.png',
        mime: 'image/png',
        ukuran: 3,
        indeks: 0,
        total: 1,
        dataBase64: 'AAAA',
      },
      { type: 'text', teks: '' },
      { type: 'pointer', aksi: 'tap', x: 0, y: 0, jenis: 'mouse', tombol: 'left' },
      { type: 'eval', kode: 'x' },
    ];
    for (const m of bad) expect(PendampingClientMessageSchema.safeParse(m).success, m.type).toBe(false);
  });

  it('pesan server: frame, mode, event, status, butuh_data, galat', () => {
    const sesi = {
      sesiId: 's1',
      urusanId: 'u1',
      executionId: 'x1',
      status: 'antre',
      mode: null,
      antrean: { posisi: 1, panjang: 3 },
      dibuatPada: '2026-11-08T00:00:00.000Z',
      kedaluwarsaPada: '2026-11-08T00:15:00.000Z',
    };
    expect(SesiPendampingSchema.safeParse(sesi).success).toBe(true);
    const ok = [
      {
        type: 'frame',
        seq: 0,
        data: '/9j/',
        meta: { lebar: 390, tinggi: 844, skala: 1, offsetAtas: 0, scrollX: 0, scrollY: 0 },
      },
      { type: 'mode', mode: 'takeover', pesan: 'Giliran Anda' },
      { type: 'event', event: { jenis: 'giliran_anda', alasan: 'final', pesan: 'Tekan Kirim' } },
      { type: 'event', event: { jenis: 'selesai', hasil: 'berhasil', pesan: 'ok' } },
      { type: 'status', sesi },
      {
        type: 'butuh_data',
        placeholder: ['{{PEMOHON.HP}}'],
        berkas: ['berkas1'],
        origin: 'https://fixtures.urusinai.web.id',
      },
      { type: 'galat', kode: 'INPUT_DITOLAK_MODE_AI', pesanWarga: 'x' },
    ];
    for (const m of ok) expect(PendampingServerMessageSchema.safeParse(m).success, m.type).toBe(true);
  });

  it('request mulai dan internal', () => {
    expect(MulaiPendampingRequestSchema.safeParse({ executionId: 'x_1' }).success).toBe(true);
    expect(
      MulaiPendampingRequestSchema.safeParse({
        executionId: 'x_1',
        viewport: { lebar: 100, tinggi: 844, dpr: 2, seluler: true },
      }).success,
    ).toBe(false);
    const internal = {
      urusanId: 'u1',
      sidHash: SID_HASH,
      executionId: 'x1',
      adapterId: 'telunjuk-sakti-wonogiri',
      flowId: 'ajukan',
      origin: 'https://telunjuksakti.wonogirikab.go.id',
      params: { layanan_id: 1 },
    };
    expect(MulaiSesiInternalSchema.safeParse(internal).success).toBe(true);
    expect(MulaiSesiInternalSchema.safeParse({ ...internal, sidHash: 'raw-cookie' }).success).toBe(false);
  });

  it('endpoint pendamping terdaftar dan kode tutup WS di rentang aplikasi', () => {
    const paths = Object.values(ENDPOINT).map((e) => `${e.method} ${e.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'POST /api/urusan/[id]/pendamping',
        'GET /api/urusan/[id]/pendamping',
        'POST /api/urusan/[id]/pendamping/tiket',
        'POST /api/urusan/[id]/pendamping/serahkan',
        'DELETE /api/urusan/[id]/pendamping',
        'GET /api/pendamping/antrean',
      ]),
    );
    for (const code of Object.values(PENDAMPING_WS_CLOSE)) {
      expect(code).toBeGreaterThanOrEqual(4000);
      expect(code).toBeLessThan(5000);
    }
  });

  it('frame biner: encode/decode bolak-balik; versi/meta rusak -> null', () => {
    const meta = { lebar: 390, tinggi: 844, skala: 1, offsetAtas: 0, scrollX: 0, scrollY: 12 };
    const jpeg = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const buf = encodePendampingFrame(7, meta, jpeg);
    const back = decodePendampingFrame(buf.buffer.slice(0) as ArrayBuffer);
    expect(back?.seq).toBe(7);
    expect(back?.meta).toEqual(meta);
    expect([...back!.jpeg]).toEqual([...jpeg]);
    expect(decodePendampingFrame(Uint8Array.from([2, ...buf.subarray(1)]))).toBeNull();
    expect(decodePendampingFrame(new Uint8Array(4))).toBeNull();
    const rusak = encodePendampingFrame(1, { ...meta, lebar: -1 }, jpeg);
    expect(decodePendampingFrame(rusak)).toBeNull();
    const bukanJson = Uint8Array.from(buf);
    bukanJson[7] = 0x7b + 1;
    expect(decodePendampingFrame(bukanJson)).toBeNull();
    const tanpaJpeg = buf.subarray(0, 7 + new DataView(buf.buffer).getUint16(5));
    expect(decodePendampingFrame(tanpaJpeg)).toBeNull();
  });

  it('tambahan aditif N5: buka_tautan ber-ref tanpa URL; tautan ber-ref di giliran ketuk_tautan', () => {
    expect(PendampingClientMessageSchema.safeParse({ type: 'buka_tautan', ref: 'e12' }).success).toBe(true);
    for (const m of [{ type: 'buka_tautan' }, { type: 'buka_tautan', ref: 'https://a.go.id/x' }])
      expect(PendampingClientMessageSchema.safeParse(m).success).toBe(false);
    const giliran = (tautan: object) =>
      PendampingServerMessageSchema.safeParse({
        type: 'event',
        event: { jenis: 'giliran_anda', alasan: 'ketuk_tautan', pesan: 'p', tautan },
      }).success;
    const t = { ref: 'e3', nama: 'Daftar Akta Kelahiran', host: 'a.go.id', jalur: '/akta/baru' };
    expect(giliran(t)).toBe(true);
    expect(giliran({ ...t, ref: undefined })).toBe(false);
    expect(giliran({ ...t, nama: 'x'.repeat(81) })).toBe(false);
  });

  it('tambahan aditif N2: alasan serah dan giliran berhenti', () => {
    expect(AlasanSerahkanSchema.safeParse('berhenti').success).toBe(true);
    expect(
      PendampingServerMessageSchema.safeParse({
        type: 'event',
        event: { jenis: 'giliran_anda', alasan: 'berhenti', pesan: 'p' },
      }).success,
    ).toBe(true);
  });

  it('tambahan aditif: siaga, alasan masuk_akun/verifikasi_situs/isi_sendiri, bukti, ack, fokus', () => {
    expect(
      SesiPendampingSchema.safeParse({
        sesiId: 's',
        urusanId: 'u',
        executionId: 'x',
        status: 'siaga',
        mode: 'takeover',
        antrean: null,
        dibuatPada: '2026-11-09T00:00:00.000Z',
        kedaluwarsaPada: '2026-11-09T00:15:00.000Z',
        hasil: 'berhasil',
        bukti: { nomor: 'TS-UJI/0002', status: 'Baru diajukan' },
      }).success,
    ).toBe(true);
    for (const alasan of ['masuk_akun', 'verifikasi_situs', 'isi_sendiri', 'berkas_kurang'])
      expect(
        PendampingServerMessageSchema.safeParse({
          type: 'event',
          event: { jenis: 'giliran_anda', alasan, pesan: 'p' },
        }).success,
      ).toBe(true);
    const kurang = (berkas: unknown) =>
      PendampingServerMessageSchema.safeParse({
        type: 'event',
        event: { jenis: 'giliran_anda', alasan: 'berkas_kurang', pesan: 'p', berkas },
      }).success;
    expect(kurang({ nama: 'ktp', origin: 'https://telunjuksakti.wonogirikab.go.id' })).toBe(true);
    expect(kurang({ nama: '../x', origin: 'https://a.go.id' })).toBe(false);
    expect(kurang({ nama: 'ktp', origin: 'bukan url' })).toBe(false);
    expect(PendampingClientMessageSchema.safeParse({ type: 'ack', seq: 3 }).success).toBe(true);
    expect(PendampingServerMessageSchema.safeParse({ type: 'fokus', jenis: 'sandi' }).success).toBe(true);
    // Nomor bukti hanya karakter aman (tidak bisa membawa markup/instruksi panjang).
    expect(SesiPendampingSchema.shape.bukti.safeParse({ nomor: '<script>' }).success).toBe(false);
  });
});
