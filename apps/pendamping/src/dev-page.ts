/**
 * HALAMAN DEV SAJA (tanpa gaya) untuk e2e dan uji manual. Bukan UI produk: desain final (banner takeover,
 * "giliran Anda", layar antrean, serah-terima Kirim) milik tim UI di apps/web.
 * Aktif hanya bila PENDAMPING_DEV_PAGE=1 dan NODE_ENV bukan production.
 * Parameter: /dev?sesi=<id>&ws=<wsUrl>. Tiket diambil lewat `window.__ambilTiket()` (disediakan pengujian).
 */
export function devPageHtml(): string {
  return `<!doctype html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>DEV ONLY - penampil pendamping</title></head>
<body>
<p><strong>DEV ONLY</strong>: halaman uji tanpa gaya, akan diganti UI tim desain.</p>
<p>Mode: <output id="mode">-</output> | Koneksi: <output id="koneksi">-</output></p>
<p id="pesan"></p>
<canvas id="layar" tabindex="0" style="width:390px;height:844px;border:1px solid #000"></canvas>
<textarea id="ketik" aria-label="Ketik" autocomplete="off"></textarea>
<p>
  <button id="ambil">Ambil alih</button>
  <button id="kembali">Kembalikan ke AI</button>
  <button id="akhiri">Akhiri</button>
</p>
<pre id="log"></pre>
<script type="module">
  import { createPendampingViewer } from '/dev/index.js';
  const q = new URLSearchParams(location.search);
  const log = (s) => (document.getElementById('log').textContent += s + '\\n');
  const viewer = createPendampingViewer(document.getElementById('layar'), q.get('ws'), {
    tiket: () => window.__ambilTiket(),
    inputTeks: document.getElementById('ketik'),
  });
  window.viewer = viewer;
  window.peristiwa = [];
  viewer.on('mode', (m) => { document.getElementById('mode').textContent = m.mode; document.getElementById('pesan').textContent = m.pesan ?? ''; });
  viewer.on('koneksi', (k) => (document.getElementById('koneksi').textContent = k));
  viewer.on('event', (e) => { window.peristiwa.push(e); log('event ' + e.jenis + (e.alasan ? ' ' + e.alasan : '')); });
  viewer.on('butuh_data', (d) => { window.butuh = d; log('butuh_data ' + d.placeholder.length + ' ' + d.berkas.length); });
  viewer.on('galat', (g) => log('galat ' + g.kode));
  viewer.on('status', (s) => (window.statusSesi = s));
  window.jumlahFrame = 0;
  viewer.on('frame', (m) => { window.frameTerakhir = m; window.jumlahFrame++; });
  viewer.on('fokus', (j) => (window.fokus = j));
  document.getElementById('ambil').onclick = () => viewer.ambilAlih();
  document.getElementById('kembali').onclick = () => viewer.kembalikan();
  document.getElementById('akhiri').onclick = () => viewer.akhiri();
</script>
</body>
</html>`;
}
