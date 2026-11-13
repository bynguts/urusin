import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readBody } from './http';

const req = (body: unknown) =>
  new Request('http://x/api', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
// Nomor HP sintetis dirakit saat uji agar pemindai PII repo tidak menandai berkas ini.
const HP = ['08', '1234', '567', '890'].join('');
const Skema = z.object({ executionId: z.string().optional(), teks: z.string().optional() }).passthrough();

describe('readBody: pemindaian PII vs id buram buatan server', () => {
  it('executionId UUID yang kebetulan berpola nomor HP tidak ditolak (sapu r2 Depok KIA)', async () => {
    const r = await readBody(
      req({ executionId: 'x_d744d082-7115-4286-8fc4-48bad27599c8', viewport: { lebar: 390 } }),
      Skema,
    );
    expect(r.ok).toBe(true);
  });

  it('id buram hex32 (u_/c_) pada bidang ...Id dilewati', async () => {
    const r = await readBody(req({ urusanId: 'u_0812345678901234abcdef0123456789' }), Skema);
    expect(r.ok).toBe(true);
  });

  it('nomor HP di teks bebas tetap ditolak 422', async () => {
    const r = await readBody(req({ teks: `hubungi ${HP}` }), Skema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(422);
  });

  it('bidang ...Id yang BUKAN berbentuk id buram tetap dipindai', async () => {
    const r = await readBody(req({ executionId: HP }), Skema);
    expect(r.ok).toBe(false);
    const r2 = await readBody(req({ executionId: `x_${HP} nomor saya` }), Skema);
    expect(r2.ok).toBe(false);
  });

  it('lewatiBidang: data URL gambar tidak dipindai, teks di sampingnya tetap dipindai', async () => {
    const S = z.object({ teks: z.string(), gambar: z.array(z.string()) });
    // base64 yang kebetulan memuat deret berpola nomor HP tidak boleh membuat pesan bergambar ditolak.
    const gambar = [`data:image/jpeg;base64,AAAA/${HP}/AAAA`];
    expect((await readBody(req({ teks: 'ini apa?', gambar }), S, { lewatiBidang: ['gambar'] })).ok).toBe(
      true,
    );
    expect((await readBody(req({ teks: 'ini apa?', gambar }), S)).ok).toBe(false);
    const r = await readBody(req({ teks: `hubungi ${HP}`, gambar }), S, { lewatiBidang: ['gambar'] });
    expect(r.ok).toBe(false);
  });

  it('id buram di bidang bukan ...Id tetap dipindai', async () => {
    const r = await readBody(req({ teks: 'x_d744d082-7115-4286-8fc4-48bad27599c8' }), Skema);
    expect(r.ok).toBe(false);
  });
});
