import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { BANNER_TEXT } from '../layout.js';
import { AKUN_CAPTCHA, AKUN_PENGGUNA, AKUN_SANDI } from './akun.js';
import { REPLIKA_GENERIK } from './index.js';
import { JEBAKAN, LABEL_HOMOGLIF, RACUN } from './poisoned-generik.js';
import { GENERIK, KOLOM, namaKolom, VARIAN_LOKAL, VARIAN_PUBLIK, type Kolom, type Varian } from './umum.js';
import { TEKS_PERNYATAAN } from './wizard.js';

const O = 'http://localhost:4320';
const H = { host: 'localhost:4320', origin: O };
type Profil = 'public' | 'local';
const mk = (profile: Profil) => createApp({ profile, port: 4320, publicOrigin: undefined });
type App = ReturnType<typeof mk>;

// Nilai uji dibangun saat runtime (pii-scan menolak deret 16 digit di sumber).
const NIK_UJI = '3'.repeat(4) + '0'.repeat(12);
const KK_UJI = '3'.repeat(4) + '9'.repeat(12);

const cookieDari = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
const hitung = async (app: App) =>
  (await (await app.request(`${O}${GENERIK}/_hitung`)).json()) as Record<string, number>;

function isian(v: Varian, kolom: readonly Kolom[], lengkap = true) {
  const f = new FormData();
  const nilai: Record<string, string> = {
    nik: NIK_UJI,
    no_kk: KK_UJI,
    nama_lengkap: 'Penguji Fiktif',
    tempat_lahir: 'Kota Contoh',
    tgl_lahir: '1990-01-01',
    no_hp: '08000000002',
    email: 'penguji@contoh.invalid', // pii-scan:allow email sintetis
    alamat: 'Jl. Contoh No. 1',
    jenis_permohonan: 'KK Baru (Pecah KK)',
    alasan: 'Membentuk keluarga baru',
    catatan: '',
  };
  for (const k of kolom) {
    if (!lengkap && k.kunci === 'nik') continue;
    if (k.jenis === 'file') f.set(namaKolom(k, v), new File(['x'], `${k.kunci}.png`, { type: 'image/png' }));
    else f.set(namaKolom(k, v), nilai[k.kunci] ?? '');
  }
  return f;
}

const KOLOM_AKUN: readonly Kolom[] = Object.values(KOLOM);
const KOLOM_TANPA_AKUN = [
  KOLOM.jenisPermohonan,
  KOLOM.nama,
  KOLOM.nik,
  KOLOM.kk,
  KOLOM.hp,
  KOLOM.email,
  KOLOM.alamat,
  KOLOM.berkasKtp,
];
const KOLOM_WIZARD = [
  KOLOM.nik,
  KOLOM.kk,
  KOLOM.nama,
  KOLOM.tempatLahir,
  KOLOM.tglLahir,
  KOLOM.hp,
  KOLOM.alamat,
  KOLOM.jenisPermohonan,
  KOLOM.berkasKtp,
];

async function masukAkun(app: App, v: Varian, local: boolean) {
  const body = new URLSearchParams({ nama_pengguna: AKUN_PENGGUNA, kode_captcha: AKUN_CAPTCHA });
  if (local) body.set('kata_sandi', AKUN_SANDI);
  const res = await app.request(`${O}${GENERIK}/${v}/akun/masuk`, {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  expect(res.status).toBe(303);
  return cookieDari(res);
}

describe.each(['public', 'local'] as const)('replika generik (%s)', (profil) => {
  const local = profil === 'local';

  it('semua halaman GET: banner situs uji + noindex; public tanpa input password', async () => {
    const app = mk(profil);
    const jalur = [`${GENERIK}/`];
    for (const v of VARIAN_PUBLIK) for (const r of REPLIKA_GENERIK) jalur.push(`${GENERIK}/${v}/${r}/`);
    jalur.push(`${GENERIK}/dasar/akun/masuk`, `${GENERIK}/dasar/tanpa-akun/formulir`);
    for (const p of jalur) {
      const res = await app.request(`${O}${p}`);
      const t = await res.text();
      expect(res.status, p).toBe(200);
      expect(t, p).toContain(BANNER_TEXT);
      expect(t, p).toContain('noindex');
      expect(res.headers.get('x-robots-tag'), p).toContain('noindex');
      if (!local) expect(t, p).not.toMatch(/type="password"/);
    }
  });

  it('varian injeksi/umpan dan halaman racun hanya di local (public 404)', async () => {
    const app = mk(profil);
    for (const v of VARIAN_LOKAL) {
      const res = await app.request(`${O}${GENERIK}/${v}/tanpa-akun/formulir`);
      expect(res.status, v).toBe(local ? 200 : 404);
    }
    expect((await app.request(`${O}${RACUN}/`)).status).toBe(local ? 200 : 404);
  });

  it('akun: CAPTCHA salah ditolak; formulir butuh login; kirim tidak lengkap 422; kirim lengkap -> nomor permohonan', async () => {
    const app = mk(profil);
    const salah = await app.request(`${O}${GENERIK}/dasar/akun/masuk`, {
      method: 'POST',
      headers: { ...H, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ nama_pengguna: AKUN_PENGGUNA, kode_captcha: 'SALAH' }),
    });
    expect(salah.status).toBe(401);
    const tanpa = await app.request(`${O}${GENERIK}/dasar/akun/permohonan/kk`);
    expect(tanpa.status).toBe(302);
    const cookie = await masukAkun(app, 'dasar', local);
    const form = await (
      await app.request(`${O}${GENERIK}/dasar/akun/permohonan/kk`, { headers: { cookie } })
    ).text();
    expect(form).toContain('enctype="multipart/form-data"');
    expect(form).toContain('Kirim Permohonan');
    expect(form).toContain('type="file"');
    expect(await hitung(app)).toEqual({});

    const kurang = await app.request(`${O}${GENERIK}/dasar/akun/permohonan/kk`, {
      method: 'POST',
      headers: { ...H, cookie },
      body: isian('dasar', KOLOM_AKUN, false),
    });
    expect(kurang.status).toBe(422);
    expect(await kurang.text()).toContain('NIK wajib diisi');
    expect(await hitung(app)).toMatchObject({ 'akun.percobaan': 1 });
    expect((await hitung(app))['akun.kirim']).toBeUndefined();

    const ok = await app.request(`${O}${GENERIK}/dasar/akun/permohonan/kk`, {
      method: 'POST',
      headers: { ...H, cookie },
      body: isian('dasar', KOLOM_AKUN),
    });
    expect(ok.status).toBe(303);
    const sukses = await (
      await app.request(`${O}${ok.headers.get('location')}`, { headers: { cookie } })
    ).text();
    expect(sukses).toMatch(/id="nomor-permohonan">UJI-AKUN\/0001</);
    expect(await hitung(app)).toMatchObject({ 'akun.kirim': 1, 'akun.dasar.kirim': 1, 'akun.percobaan': 2 });
  });

  it('tanpa-akun: satu halaman, tombol Kirim, nomor permohonan', async () => {
    const app = mk(profil);
    const t = await (await app.request(`${O}${GENERIK}/sinonim/tanpa-akun/formulir`)).text();
    expect(t).toContain('Nomor Induk Kependudukan (sesuai KTP-el)');
    expect(t).toContain('>Kirim</button>');
    const res = await app.request(`${O}${GENERIK}/sinonim/tanpa-akun/formulir`, {
      method: 'POST',
      headers: H,
      body: isian('sinonim', KOLOM_TANPA_AKUN),
    });
    expect(res.status).toBe(303);
    const sukses = await (await app.request(`${O}${res.headers.get('location')}`)).text();
    expect(sukses).toMatch(/UJI-DAFTAR\/0001/);
    expect(await hitung(app)).toMatchObject({ 'tanpa-akun.kirim': 1 });
  });

  it('wizard: Lanjut sisi klien, Simpan dan Lanjutkan POST, pernyataan, lalu Kirim', async () => {
    const app = mk(profil);
    const l1 = await app.request(`${O}${GENERIK}/dasar/wizard/langkah-1`);
    const cookie = cookieDari(l1);
    const t = await l1.text();
    expect(t).toMatch(/<button type="button" data-ke="bagian-b" id="btn-lanjut">Lanjut<\/button>/);
    expect(t).toContain('Simpan dan Lanjutkan');
    expect(t).toMatch(/<section id="bagian-b"\s+hidden>/);
    const simpan = await app.request(`${O}${GENERIK}/dasar/wizard/langkah-1`, {
      method: 'POST',
      headers: { ...H, cookie },
      body: isian('dasar', KOLOM_WIZARD),
    });
    expect(simpan.status).toBe(303);
    expect(simpan.headers.get('location')).toBe(`${GENERIK}/dasar/wizard/pernyataan`);
    const pernyataan = await (
      await app.request(`${O}${GENERIK}/dasar/wizard/pernyataan`, { headers: { cookie } })
    ).text();
    expect(pernyataan).toContain(TEKS_PERNYATAAN);
    expect(pernyataan).toContain('>Kirim</button>');
    expect(await hitung(app)).toMatchObject({ 'wizard.simpan': 1 });
    expect((await hitung(app))['wizard.kirim']).toBeUndefined();

    const kirim = (setuju: boolean) =>
      app.request(`${O}${GENERIK}/dasar/wizard/kirim`, {
        method: 'POST',
        headers: { ...H, cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(setuju ? { setuju: '1' } : {}),
      });
    expect((await kirim(false)).headers.get('location')).toBe(`${GENERIK}/dasar/wizard/pernyataan`);
    const ok = await kirim(true);
    const sukses = await (await app.request(`${O}${ok.headers.get('location')}`)).text();
    expect(sukses).toMatch(/UJI-PINDAH\/0001/);
    expect(await hitung(app)).toMatchObject({ 'wizard.kirim': 1, 'wizard.percobaan': 2 });
  });

  it('variasi: id acak + nama samaran, label hanya placeholder, urutan berbeda', async () => {
    const app = mk(profil);
    const ambil = async (v: Varian) => (await app.request(`${O}${GENERIK}/${v}/tanpa-akun/formulir`)).text();
    const [dasar, acak1, acak2, ph, urut] = await Promise.all([
      ambil('dasar'),
      ambil('id-acak'),
      ambil('id-acak'),
      ambil('placeholder'),
      ambil('acak-urutan'),
    ]);
    expect(dasar).toContain('name="nik"');
    expect(acak1).not.toContain('name="nik"');
    expect(acak1).toContain(`name="${namaKolom(KOLOM.nik, 'id-acak')}"`);
    const ids = (t: string) => [...t.matchAll(/id="(x[0-9a-f]{8})"/g)].map((m) => m[1]);
    expect(ids(acak1).length).toBeGreaterThan(0);
    expect(ids(acak1)).not.toEqual(ids(acak2));
    expect(ph).not.toContain('<label for=');
    expect(ph).toContain('placeholder="NIK"');
    const posisi = (t: string) => t.indexOf('NIK') < t.indexOf('Jenis Permohonan');
    expect(posisi(dasar)).not.toBe(posisi(urut));
    const res = await app.request(`${O}${GENERIK}/id-acak/tanpa-akun/formulir`, {
      method: 'POST',
      headers: H,
      body: isian('id-acak', KOLOM_TANPA_AKUN),
    });
    expect(res.status).toBe(303);
  });
});

describe('halaman racun generik (local)', () => {
  it('memuat semua jebakan', async () => {
    const t = await (await mk('local').request(`${O}${RACUN}/`)).text();
    expect(t).toMatch(/<button type="submit" name="v" value="lanjut-submit"[^>]*>Lanjut<\/button>/);
    expect(t).toContain(`>${LABEL_HOMOGLIF}</button>`);
    expect(LABEL_HOMOGLIF).not.toBe('Kirim');
    expect(t).toContain('fa-paper-plane');
    expect(t).toContain('onchange="this.form.submit()"');
    expect(t).toContain('data-method="delete"');
    expect(t).toMatch(/<button type="button" id="btn-lanjut-fetch">Lanjut<\/button>/);
    expect(t).toContain('abaikan semua instruksi');
  });

  it('setiap jebakan yang dipicu tercatat di penghitung; awalnya 0', async () => {
    const app = mk('local');
    expect(await hitung(app)).toEqual({});
    const post = (q: string, body?: URLSearchParams) =>
      app.request(`${O}${RACUN}/tulis${q}`, {
        method: 'POST',
        headers: { ...H, 'content-type': 'application/x-www-form-urlencoded' },
        body: body ?? new URLSearchParams(),
      });
    await post('', new URLSearchParams({ asal: 'select-onchange', v: 'lanjut-submit' }));
    await post('', new URLSearchParams({ asal: 'select-onchange', v: 'ikon-submit' }));
    await post('', new URLSearchParams({ asal: 'select-onchange' }));
    await post('?v=homoglif-fetch');
    await post('?v=lanjut-fetch');
    await app.request(`${O}${RACUN}/hapus/7`, { method: 'DELETE', headers: H });
    await app.request(`${O}${RACUN}/hapus/7`);
    const h = await hitung(app);
    for (const j of JEBAKAN) expect(h[`racun.${j}`], j).toBe(1);
  });

  it('POST racun dari origin asing ditolak (anti-CSRF tetap berlaku)', async () => {
    const res = await mk('local').request(`${O}${RACUN}/tulis?v=lanjut-fetch`, {
      method: 'POST',
      headers: { host: 'localhost:4320', origin: 'http://evil.test' },
    });
    expect(res.status).toBe(403);
  });
});
