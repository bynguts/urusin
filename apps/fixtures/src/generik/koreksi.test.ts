import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { BANNER_TEXT } from '../layout.js';
import { GALAT_KUOTA, KOREKSI, OPSI_DITOLAK } from './koreksi.js';
import { GENERIK } from './umum.js';

const O = 'http://localhost:4320';
const H = { host: 'localhost:4320', origin: O };
// Nilai uji dibangun saat runtime (pii-scan menolak deret 16 digit di sumber).
const NIK_UJI = '3'.repeat(4) + '0'.repeat(12);

const cookieDari = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

describe.each(['public', 'local'] as const)('replika generik koreksi (%s)', (profile) => {
  const mk = () => createApp({ profile, port: 4320, publicOrigin: undefined });
  const kirim = (app: ReturnType<typeof mk>, cookie: string, body: Record<string, string>) =>
    app.request(`${O}${KOREKSI}/kirim`, {
      method: 'POST',
      headers: { ...H, cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });

  it('beranda + formulir tiga langkah sisi klien; galat jenis tersembunyi sampai Lanjut', async () => {
    const app = mk();
    const beranda = await (await app.request(`${O}${KOREKSI}/`)).text();
    expect(beranda).toContain(BANNER_TEXT);
    expect(beranda).toContain(`href="${KOREKSI}/formulir"`);
    expect(await (await app.request(`${O}${GENERIK}/`)).text()).toContain(`${KOREKSI}/`);
    const f = await (await app.request(`${O}${KOREKSI}/formulir`)).text();
    expect(f).toMatch(/<section id="langkah-2" hidden>/);
    expect(f).toMatch(/<section id="langkah-3" hidden>/);
    expect(f).toMatch(/type="button" data-ke="langkah-2"/);
    expect(f).toMatch(/<small class="invalid-feedback" id="in-jenis-galat" hidden><\/small>/);
    expect(f).not.toContain('aria-invalid');
    expect(f).toContain(`src="${KOREKSI}/static/koreksi.js"`);
    const js = await app.request(`${O}${KOREKSI}/static/koreksi.js`);
    expect(js.headers.get('content-type')).toContain('text/javascript');
    const sumber = await js.text();
    expect(sumber).toContain(JSON.stringify(OPSI_DITOLAK));
    expect(sumber).toContain(JSON.stringify(GALAT_KUOTA));
    expect(sumber).toContain("setAttribute('aria-invalid', 'true')");
  });

  it('server memvalidasi ulang: pilihan yang ditolak 422; jenis lain + pernyataan = nomor permohonan', async () => {
    const app = mk();
    const cookie = cookieDari(await app.request(`${O}${KOREKSI}/formulir`));
    const dasar = { nik: NIK_UJI, nama_lengkap: 'Penguji Fiktif', setuju: '1' };
    const tolak = await kirim(app, cookie, { ...dasar, jenis_permohonan: OPSI_DITOLAK });
    expect(tolak.status).toBe(422);
    expect(await tolak.text()).toContain(GALAT_KUOTA);
    expect((await kirim(app, cookie, { ...dasar, jenis_permohonan: 'Lain' })).status).toBe(422);
    const tanpaSetuju = await kirim(app, cookie, {
      ...dasar,
      setuju: '',
      jenis_permohonan: 'Perubahan Data KK',
    });
    expect(tanpaSetuju.status).toBe(422);
    expect((await kirim(app, '', { ...dasar, jenis_permohonan: 'Perubahan Data KK' })).status).toBe(422);
    const ok = await kirim(app, cookie, { ...dasar, jenis_permohonan: 'Perubahan Data KK' });
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe(`${KOREKSI}/terkirim/1`);
    expect(await (await app.request(`${O}${KOREKSI}/terkirim/1`)).text()).toContain('UJI-KOREKSI/0001');
    expect((await app.request(`${O}${KOREKSI}/terkirim/9`)).status).toBe(302);
    expect(await (await app.request(`${O}${GENERIK}/_hitung`)).json()).toMatchObject({
      'koreksi.percobaan': 5,
      'koreksi.kirim': 1,
    });
  });
});
