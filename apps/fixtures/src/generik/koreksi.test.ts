import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { BANNER_TEXT } from '../layout.js';
import { GALAT_KUOTA, KOREKSI, OPSI_DITOLAK } from './koreksi.js';
import { GENERIK } from './umum.js';

const O = 'http://localhost:4320';
const H = { host: 'localhost:4320', origin: O };
const FORM = { ...H, 'content-type': 'application/x-www-form-urlencoded' };
// Nilai uji dibangun saat runtime (pii-scan menolak deret 16 digit di sumber).
const NIK_UJI = '3'.repeat(4) + '0'.repeat(12);

const cookieDari = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
const post = (
  app: ReturnType<typeof createApp>,
  jalur: string,
  cookie: string,
  body: Record<string, string>,
) =>
  app.request(`${O}${KOREKSI}/${jalur}`, {
    method: 'POST',
    headers: { ...FORM, cookie },
    body: new URLSearchParams(body),
  });

describe.each(['public', 'local'] as const)('replika generik koreksi (%s)', (profile) => {
  it('menolak pilihan pertama dengan galat di samping kolom, menerima pilihan lain, final milik warga', async () => {
    const app = createApp({ profile, port: 4320, publicOrigin: undefined });
    const beranda = await (await app.request(`${O}${KOREKSI}/`)).text();
    expect(beranda).toContain(BANNER_TEXT);
    expect(beranda).toContain(`href="${KOREKSI}/langkah-1"`);
    expect(await (await app.request(`${O}${GENERIK}/`)).text()).toContain(`${KOREKSI}/`);

    // Langkah 2/3 tanpa sesi: kembali ke langkah 1.
    expect((await app.request(`${O}${KOREKSI}/langkah-2`)).status).toBe(302);
    const l1 = await app.request(`${O}${KOREKSI}/langkah-1`);
    const cookie = cookieDari(l1);
    expect(await l1.text()).toContain('Simpan dan Lanjutkan');
    expect((await post(app, 'langkah-1', cookie, { nik: NIK_UJI })).status).toBe(422);
    const ok1 = await post(app, 'langkah-1', cookie, { nik: NIK_UJI, nama_lengkap: 'Penguji Fiktif' });
    expect(ok1.status).toBe(303);
    expect(ok1.headers.get('location')).toBe(`${KOREKSI}/langkah-2`);
    const l2 = await (await app.request(`${O}${KOREKSI}/langkah-2`, { headers: { cookie } })).text();
    expect(l2).not.toContain('aria-invalid');

    expect((await post(app, 'langkah-2', cookie, {})).status).toBe(422);
    const tolak = await post(app, 'langkah-2', cookie, { jenis_permohonan: OPSI_DITOLAK });
    expect(tolak.status).toBe(422);
    const t = await tolak.text();
    expect(t).toContain(GALAT_KUOTA);
    expect(t).toMatch(/aria-invalid="true" aria-errormessage="in-jenis-galat"/);
    expect(t).toMatch(/class="invalid-feedback" id="in-jenis-galat"/);
    expect(t).toMatch(new RegExp(`<option value="${OPSI_DITOLAK.replace(/[()]/g, '\\$&')}" selected>`));
    // Pernyataan belum terbuka sebelum jenis yang sah dipilih.
    expect((await app.request(`${O}${KOREKSI}/pernyataan`, { headers: { cookie } })).status).toBe(302);

    const ok2 = await post(app, 'langkah-2', cookie, { jenis_permohonan: 'Perubahan Data KK' });
    expect(ok2.headers.get('location')).toBe(`${KOREKSI}/pernyataan`);
    const pernyataan = await (await app.request(`${O}${KOREKSI}/pernyataan`, { headers: { cookie } })).text();
    expect(pernyataan).toContain('id="btn-kirim"');

    expect((await post(app, 'kirim', cookie, {})).headers.get('location')).toBe(`${KOREKSI}/pernyataan`);
    const kirim = await post(app, 'kirim', cookie, { setuju: '1' });
    expect(kirim.headers.get('location')).toBe(`${KOREKSI}/terkirim/1`);
    expect(await (await app.request(`${O}${KOREKSI}/terkirim/1`)).text()).toContain('UJI-KOREKSI/0001');
    expect((await app.request(`${O}${KOREKSI}/terkirim/9`)).status).toBe(302);
    expect(await (await app.request(`${O}${GENERIK}/_hitung`)).json()).toMatchObject({
      'koreksi.tolak': 1,
      'koreksi.percobaan': 2,
      'koreksi.kirim': 1,
    });
  });
});
