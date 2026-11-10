import http from 'node:http';
import type net from 'node:net';
import { expect, test } from '@playwright/test';
import type { Pengamatan } from '@urusin/contracts';
import { createBrowserFactory } from '../src/browser.js';
import { loadConfig } from '../src/config.js';
import { ADAPTER_GENERIK, SessionManager, sidHashOf } from '../src/sessions.js';

/**
 * Navigator generik ujung ke ujung di worker: Chromium nyata, runner op `amati`/`aksi` sungguhan (klasifikator
 * di halaman), gerbang tulis di `context.route`, terhadap situs uji lokal yang MENGHITUNG setiap permintaan tulis
 * yang sampai. Otak (LLM) diganti rencana tetap: yang diuji adalah pertahanan worker, bukan model.
 */

const SID = sidHashOf('n'.repeat(32));
const RESMI = 'https://telunjuksakti.wonogirikab.go.id';
const H1 = 'e'.repeat(64);
const H2 = 'f'.repeat(64);
const PH = '{{PEMOHON.NAMA_LENGKAP}}';
const NILAI = 'Warga Uji Sintetis';

const FORMULIR = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Formulir uji</title></head><body>
<h1>Permohonan layanan</h1>
<p role="alert" id="gema"></p>
<form method="post" action="/kirim">
  <label for="nama">Nama lengkap</label><input id="nama" name="nama" type="text">
  <input id="npwp" name="npwp" type="checkbox"><label for="npwp" id="lnpwp">Punya NPWP</label>
  <button type="submit" id="kirim">Lanjut</button>
</form>
<button type="button" id="lanjut">Lanjut</button>
<a href="/layanan/kk">Daftar Layanan</a>
<script>
  document.getElementById('lanjut').addEventListener('click', () => fetch('/simpan', { method: 'POST', body: 'x' }).catch(() => {}));
  document.getElementById('nama').addEventListener('input', (e) => {
    document.getElementById('gema').textContent = 'Halo ' + e.target.value;
    document.getElementById('lnpwp').textContent = 'Punya NPWP aktif';
  });
</script>
</body></html>`;

const AKHIR = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Tinjau permohonan</title></head><body>
<h1>Tinjau permohonan</h1><p>Dengan ini saya menyatakan bahwa data yang saya isi adalah benar.</p>
<button type="button" id="lanjut2">Lanjut</button></body></html>`;

async function situsUji() {
  const hitung = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const jalur = new URL(req.url ?? '/', 'http://x').pathname;
    if (req.method !== 'GET') hitung.set(jalur, (hitung.get(jalur) ?? 0) + 1);
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(jalur === '/layanan/kk' ? AKHIR : FORMULIR);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    origin: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    hitung: (j: string) => hitung.get(j) ?? 0,
    tutup: () => new Promise<void>((r) => server.close(() => r())),
  };
}

function cari(p: Pengamatan, nama: string, peran: string) {
  const e = p.elemen.find((x) => x.nama === nama && x.peran === peran);
  if (!e) throw new Error(`elemen ${peran} "${nama}" tidak teramati: ${JSON.stringify(p.elemen)}`);
  return e;
}

test('generik: submit ditolak, isi butuh izin, REF_BASI, fetch POST diblokir -> warga, kunci halaman akhir', async () => {
  const situs = await situsUji();
  const config = loadConfig({
    PENDAMPING_FIXTURE_ORIGINS: situs.origin,
    PENDAMPING_ORIGIN_OVERRIDES: `${RESMI}=${situs.origin}`,
    PENDAMPING_HEADLESS: '1',
  });
  const manager = new SessionManager(config, createBrowserFactory(config));
  const o = { urusanId: 'u-generik', sidHash: SID };
  try {
    const sesi = await manager.create({
      ...o,
      executionId: 'x_generik',
      adapterId: ADAPTER_GENERIK,
      flowId: 'navigator',
      origin: RESMI,
      params: { jalur: '/formulir' },
      modeUji: true,
    });
    await expect.poll(() => manager.status(o).status, { timeout: 30_000 }).toBe('berjalan');
    const a1 = await manager.amati(o);
    expect(a1.mode).toBe('ai');
    const p = a1.pengamatan;
    expect(p.jalur).toBe('/formulir');
    expect(p.sinyal.halamanAkhir).toBe(false);
    // Peta ref (jalur CSS, sidik) tidak pernah keluar dari worker.
    expect(JSON.stringify(p)).not.toMatch(/nth-of-type|"jalur":"[^/]/);
    const submit = p.elemen.find((e) => e.peran === 'tombol' && e.kelas === 'kirim');
    const lanjut = p.elemen.find((e) => e.peran === 'tombol' && e.kelas === 'lanjut');
    expect(submit, JSON.stringify(p.elemen)).toBeDefined();
    expect(lanjut, JSON.stringify(p.elemen)).toBeDefined();
    const nama = cari(p, 'Nama lengkap', 'teks');
    const npwp = cari(p, 'Punya NPWP', 'centang');
    const tautan = cari(p, 'Daftar Layanan', 'tautan');
    expect(tautan.kelas).toBe('navigasi');

    // 1) Klik AI pada tombol submit asli (bertuliskan "Lanjut"): ditolak di halaman, tidak ada POST.
    const r1 = await manager.aksi(o, {
      ...o,
      rencanaHash: H1,
      seq: p.seq,
      aksi: [{ jenis: 'klik', ref: submit!.ref }],
    });
    expect(r1.hasil).toEqual([{ indeks: 0, kode: 'KELAS_DITOLAK', kelas: 'kirim' }]);

    // 2) Isi tanpa persetujuan: BELUM_DISETUJUI, tidak ada yang dijalankan, sesi menunggu lembar izin.
    const rencana = {
      ...o,
      rencanaHash: H2,
      seq: p.seq,
      aksi: [
        { jenis: 'isi' as const, ref: nama.ref, nilai: PH },
        { jenis: 'centang' as const, ref: npwp.ref, nilai: true },
      ],
    };
    const r2 = await manager.aksi(o, rencana);
    expect(r2.hasil).toEqual([
      { indeks: 0, kode: 'BELUM_DISETUJUI' },
      { indeks: 1, kode: 'DILEWATI' },
    ]);
    expect(manager.status(o).status).toBe('menunggu_data');
    expect(manager.butuhData(o)).toMatchObject({
      placeholder: [PH],
      kolom: [{ placeholder: PH, labelPortal: 'Nama lengkap' }],
      rencanaHash: H2,
    });
    await expect(manager.isiData(o, { [PH]: NILAI }, H1)).rejects.toMatchObject({ status: 409 });
    await manager.isiData(o, { [PH]: NILAI }, H2);
    expect(manager.status(o).status).toBe('berjalan');

    // 3) Rencana yang sama dikirim ulang: isi lolos; label kotak centang berubah oleh skrip halaman -> REF_BASI.
    const r3 = await manager.aksi(o, rencana);
    expect(r3.hasil).toEqual([
      { indeks: 0, kode: 'ok' },
      { indeks: 1, kode: 'REF_BASI' },
    ]);
    const a2 = await manager.amati(o);
    expect(cari(a2.pengamatan, 'Nama lengkap', 'teks').isian).toBe(PH);
    // Situs menggemakan nilai di teks halaman: tidak pernah keluar mentah (runner menyamarkan nilai field,
    // worker mengganti nilai vault dengan token; lapis worker diuji properti di generik.test.ts).
    expect(JSON.stringify(a2)).not.toContain(NILAI);
    expect(a2.pengamatan.teks).toContain('Halo');

    // 4) type=button "Lanjut" yang handlernya fetch POST: kelas lanjut, gerbang membatalkan, warga mengambil alih.
    const r4 = await manager.aksi(o, {
      ...o,
      rencanaHash: H1,
      seq: a2.pengamatan.seq,
      aksi: [{ jenis: 'klik', ref: a2.pengamatan.elemen.find((e) => e.kelas === 'lanjut')!.ref }],
    });
    expect(r4).toEqual({
      mode: 'takeover',
      hasil: [{ indeks: 0, kode: 'GERBANG_MEMBLOKIR', kelas: 'lanjut' }],
    });
    expect(situs.hitung('/simpan')).toBe(0);
    expect(situs.hitung('/kirim')).toBe(0);
    const jejak = manager.kurasJejak(o).catatan;
    expect(jejak).toContainEqual(
      expect.objectContaining({ jenis: 'blokir', metode: 'POST', jendela: 'ai_klik' }),
    );
    expect(jejak).toContainEqual(
      expect.objectContaining({ jenis: 'klik', kelas: 'kirim', putusan: 'tolak' }),
    );
    expect(jejak).toContainEqual({ jenis: 'persetujuan', rencanaHash: H2, n: 1 });
    expect(JSON.stringify(jejak)).not.toContain(NILAI);
    // Selama warga memegang kendali AI tidak menjalankan apa pun.
    const r5 = await manager.aksi(o, { ...o, rencanaHash: H1, aksi: [{ jenis: 'klik', ref: tautan.ref }] });
    expect(r5.hasil).toEqual([{ indeks: 0, kode: 'DILEWATI' }]);

    // 5) Warga mengembalikan kendali; AI membuka tautan GET (Page.navigate setelah allowlist).
    await manager.handleClient(sesi.sesiId, { type: 'kembalikan' });
    expect((await manager.tunggu(o, 1000)).mode).toBe('ai');
    const a3 = await manager.amati(o);
    const r6 = await manager.aksi(o, {
      ...o,
      rencanaHash: H1,
      seq: a3.pengamatan.seq,
      aksi: [{ jenis: 'klik', ref: cari(a3.pengamatan, 'Daftar Layanan', 'tautan').ref }],
    });
    expect(r6.hasil).toEqual([{ indeks: 0, kode: 'ok', kelas: 'navigasi' }]);

    // 6) Halaman tinjauan/pernyataan: kunci halaman akhir, klik apa pun = HALAMAN_AKHIR.
    const a4 = await manager.amati(o);
    expect(a4.pengamatan.jalur).toBe('/layanan/kk');
    expect(a4.pengamatan.sinyal.halamanAkhir).toBe(true);
    const r7 = await manager.aksi(o, {
      ...o,
      rencanaHash: H1,
      seq: a4.pengamatan.seq,
      aksi: [{ jenis: 'klik', ref: cari(a4.pengamatan, 'Lanjut', 'tombol').ref }],
    });
    expect(r7.hasil).toEqual([{ indeks: 0, kode: 'HALAMAN_AKHIR' }]);
    expect(situs.hitung('/kirim') + situs.hitung('/simpan')).toBe(0);
  } finally {
    await manager.shutdown();
    await situs.tutup();
  }
});
