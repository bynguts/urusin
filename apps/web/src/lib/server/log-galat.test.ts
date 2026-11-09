import { describe, expect, it } from 'vitest';
import { catatGalatApi, ringkasGalatApi } from './log-galat';

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('log galat API', () => {
  it('mencatat pola rute, status, dan kode; tanpa id urusan atau pesanWarga', async () => {
    const baris: string[] = [];
    await catatGalatApi(
      'POST',
      '/api/urusan/[id]/pendamping',
      jsonRes(503, { kode: 'PENDAMPING_WILAYAH_TIDAK_TERSEDIA', pesanWarga: 'Situs ini hanya bisa…' }),
      (b) => baris.push(b),
    );
    expect(baris).toEqual([
      '[api-galat] {"metode":"POST","rute":"/api/urusan/[id]/pendamping","status":503,"kode":"PENDAMPING_WILAYAH_TIDAK_TERSEDIA"}',
    ]);
    expect(baris[0]).not.toContain('Situs');
  });

  it('tidak mencatat respons sukses atau rute non-API', async () => {
    expect(await ringkasGalatApi('GET', '/api/ready', jsonRes(200, { ok: true }))).toBeNull();
    expect(await ringkasGalatApi('GET', '/beranda', jsonRes(404, { kode: 'NOT_FOUND' }))).toBeNull();
    expect(await ringkasGalatApi('GET', null, jsonRes(404, { kode: 'NOT_FOUND' }))).toBeNull();
  });

  it('kode yang tidak berbentuk konstanta (bisa berisi data) dibuang; body non-JSON aman', async () => {
    expect(await ringkasGalatApi('POST', '/api/urusan', jsonRes(422, { kode: 'budi@contoh x' }))).toEqual({
      metode: 'POST',
      rute: '/api/urusan',
      status: 422,
      kode: null,
    });
    const teks = new Response('oops', { status: 500, headers: { 'content-type': 'application/json' } });
    expect((await ringkasGalatApi('GET', '/api/urusan', teks))?.kode).toBeNull();
  });

  it('respons asli tetap bisa dibaca setelah dicatat', async () => {
    const res = jsonRes(409, { kode: 'KONFLIK' });
    await catatGalatApi('POST', '/api/urusan/[id]/turn', res, () => {});
    expect(await res.json()).toEqual({ kode: 'KONFLIK' });
  });
});
