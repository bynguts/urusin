/**
 * HALAMAN DEBUG (tanpa gaya): penguji manusia mengemudikan sesi pendamping lewat stream, untuk memastikan
 * klik manusia sungguhan (mis. kotak centang verifikasi situs) lolos di instance hosting. Tidak ada AI.
 * Aktif hanya bila PENDAMPING_DEBUG_TOKEN (>= 32 karakter) diset. Akses lewat terowongan SSH ke 127.0.0.1,
 * bukan lewat Caddy: `ssh -L 4330:127.0.0.1:4330 <vps>` lalu buka http://localhost:4330/debug.
 */
export function debugPageHtml(): string {
  return `<!doctype html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>DEBUG - kemudi manual pendamping</title></head>
<body>
<p><strong>DEBUG</strong>: kemudi manual oleh penguji manusia. Tanpa AI. Jangan mengirim data sungguhan.</p>
<form id="mulai">
  <label>Token debug <input id="token" type="password" autocomplete="off" required></label>
  <label>URL (domain resmi di allowlist) <input id="url" type="url" size="60" required></label>
  <label>Layar
    <select id="layar-preset">
      <option value="390x844x1">Ponsel 390x844</option>
      <option value="1280x800x0">Desktop 1280x800</option>
    </select>
  </label>
  <button>Mulai sesi</button>
</form>
<p>Status: <output id="status">-</output> | Mode: <output id="mode">-</output> | Koneksi: <output id="koneksi">-</output></p>
<p id="pesan"></p>
<canvas id="layar" tabindex="0" style="width:390px;height:844px;border:1px solid #000;touch-action:none"></canvas>
<textarea id="ketik" aria-label="Ketik" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>
<p><button id="akhiri" type="button">Akhiri sesi</button></p>
<pre id="log"></pre>
<script type="module">
  import { createPendampingViewer } from '/debug/index.js';
  const $ = (id) => document.getElementById(id);
  const log = (s) => ($('log').textContent += new Date().toISOString().slice(11, 19) + ' ' + s + '\\n');
  let viewer;
  $('mulai').onsubmit = async (ev) => {
    ev.preventDefault();
    const token = $('token').value;
    const [lebar, tinggi, seluler] = $('layar-preset').value.split('x').map(Number);
    const auth = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
    const r = await fetch('/debug/sesi', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ url: $('url').value, viewport: { lebar, tinggi, dpr: 1, seluler: seluler === 1 } }),
    });
    const sesi = await r.json();
    if (!r.ok) return log('galat ' + (sesi.kode || r.status) + ' ' + (sesi.pesanWarga || ''));
    $('layar').style.width = lebar + 'px';
    $('layar').style.height = tinggi + 'px';
    const ws = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/' + sesi.sesiId;
    viewer?.tutup();
    viewer = createPendampingViewer($('layar'), ws, {
      tiket: async () => {
        const t = await fetch('/debug/tiket', { method: 'POST', headers: auth, body: JSON.stringify({ sesiId: sesi.sesiId }) });
        return (await t.json()).tiket;
      },
      inputTeks: $('ketik'),
    });
    window.viewer = viewer;
    viewer.on('mode', (m) => { $('mode').textContent = m.mode; $('pesan').textContent = m.pesan ?? ''; });
    viewer.on('koneksi', (k) => ($('koneksi').textContent = k));
    viewer.on('status', (s) => ($('status').textContent = s.status + (s.antrean ? ' #' + s.antrean.posisi : '')));
    viewer.on('event', (e) => log('event ' + e.jenis + (e.alasan ? ' ' + e.alasan : '') + (e.host ? ' ' + e.host : '') + (e.pesan ? ': ' + e.pesan : '')));
    viewer.on('galat', (g) => log('galat ' + g.kode + ' ' + g.pesanWarga));
  };
  $('akhiri').onclick = () => viewer?.akhiri();
</script>
</body>
</html>`;
}
