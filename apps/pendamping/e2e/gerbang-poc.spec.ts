import http from 'node:http';
import type net from 'node:net';
import { expect, test } from '@playwright/test';
import type { Pengamatan, PendampingEvent, PendampingServerMessage } from '@urusin/contracts';
import { createBrowserFactory } from '../src/browser.js';
import { loadConfig } from '../src/config.js';
import { ADAPTER_GENERIK, SessionManager, sidHashOf } from '../src/sessions.js';

/**
 * Regresi PoC review keamanan Navigator generik (F1-F5) di Chromium nyata lewat SessionManager: worker, runner
 * op amati/aksi, gerbang tulis, dan situs uji lokal yang MENGHITUNG setiap permintaan tulis yang sampai.
 * Tidak menyentuh situs asli.
 */

const SID = sidHashOf('p'.repeat(32));
const RESMI = 'https://telunjuksakti.wonogirikab.go.id';
const H = 'a'.repeat(64);

const kerangka = (isi: string) =>
  `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Uji</title></head><body>${isi}</body></html>`;

const HALAMAN: Record<string, string> = {
  // F1 (poc-retry): klik AI "Lanjut" type=button -> fetch POST dengan retry; "Kirim saya" untuk ketukan warga.
  '/retry': kerangka(`<style>#warga{position:fixed;left:0;top:300px;width:240px;height:100px}</style>
<label>Nama <input name="nama"></label><button type="button" id="b">Lanjut</button>
<button type="button" id="warga" onclick="fetch('/api/warga',{method:'POST',body:'x'})">Kirim saya</button>
<script>document.getElementById('b').addEventListener('click', async () => {
  for (let i = 0; i < 6; i++) {
    try { await fetch('/api/ajukan', { method: 'POST', body: 'final=1' }); document.title = 'TERKIRIM'; return; }
    catch (e) { await new Promise((r) => setTimeout(r, 400)); }
  }
});</script>`),
  // F2 (poc /s2): pilih memicu form POST ke iframe; dan sendBeacon dari onchange.
  '/s2': kerangka(`<form method="post" action="/ajukan" target="sink"><label>Jenis layanan
<select name="jenis" onchange="this.form.submit()"><option value="">--</option><option value="kk">KK</option></select></label></form>
<iframe name="sink" style="width:1px;height:1px"></iframe>`),
  '/beacon': kerangka(`<label>Jenis layanan
<select name="jenis" onchange="navigator.sendBeacon('/beacon-kirim', 'x')"><option value="">--</option><option value="kk">KK</option></select></label>`),
  // F3 + F4 (poc-tautan, /s1, /s1b, /s3) dalam satu halaman tanpa pernyataan.
  '/kelas': kerangka(`<a href="/permohonan/12/ajukan">Ajukan Permohonan</a>
<a href="/pendaftaran/proses?id=12">Daftar Sekarang</a>
<a href="/permohonan/12/final">Proses Permohonan</a>
<a href="/akta/register/12">Register</a>
<a href="/layanan/kk">Daftar Layanan</a>
<form method="post" action="/ajukan"><label>Nama <input name="nama"></label>
  <button type="submit" class="btn"><span role="button">Lanjut</span></button></form>
<form method="post" action="/ajukan"><label>Alamat <input name="alamat"></label>
  <label for="k" role="button" class="btn">Lanjut</label>
  <button id="k" type="submit" style="position:absolute;left:-9999px;top:0">x</button></form>
<form method="get" action="/permohonan/kirim" target="sink"><label>Telepon <input name="tel"></label>
  <button><span role="button">Lanjut</span></button></form>
<iframe name="sink" style="width:1px;height:1px"></iframe>`),
  // Tautan pembuka: kirim hanya karena nama -> serah ketuk_tautan, warga mengetuk, AI lanjut.
  '/beranda': kerangka(`<style>a{display:block;padding:20px}</style><h1>Layanan Online</h1>
<a href="/permohonan/kk">Ajukan Permohonan Kartu Keluarga</a>
<a href="/permohonan/12/ajukan">Ajukan Sekarang</a>`),
  // F5 (poc /s4): pernyataan terselubung + checkbox non-data.
  // H3: halaman sukses setelah warga menekan Kirim sendiri.
  '/sukses': kerangka(
    '<h1>Permohonan berhasil dikirim</h1><div class="alert alert-success">Nomor registrasi: REG-2026-0001</div>',
  ),
  // F6: halaman membuka WebSocket (mis. socket.io) dan mengirim lewat situ.
  '/ws': kerangka(`<h1>Formulir</h1><script>
  const ws = new WebSocket('ws://' + location.host + '/ws');
  ws.onopen = () => ws.send('kirim=1');
  ws.onclose = (e) => { document.title = 'ws-tutup-' + e.code; };
</script>`),
  '/s4':
    kerangka(`<form><label><input type="checkbox" name="ok"> Data di atas sudah benar dan saya pahami konsekuensinya</label>
<label><input type="checkbox" name="kabar"> Kirimi saya kabar</label>
<label><input type="checkbox" name="sama"> Alamat domisili sama dengan KTP</label>
<label>Nama <input name="nama"></label></form>`),
};

async function situsUji() {
  const hitung = new Map<string, number>();
  let upgrade = 0;
  const server = http.createServer((req, res) => {
    const jalur = new URL(req.url ?? '/', 'http://x').pathname;
    if (req.method !== 'GET' || !(jalur in HALAMAN)) hitung.set(jalur, (hitung.get(jalur) ?? 0) + 1);
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(HALAMAN[jalur] ?? kerangka('<p>diterima</p>'));
    });
  });
  server.on('upgrade', (_req, socket) => {
    upgrade++;
    socket.destroy();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    upgrade: () => upgrade,
    origin: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    hitung: (j: string) => hitung.get(j) ?? 0,
    tutup: () => new Promise<void>((r) => server.close(() => r())),
  };
}

type Situs = Awaited<ReturnType<typeof situsUji>>;

async function sesi(situs: Situs, jalur: string, id: string) {
  const config = loadConfig({
    PENDAMPING_FIXTURE_ORIGINS: situs.origin,
    PENDAMPING_ORIGIN_OVERRIDES: `${RESMI}=${situs.origin}`,
    PENDAMPING_HEADLESS: '1',
  });
  const manager = new SessionManager(config, createBrowserFactory(config));
  const o = { urusanId: `u-${id}`, sidHash: SID };
  const s = await manager.create({
    ...o,
    executionId: `x_${id}`,
    adapterId: ADAPTER_GENERIK,
    flowId: 'navigator',
    origin: RESMI,
    params: { jalur },
    modeUji: true,
  });
  await expect.poll(() => manager.status(o).status, { timeout: 30_000 }).toBe('berjalan');
  const p = (await manager.amati(o)).pengamatan;
  return { manager, o, sesiId: s.sesiId, p };
}

function semua(p: Pengamatan, nama: string) {
  return p.elemen.filter((e) => e.nama === nama);
}
function satu(p: Pengamatan, nama: string) {
  const e = semua(p, nama)[0];
  if (!e) throw new Error(`elemen "${nama}" tidak teramati: ${JSON.stringify(p.elemen)}`);
  return e;
}

let situs: Situs;
test.beforeAll(async () => {
  situs = await situsUji();
});
test.afterAll(async () => {
  await situs.tutup();
});

test('F1: retry fetch POST dari klik AI tidak lolos setelah serah ke warga tanpa ketukan', async () => {
  const { manager, o, sesiId, p } = await sesi(situs, '/retry', 'retry');
  try {
    const lanjut = satu(p, 'Lanjut');
    expect(lanjut.kelas).toBe('lanjut');
    const r = await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'klik', ref: lanjut.ref }],
    });
    expect(r).toEqual({
      mode: 'takeover',
      hasil: [{ indeks: 0, kode: 'GERBANG_MEMBLOKIR', kelas: 'lanjut' }],
    });
    // Retry halaman (6 x 400 ms) berjalan selama warga memegang kendali tetapi belum menyentuh layar.
    await new Promise((r) => setTimeout(r, 3_500));
    expect(situs.hitung('/api/ajukan')).toBe(0);
    const blokir = manager.kurasJejak(o).catatan.filter((c) => c.jenis === 'blokir');
    expect(blokir.length).toBeGreaterThanOrEqual(2);
    expect(blokir.map((c) => (c.jenis === 'blokir' ? c.jendela : ''))).toContain('ai_diam');

    // Kontrol positif: ketukan warga nyata membuka jendela tulis dan permintaannya sampai.
    for (const aksi of ['down', 'up'] as const)
      await manager.handleClient(sesiId, {
        type: 'pointer',
        aksi,
        x: 60,
        y: 340,
        jenis: 'mouse',
        tombol: 'left',
      });
    await expect.poll(() => situs.hitung('/api/warga'), { timeout: 10_000 }).toBe(1);
    expect(situs.hitung('/api/ajukan')).toBe(0);
  } finally {
    await manager.shutdown();
  }
});

for (const [jalur, target] of [
  ['/s2', '/ajukan'],
  ['/beacon', '/beacon-kirim'],
] as const) {
  test(`F2: pilih yang memicu ${jalur === '/s2' ? 'form POST ke iframe' : 'sendBeacon'} diblokir dan diserahkan`, async () => {
    const { manager, o, p } = await sesi(situs, jalur, jalur.slice(1));
    try {
      const pilih = satu(p, 'Jenis layanan');
      const r = await manager.aksi(o, {
        ...o,
        rencanaHash: H,
        seq: p.seq,
        aksi: [{ jenis: 'pilih', ref: pilih.ref, nilai: { opsi: 1 } }],
      });
      // Permintaan tulis muncul sesudah op isi kembali (submit/beacon asinkron): diblokir lalu diserahkan.
      expect(['ok', 'GERBANG_MEMBLOKIR']).toContain(r.hasil[0]?.kode);
      await expect.poll(() => manager.status(o).mode, { timeout: 10_000 }).toBe('takeover');
      await new Promise((r) => setTimeout(r, 500));
      expect(situs.hitung(target)).toBe(0);
      expect(manager.kurasJejak(o).catatan).toContainEqual(
        expect.objectContaining({ jenis: 'blokir', metode: 'POST', jendela: 'ai_isi' }),
      );
    } finally {
      await manager.shutdown();
    }
  });
}

test('F3 + F4: tautan Ajukan/Proses dan Lanjut di dalam submit/label tidak bisa diklik AI', async () => {
  const { manager, o, p } = await sesi(situs, '/kelas', 'kelas');
  try {
    for (const nama of ['Ajukan Permohonan', 'Daftar Sekarang', 'Proses Permohonan', 'Register'])
      expect(satu(p, nama).kelas, nama).toBe('kirim');
    expect(satu(p, 'Daftar Layanan').kelas).toBe('navigasi');
    // Span/label "Lanjut" dan tombol pembungkusnya: tidak satu pun boleh diklik AI.
    const lanjut = semua(p, 'Lanjut');
    expect(lanjut.length).toBeGreaterThanOrEqual(3);
    expect(lanjut.every((e) => e.kelas === 'kirim' || e.kelas === 'tidak_pasti')).toBe(true);
    const tautan = ['Ajukan Permohonan', 'Proses Permohonan'].map((n) => satu(p, n));
    for (const e of [...lanjut, ...tautan]) {
      const r = await manager.aksi(o, {
        ...o,
        rencanaHash: H,
        seq: p.seq,
        aksi: [{ jenis: 'klik', ref: e.ref }],
      });
      expect(r.hasil, e.nama).toEqual([{ indeks: 0, kode: 'KELAS_DITOLAK', kelas: e.kelas }]);
    }
    await new Promise((r) => setTimeout(r, 500));
    for (const j of ['/ajukan', '/permohonan/kirim', '/permohonan/12/ajukan', '/permohonan/12/final'])
      expect(situs.hitung(j), j).toBe(0);
    expect(manager.status(o).mode).toBe('ai');
  } finally {
    await manager.shutdown();
  }
});

test('F5: centang pernyataan terselubung dan non-data ditolak; opsi data boleh', async () => {
  const { manager, o, p } = await sesi(situs, '/s4', 's4');
  try {
    const pernyataan = satu(p, 'Data di atas sudah benar dan saya pahami konsekuensinya');
    const kabar = satu(p, 'Kirimi saya kabar');
    const sama = satu(p, 'Alamat domisili sama dengan KTP');
    expect([pernyataan.terlarang, kabar.terlarang, sama.terlarang]).toEqual([
      'pernyataan',
      'pernyataan',
      undefined,
    ]);
    for (const e of [pernyataan, kabar]) {
      const r = await manager.aksi(o, {
        ...o,
        rencanaHash: H,
        seq: p.seq,
        aksi: [{ jenis: 'centang', ref: e.ref, nilai: true }],
      });
      expect(r.hasil, e.nama).toEqual([{ indeks: 0, kode: 'TERLARANG' }]);
    }
    const r = await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'centang', ref: sama.ref, nilai: true }],
    });
    expect(r.hasil).toEqual([{ indeks: 0, kode: 'ok' }]);
  } finally {
    await manager.shutdown();
  }
});

test('tautan pembuka: AI ditolak, serah ketuk_tautan, ketukan warga membuka formulir, Lanjutkan = ai', async () => {
  const { manager, o, sesiId, p } = await sesi(situs, '/beranda', 'beranda');
  const events: PendampingEvent[] = [];
  await manager.attach(sesiId, {
    send: (m: PendampingServerMessage) => void (m.type === 'event' && events.push(m.event)),
    frame: () => {},
    ack: () => {},
    close: () => {},
  });
  try {
    const pembuka = satu(p, 'Ajukan Permohonan Kartu Keluarga');
    expect(pembuka).toMatchObject({ peran: 'tautan', kelas: 'kirim', sebabKelas: 'nama_tautan' });
    expect(satu(p, 'Ajukan Sekarang')).not.toHaveProperty('sebabKelas');
    const klik = await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'klik', ref: pembuka.ref }],
    });
    expect(klik.hasil).toEqual([{ indeks: 0, kode: 'KELAS_DITOLAK', kelas: 'kirim' }]);
    expect(situs.hitung('/permohonan/kk')).toBe(0);

    await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'serahkan', alasan: 'ketuk_tautan', ref: pembuka.ref }],
    });
    const giliran = () =>
      events.find(
        (e): e is Extract<PendampingEvent, { jenis: 'giliran_anda' }> =>
          e.jenis === 'giliran_anda' && e.alasan === 'ketuk_tautan',
      );
    await expect.poll(() => giliran()?.sorot, { timeout: 10_000 }).toBeTruthy();
    expect(giliran()!.pesan).toBe('Ketuk tautan yang disorot untuk membuka formulir, lalu tekan Lanjutkan.');
    expect(manager.status(o).mode).toBe('takeover');
    await new Promise((r) => setTimeout(r, 300));
    expect(situs.hitung('/permohonan/kk')).toBe(0);

    const sorot = giliran()!.sorot!;
    for (const aksi of ['down', 'up'] as const)
      await manager.handleClient(sesiId, {
        type: 'pointer',
        aksi,
        x: sorot.x + sorot.lebar / 2,
        y: sorot.y + sorot.tinggi / 2,
        jenis: 'touch',
        tombol: 'left',
        klik: 1,
      });
    await expect.poll(() => situs.hitung('/permohonan/kk'), { timeout: 10_000 }).toBe(1);
    expect(situs.hitung('/permohonan/12/ajukan')).toBe(0);

    await manager.handleClient(sesiId, { type: 'kembalikan' });
    await expect.poll(() => manager.status(o).mode, { timeout: 10_000 }).toBe('ai');
    expect((await manager.amati(o)).pengamatan.jalur).toBe('/permohonan/kk');
    expect(manager.kurasJejak(o).catatan).toContainEqual({
      jenis: 'ambil_alih',
      fase: 'mulai',
      alasan: 'ketuk_tautan',
    });
  } finally {
    await manager.shutdown();
  }
});

test('H3: halaman sukses saat warga memegang kendali -> selesai = siaga berhasil + bukti di jejak', async () => {
  const { manager, o, sesiId, p } = await sesi(situs, '/sukses', 'sukses');
  try {
    expect(p.sinyal.sukses).toBe(true);
    await manager.handleClient(sesiId, { type: 'ambil_alih' });
    // Nomor karangan tidak pernah tercatat; nomor yang tertulis di halaman tercatat.
    const v = await manager.selesai(o, { nomor: 'REG-2026-0001', status: 'Terkirim' });
    expect(v).toMatchObject({ status: 'siaga', hasil: 'berhasil', bukti: { nomor: 'REG-2026-0001' } });
    expect(manager.kurasJejak(o).catatan).toContainEqual({
      jenis: 'bukti',
      bukti: { nomor: 'REG-2026-0001', status: 'Terkirim' },
    });
  } finally {
    await manager.shutdown();
  }
});

test('M5: tidak_bisa = dipandu (drift), bukan gagal', async () => {
  const { manager, o, p } = await sesi(situs, '/s4', 'tidak-bisa');
  try {
    await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'tidak_bisa', sebab: 'hanya_whatsapp' }],
    });
    await expect.poll(() => manager.status(o).status, { timeout: 10_000 }).toBe('dipandu');
    expect(manager.status(o).hasil).toBe('drift');
  } finally {
    await manager.shutdown();
  }
});

test('F6: WebSocket di sesi generik ditolak sebelum tersambung ke server', async () => {
  const { manager, o } = await sesi(situs, '/ws', 'ws');
  try {
    await expect
      .poll(() => manager.kurasJejak(o).catatan.some((c) => c.jenis === 'blokir' && c.metode === 'WSOCKET'), {
        timeout: 10_000,
      })
      .toBe(true);
    expect(situs.upgrade()).toBe(0);
  } finally {
    await manager.shutdown();
  }
});
