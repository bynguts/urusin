import http from 'node:http';
import type net from 'node:net';
import { expect, test } from '@playwright/test';
import type { Pengamatan, PendampingEvent, PendampingServerMessage } from '@urusin/contracts';
import { createBrowserFactory, PESAN_LAYAR_LEBAR, pesanGangguan } from '../src/browser.js';
import { loadConfig } from '../src/config.js';
import { ADAPTER_GENERIK, PendampingError, SessionManager, sidHashOf } from '../src/sessions.js';

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
  // Probe 3208: SPA yang baru merender kendali 1,5 detik setelah load.
  '/spa': kerangka(`<div id="app">Memuat...</div><script>setTimeout(() => {
  document.getElementById('app').innerHTML = '<form><label>Nama Lengkap <input name="nama"></label></form>';
}, 1500);</script>`),
  // Probe gel4 6171: layar muat + konten opacity 0, baru tampil 800 ms setelah load dengan transisi 700 ms.
  '/pudar':
    kerangka(`<style>#muat{position:fixed;top:200px;left:0;right:0;bottom:0;background:#fff}#isi{opacity:0;transition:opacity .7s}
#isi.tampil{opacity:1}</style><nav><a href="/beranda">Beranda</a></nav><div id="isi"><form><label>Nama Pudar <input name="nama"></label>
<label>Tempat Lahir Pudar <input name="tempat"></label><button type="button">Lanjut</button></form></div>
<div id="muat">Memuat...</div>
<script>addEventListener('load', () => setTimeout(() => {
  document.getElementById('isi').classList.add('tampil');
  document.getElementById('muat').remove();
}, 800));</script>`),
  // Probe gel4 6171 (/onlinecapil): #page-content berisi TAUTAN saja (tanpa kolom isian) opacity 0 di balik
  // preloader, dengan tombol tutup yang sudah terlihat di luarnya (pengamatan tidak kosong); setTimeout setelah
  // load (situs asli 800 ms, di sini 1,5 detik agar jeda pasti terlewati) baru transisi dan preloader dihapus.
  '/pudar-tautan':
    kerangka(`<style>#page-content{opacity:0;transition:opacity .7s}#page-content.tampil{opacity:1}
#page-content a{display:block;padding:30px 16px}.preloader{position:fixed;top:60px;left:0;right:0;bottom:0;background:#fff}</style>
<button type="button" aria-label="Tutup pengumuman">✕</button>
<div class="preloader">Memuat halaman...</div>
<div id="page-content"><h1>Pilih menu</h1><a href="/antrian">Daftar Antrian Pudar</a>
<a href="/cek">Cek Status Pudar</a><a href="/unduh">Unduh Formulir Pudar</a></div>
<script>addEventListener('load', () => setTimeout(() => {
  document.getElementById('page-content').classList.add('tampil');
  document.querySelector('.preloader').remove();
}, 1500));</script>`),
  // Probe gel5 6171: load cepat, konten baru dibuka sesudah data XHR lambat (5 dtk, terowongan lambat). Tautan
  // kepala selalu tampil, jadi pengamatan tidak kosong (bukan jalur "0 elemen").
  '/pudar-data':
    kerangka(`<style>#isi{opacity:0;transition:opacity .3s}#isi.tampil{opacity:1}#isi a{display:block;padding:80px 16px}</style>
<header><a href="/bantuan">Beranda</a></header>
<div id="isi"><h1>Pilih layanan</h1><a href="/antrian">Kartu Keluarga Data</a><a href="/cek">Akta Kelahiran Data</a>
<a href="/pindah">Pindah Datang Data</a></div>
<script>fetch('/data-lambat', { cache: 'no-store' }).then(() => document.getElementById('isi').classList.add('tampil'));</script>`),
  // Varian: body sendiri opacity 0 (opacity tidak diwariskan ke gaya anak), tampil 1,5 detik setelah load.
  '/pudar-body': `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Uji</title>
<style>body{opacity:0;transition:opacity .5s}body.tampil{opacity:1}a{display:block;padding:30px 16px}</style></head>
<body><a href="/antrian">Antrian Body Pudar</a><button type="button">Tombol Body Pudar</button>
<script>addEventListener('load', () => setTimeout(() => document.body.classList.add('tampil'), 1500));</script></body></html>`,
  // Probe 3674: redirect JS halaman sendiri (bukan aksi AI) ke ?p=close_form; dan redirect ke jalur tulis.
  '/alih': kerangka(
    `<p>Mengalihkan...</p><script>setTimeout(() => { location.href = '/tutup?p=close_form'; }, 300);</script>`,
  ),
  '/tutup': kerangka('<h1>Pendaftaran online ditutup</h1><a href="/">Beranda</a>'),
  '/alih-tulis': kerangka(
    `<p>Mengalihkan...</p><script>setTimeout(() => { location.href = '/permohonan/9/kirim'; }, 300);</script>`,
  ),
  // N2 (poc2 B): klik AI "Lanjut" lalu POST tertunda 1,5 detik kemudian, diulang terus.
  '/tertunda': kerangka(`<div id="l1"><button type="button" id="b">Lanjut</button></div>
<div id="l2" style="display:none"><label>Jenis layanan <select name="jenis"><option value="">--</option><option value="kk">KK</option></select></label></div>
<script>document.getElementById('b').addEventListener('click', () => {
  document.getElementById('l1').style.display='none'; document.getElementById('l2').style.display='block';
  setTimeout(() => { setInterval(() => fetch('/api/final-b', { method: 'POST', body: 'final=1' }).catch(() => {}), 200); }, 1500);
});</script>`),
  // N4 (poc2 A): retry POST tanpa batas dari klik AI; area kosong dan kolom ketik untuk ketukan warga.
  '/retry-tanpa-batas':
    kerangka(`<style>#kosong{position:fixed;left:0;top:300px;width:300px;height:200px;background:#eee}
#nama{position:fixed;left:0;top:520px;width:300px;height:40px}
#ok{position:fixed;left:0;top:600px;width:300px;height:40px}
#rl{position:fixed;left:0;top:650px;width:300px;height:30px}
#c{position:fixed;left:0;top:690px;width:300px;height:30px;margin:0}
#s{position:fixed;left:0;top:730px;width:300px;height:30px}
#bantuan{position:fixed;left:0;top:120px;width:300px;height:30px;display:block}
#info{position:fixed;left:0;top:160px;width:300px;height:30px}
#kirim{position:fixed;left:0;top:780px;width:300px;height:40px}</style>
<button type="button" id="b">Lanjut</button><div id="kosong">area kosong</div>
<a id="bantuan" href="#bantuan">Bantuan</a><button type="button" id="info">Info</button>
<form method="post" action="/api/warga-a2"><button type="submit" id="kirim">Kirim formulir</button></form>
<label>Nama <input id="nama" name="nama"></label>
<button type="button" id="ok" onclick="fetch('/api/warga-a',{method:'POST',body:'x'})">Kirim saya</button>
<label id="rl"><input type="radio" name="jk" value="L"> Laki-laki</label>
<input type="checkbox" id="c" name="setuju">
<select id="s" name="agama"><option>Islam</option><option>Kristen</option></select>
<script>document.getElementById('b').addEventListener('click', () => {
  const t = setInterval(async () => { try { await fetch('/api/final-a', { method: 'POST', body: 'final=1' }); clearInterval(t); } catch (e) {} }, 250);
});</script>`),
  // F5 (poc /s4): pernyataan terselubung + checkbox non-data.
  // H3: halaman sukses setelah warga menekan Kirim sendiri.
  '/sukses': kerangka(
    '<h1>Permohonan berhasil dikirim</h1><div class="alert alert-success">Nomor registrasi: REG-2026-0001</div>',
  ),
  // N3/kode N1: warga mengirim sendiri (form POST ke /sukses); dan PoC F: dasbor, label, draf (bukan sukses).
  '/kirim-warga': kerangka(`<form method="post" action="/sukses"><label>Nama <input name="nama"></label>
<button type="submit" style="position:fixed;left:0;top:300px;width:300px;height:80px">Kirim Permohonan</button></form>`),
  // Re-review LOW: POST "cek status" warga (bukan kiriman final) yang hasilnya mirip halaman sukses.
  '/cek-status': kerangka(`<h2>Lacak Permohonan</h2><form method="post" action="/hasil-cek">
<label>Kode lacak <input name="kode"></label><label>Nama <input name="nama"></label>
<label>Alamat <textarea name="alamat"></textarea></label>
<button type="button" id="isi">Isi contoh</button>
<button type="submit" style="position:fixed;left:0;top:400px;width:300px;height:60px">Cek Status</button></form>
<a href="/bantuan">Bantuan</a>`),
  '/hasil-cek': kerangka(
    '<h1>Permohonan berhasil dikirim</h1><div class="alert alert-success">Nomor registrasi: REG-2026-0002</div>',
  ),
  '/dasbor': kerangka(
    '<nav><a href="/bukti">Cetak Bukti Pendaftaran</a> <a href="/layanan">Layanan</a></nav><h1>Selamat datang</h1>',
  ),
  '/label': kerangka(
    '<form><label>Nomor Antrian Online <input name="antri"></label><label>Nama <input name="nama"></label></form>',
  ),
  '/draf': kerangka(
    '<div class="alert alert-success">Data berhasil disimpan. Silakan lanjut ke tahap 2 dari 4.</div><label>Nama Ayah <input name="ayah"></label>',
  ),
  // N1 (poc2 D): halaman tinjauan dengan tombol kirim akhir.
  '/akhir': kerangka(`<h2>Periksa kembali data permohonan</h2><p>Dengan ini saya menyatakan data benar.</p>
<form method="post" action="/api/final-d"><button type="submit" id="kirim" style="position:fixed;left:20px;top:200px;width:200px;height:60px">Kirim Permohonan</button></form>`),
  // N5 (poc2 E): tautan pembuka dengan listener preventDefault + fetch POST.
  '/pembuka-jahat': kerangka(`<style>a{display:block;padding:20px}</style>
<a id="aj" href="/permohonan/kk">Ajukan Permohonan Kartu Keluarga</a>
<script>document.getElementById('aj').addEventListener('click', (e) => { e.preventDefault(); fetch('/api/final-e', {method:'POST', body:'final=1'}); });</script>`),
  // TOCTOU (re-review PoC E3): href tautan pembuka ditukar diam-diam setelah tujuannya ditampilkan ke warga.
  '/pembuka-ganti': kerangka(`<style>a{display:block;padding:20px}</style>
<a id="aj" href="/permohonan/kk">Ajukan Permohonan Kartu Keluarga</a>
<script>setTimeout(() => { document.getElementById('aj').href = '/p/12/x'; }, 3000);</script>`),
  // N6 (poc2 C): kata kerja tulis/pengesahan di nama tautan.
  '/tautan': kerangka(`<a href="/dok/12/tte">Tanda Tangani Dokumen</a><br>
<a href="/data/12/kunci">Finalisasi Data</a><br>
<a href="/berkas/12/serah">Serahkan Berkas</a><br>
<a href="/permohonan/12/lanjutkan">Lanjutkan Permohonan</a><br>
<a href="/p/12/go">Ajukan Permohonan</a>`),
  // N7 (poc-centang): deklarasi orang pertama dan label berkata kerja tulis.
  '/centang-n7':
    kerangka(`<form><label><input type="checkbox" name="a"> Data yang saya isi sesuai KTP dan KK</label>
<label><input type="checkbox" name="b"> Saya sudah membaca persyaratan layanan</label>
<label><input type="checkbox" name="c"> Kirim permohonan KK baru sekarang</label>
<label>Nama <input name="nama"></label></form>`),
  '/s4-data': kerangka(`<form><label><input type="checkbox" name="kabar"> Kirimi saya kabar</label>
<label><input type="checkbox" name="sama"> Alamat domisili sama dengan KTP</label>
<label>Nama <input name="nama"></label></form>`),
  // Review kode N4: tautan target=_blank yang diketuk warga.
  '/popup': kerangka(`<a href="/permohonan/kk?dari=popup" target="_blank"
  style="position:fixed;left:0;top:300px;width:300px;height:80px;display:block">Formulir KK</a>`),
  // Mode ketat: halaman akhir yang mengalihkan dirinya sendiri (redirect JS) sesudah diamati.
  '/akhir-alih':
    kerangka(`<h2>Periksa kembali data permohonan</h2><p>Dengan ini saya menyatakan data benar.</p>
<form method="post" action="/api/final-g"><button type="submit">Kirim Permohonan</button></form>
<script>setTimeout(() => { location.href = '/tutup?dari=akhir'; }, 2500);</script>`),
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
  // Review G4: halaman tinjauan + kolom wajib kosong; "Lanjut" memicu redirect tertunda.
  '/akhir-catatan':
    kerangka(`<h2>Periksa kembali data permohonan</h2><p>Dengan ini saya menyatakan data benar.</p>
<label>Catatan untuk petugas <input name="catatan" required></label><button type="button" id="b">Lanjut</button>
<form method="post" action="/api/final-g4"><button type="submit">Kirim Permohonan</button></form>
<script>document.getElementById('b').addEventListener('click', () => {
  setTimeout(() => { location.href = '/permohonan/12/go4?ok=1'; }, 1500);
});</script>`),
  // Probe 3324/3404: form pendaftaran bercentang S&K dengan tombol pembuka kalender di samping kolom tanggal.
  '/daftar-kalender': kerangka(`<form method="post" action="/api/daftar"><h2>Pendaftaran Akun</h2>
<label>Tanggal lahir <input name="tgl" required placeholder="DD-MM-YYYY"></label>
<button type="button" aria-label="Buka kalender" onclick="document.title='kalender'"><i class="bi bi-calendar3"></i></button>
<label><input type="checkbox" name="sk" required> Saya telah membaca dan menyetujui Syarat dan Ketentuan</label>
<button type="submit">Daftar Sekarang</button></form>`),
};

/**
 * Probe gel4 3279: beranda responsif ala Bootstrap. Tombol MASUK `d-none d-lg-block` (tak tampil < 992 px walau
 * menu dibuka); judul dokumen = lebar viewport saat ini. `/responsif-menu`: MASUK hanya di menu collapse
 * tertutup (dibuka lewat hamburger, bukan dengan melebarkan layar).
 */
const RESPONSIF = (isi: string) =>
  `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
  `<style>.d-none{display:none}@media (min-width:992px){.d-lg-block{display:block}}.collapse:not(.show),.offcanvas:not(.show){display:none}@media (min-width:576px){.d-sm-none{display:none}}</style>` +
  `<title>Uji</title></head><body>${isi}` +
  `<script>const t=()=>{document.title='lebar '+innerWidth};t();setInterval(t,100)</script></body></html>`;
HALAMAN['/responsif'] = RESPONSIF(`<header><a href="/responsif">PAK ONOM</a>
<button type="button" aria-label="Menu" onclick="document.getElementById('nav').classList.toggle('show')"><i class="fa fa-bars"></i></button>
<nav id="nav" class="collapse"><a href="/responsif-bantuan">Bantuan</a>
<a href="javascript:void(0)" class="btn d-none d-lg-block" onclick="location.href='/responsif-masuk'">MASUK</a></nav>
<a href="javascript:void(0)" class="btn d-none d-lg-block" onclick="location.href='/responsif-masuk'">MASUK</a></header>
<h1>Selamat datang</h1><p>Pelayanan administrasi kependudukan online.</p><a href="/responsif-bantuan">Bantuan</a>`);
// Probe gel5 3402: beranda berisi pencarian + banyak tautan (bukan halaman polos). "Masuk atau Daftar" (hanya
// di ponsel) membuka offcanvas berisi tautan Masuk.
HALAMAN['/panel-masuk'] = RESPONSIF(`<header><a href="/panel-masuk">Dukcapil Smart</a>
<a href="#" class="d-sm-none" data-bs-toggle="offcanvas" data-bs-target="#panel" onclick="document.getElementById('panel').classList.add('show');return false">Masuk atau Daftar</a></header>
<div id="panel" class="offcanvas"><a href="/responsif-masuk">Masuk</a><a href="/responsif-bantuan">Bantuan</a></div>
<form action="/cari"><label>Cari layanan <input name="q"></label></form>
<a href="/responsif-bantuan">Kartu Keluarga</a><a href="/responsif-bantuan">Akta Kelahiran</a><a href="/responsif-bantuan">Pindah Datang</a>`);
// Probe gel5 3402: halaman berformulir (bukan polos) dengan MASUK khusus layar lebar.
HALAMAN['/responsif-form'] = RESPONSIF(`<header><a href="/responsif-form">Portal</a>
<a href="/responsif-masuk" class="btn d-none d-lg-block">MASUK</a></header>
<form action="/cari"><label>Cari layanan <input name="q"></label></form><a href="/responsif-bantuan">Bantuan</a>`);
HALAMAN['/responsif-bantuan'] = RESPONSIF('<h1>Bantuan</h1><a href="/responsif">Beranda</a>');
// QA prod gel6 Medan: beranda pintu akun yang event load-nya tertahan gambar yang menggantung.
HALAMAN['/beranda-gantung'] = RESPONSIF(`<header><a href="/beranda-gantung">SIBISA</a>
<a href="/responsif-bantuan">Daftar Akun Gratis</a><a href="/responsif-masuk">Sudah punya akun? Masuk</a></header>
<h1>Layanan Kependudukan Online</h1><img src="/gantung" alt="">`);
// QA prod gel6 Depok: Masuk hanya di menu offcanvas ponsel yang dibuka tombol ber-aria-controls.
HALAMAN['/menu-depok'] = RESPONSIF(`<header><a href="/menu-depok">Silondo Maju</a>
<button type="button" aria-controls="menu" aria-expanded="false" onclick="document.getElementById('menu').classList.add('show');this.setAttribute('aria-expanded','true')"><svg class="ikon"></svg></button>
<div id="menu" class="offcanvas"><a href="/responsif-bantuan">Beranda</a><a href="/responsif-masuk">Login</a><a href="/responsif-bantuan">Register</a></div></header>
<h1>Layanan Kependudukan Online</h1><a href="/responsif-bantuan">Lihat Layanan</a>
<form action="/cari"><label>Ketik Nomor Pendaftaran <input name="q"></label></form>`);
HALAMAN['/responsif-menu'] = RESPONSIF(`<header><a href="/responsif-menu">PAK ONOM</a>
<button type="button" aria-label="Menu" onclick="document.getElementById('nav').classList.toggle('show')"><i class="fa fa-bars"></i></button>
<nav id="nav" class="collapse"><a href="/responsif-masuk">Masuk</a></nav></header><h1>Selamat datang</h1>`);

/**
 * Probe gel4 (1101/3312/7371): halaman Cloudflare tiruan (403 + cf-ray), keduanya memuat skrip telemetri JSD
 * seperti halaman asli. Tantangan = bisa diselesaikan warga; blokir keras = tidak ada yang bisa diselesaikan.
 */
const JSD = '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>';
const RESPON_KHUSUS: Record<string, { status: number; html: string }> = {
  '/cf-tantangan': {
    status: 403,
    html: `<!doctype html><html><head><title>Tunggu sebentar...</title></head><body><p>Melakukan verifikasi keamanan</p><script>window._cf_chl_opt={cType:'managed'}</script>${JSD}</body></html>`,
  },
  // Smoke 3279: origin Apache mati di balik Cloudflare (503 tanpa kendali, skrip injeksi Cloudflare ikut).
  '/gangguan-503': {
    status: 503,
    html: `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN"><html><head><title>503 Service Unavailable</title></head><body><h1>Service Unavailable</h1><p>The server is temporarily unable to service your request due to maintenance downtime or capacity problems. Please try again later.</p>${JSD}</body></html>`,
  },
  // 500 yang tetap berfungsi (warning PHP, halaman berisi formulir): bukan gangguan.
  '/galat-500-berisi': {
    status: 500,
    html: '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Layanan</title></head><body><p>Warning: Undefined variable</p><form><label>NIK Pemohon <input name="nik"></label></form><a href="/bantuan">Bantuan</a></body></html>',
  },
  '/cf-blokir': {
    status: 403,
    html: `<!doctype html><html><head><title>Attention Required! | Cloudflare</title></head><body><h1>Sorry, you have been blocked</h1><h2>You are unable to access contoh.go.id</h2>${JSD}</body></html>`,
  },
};

/**
 * Probe gel4 1372/3275: interstitial ala Turnstile "Verify you are human" (BUKAN Cloudflare, tidak meniru
 * mekanismenya): widget di iframe jalur challenge-platform berisi kotak centang besar; centang = GET ke
 * JALUR_TS_LOLOS (cookie lolos) lalu kembali ke halaman semula yang kini berisi formulir.
 * - `/ts-antara`: judul interstitial, widget langsung ada.
 * - `/ts-lambat`: judul biasa + penanda `.cf-turnstile`, widget baru disisipkan setelah uji membuka pemicu
 *   (`/ts-pemicu`, dibaca halaman lewat GET berkala): Navigator sempat menyerahkan CAPTCHA sebelum pemeriksaan
 *   tantangan melihat widgetnya.
 */
let pemicuTs = false;
const JALUR_TS = ['/ts-antara', '/ts-lambat'];
const JALUR_TS_LOLOS = '/cdn-cgi/challenge-platform/uji-ts/lolos';
const widgetTs = (kembali: string) =>
  `<iframe title="Widget verifikasi" src="/cdn-cgi/challenge-platform/uji-ts/widget?kembali=${kembali}" width="300" height="70" style="border:0;display:block"></iframe>`;
const HALAMAN_TS_SESUDAH = kerangka(
  '<h1>Layanan Kependudukan</h1><form><label>NIK Pemohon <input name="nik"></label></form>',
);
HALAMAN['/ts-antara'] =
  `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Verify you are human</title></head>` +
  `<body><p>Halaman tiruan untuk pengujian. Centang kotak di bawah.</p>${widgetTs('/ts-antara')}</body></html>`;
HALAMAN['/ts-lambat'] = kerangka(`<h1>Keamanan situs</h1><a href="/bantuan">Bantuan</a>
<div class="cf-turnstile" id="wadah"></div>
<script>const t = setInterval(async () => {
  if ((await (await fetch('/ts-pemicu', { cache: 'no-store' })).text()) !== 'ya') return;
  clearInterval(t);
  document.getElementById('wadah').innerHTML = ${JSON.stringify(widgetTs('/ts-lambat'))};
}, 300);</script>`);
HALAMAN['/cdn-cgi/challenge-platform/uji-ts/widget'] =
  `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Widget</title><style>html,body{margin:0}` +
  `label{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:300px;height:70px;border:1px solid #888;font:16px sans-serif}` +
  `input{width:28px;height:28px}</style></head><body><label><input type="checkbox" id="kotak-manusia"> Verify you are human</label>` +
  `<script>document.getElementById('kotak-manusia').addEventListener('change', () => {` +
  `top.location.href = '${JALUR_TS_LOLOS}?kembali=' + new URLSearchParams(location.search).get('kembali');` +
  `});</script></body></html>`;

async function situsUji() {
  const hitung = new Map<string, number>();
  let upgrade = 0;
  const server = http.createServer((req, res) => {
    const jalur = new URL(req.url ?? '/', 'http://x').pathname;
    if (req.method !== 'GET' || !(jalur in HALAMAN)) hitung.set(jalur, (hitung.get(jalur) ?? 0) + 1);
    req.resume();
    req.on('end', () => {
      // QA prod gel6 (Medan/Tangerang): sumber daya yang menggantung menahan event load > 30 dtk.
      if (jalur === '/gantung') {
        setTimeout(() => res.writeHead(204).end(), 40_000).unref();
        return;
      }
      if (jalur === '/data-lambat') {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end('{}');
        }, 5_000);
        return;
      }
      if (jalur === '/ts-pemicu') {
        res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
        return void res.end(pemicuTs ? 'ya' : 'belum');
      }
      // Tiruan interstitial Turnstile: hanya ketukan warga pada kotak centang yang membuka JALUR_TS_LOLOS.
      if (jalur === JALUR_TS_LOLOS) {
        const kembali = new URL(req.url ?? '/', 'http://x').searchParams.get('kembali') ?? '';
        res.writeHead(302, {
          location: JALUR_TS.includes(kembali) ? kembali : '/ts-antara',
          'set-cookie': 'uji_ts=lolos; Path=/',
        });
        return void res.end();
      }
      if (JALUR_TS.includes(jalur) && /(^|;\s*)uji_ts=lolos/.test(req.headers.cookie ?? '')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return void res.end(HALAMAN_TS_SESUDAH);
      }
      const khusus = Object.hasOwn(RESPON_KHUSUS, jalur) ? RESPON_KHUSUS[jalur] : undefined;
      if (khusus) {
        res.writeHead(khusus.status, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'cf-ray': '8f0000000000abcd-SIN',
          server: 'cloudflare',
        });
        return void res.end(khusus.html);
      }
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

/** `rekam`: penampil tiruan dipasang SEBELUM sesi berjalan, event (giliran_anda, sorot) dikumpulkan sejak awal. */
async function sesi(situs: Situs, jalur: string, id: string, amati = true, rekam = false) {
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
  const events: PendampingEvent[] = [];
  if (rekam)
    await manager.attach(s.sesiId, {
      send: (m: PendampingServerMessage) => void (m.type === 'event' && events.push(m.event)),
      frame: () => {},
      ack: () => {},
      close: () => {},
    });
  if (amati) await expect.poll(() => manager.status(o).status, { timeout: 30_000 }).toBe('berjalan');
  else
    await expect
      .poll(() => !['antre', 'memulai', 'menunggu_data'].includes(manager.status(o).status), {
        timeout: 30_000,
      })
      .toBe(true);
  const p = amati ? (await manager.amati(o)).pengamatan : (undefined as unknown as Pengamatan);
  return { manager, o, sesiId: s.sesiId, p, events };
}

function semua(p: Pengamatan, nama: string) {
  return p.elemen.filter((e) => e.nama === nama);
}
function satu(p: Pengamatan, nama: string) {
  const e = semua(p, nama)[0];
  if (!e) throw new Error(`elemen "${nama}" tidak teramati: ${JSON.stringify(p.elemen)}`);
  return e;
}

async function ketuk(manager: SessionManager, sesiId: string, x: number, y: number) {
  for (const aksi of ['down', 'up'] as const)
    await manager.handleClient(sesiId, {
      type: 'pointer',
      aksi,
      x,
      y,
      jenis: 'touch',
      tombol: 'left',
      klik: 1,
    });
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
    // Retry halaman (6 x 400 ms) mati: dokumen kotor oleh klik AI dimuat ulang sebelum serah (re-review A2),
    // jadi tidak ada percobaan lagi selama warga memegang kendali.
    await new Promise((r) => setTimeout(r, 3_500));
    expect(situs.hitung('/api/ajukan')).toBe(0);
    const blokir = manager.kurasJejak(o).catatan.filter((c) => c.jenis === 'blokir');
    expect(blokir.length).toBeGreaterThanOrEqual(1);
    expect(new Set(blokir.map((c) => (c.jenis === 'blokir' ? c.jendela : '')))).toEqual(new Set(['ai_klik']));

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

test('N6 (PoC C): Tanda Tangani / Finalisasi / Serahkan = kirim, tidak bisa diklik AI', async () => {
  const { manager, o, p } = await sesi(situs, '/tautan', 'tautan-n6');
  try {
    const tulis = ['Tanda Tangani Dokumen', 'Finalisasi Data', 'Serahkan Berkas'].map((n) => satu(p, n));
    for (const e of tulis) expect(e.kelas, e.nama).toBe('kirim');
    expect(satu(p, 'Lanjutkan Permohonan').kelas).toBe('navigasi');
    expect(satu(p, 'Ajukan Permohonan')).toMatchObject({ kelas: 'kirim', tautanPembuka: true });
    for (const e of tulis) {
      const r = await manager.aksi(o, {
        ...o,
        rencanaHash: H,
        seq: p.seq,
        aksi: [{ jenis: 'klik', ref: e.ref }],
      });
      expect(r.hasil, e.nama).toEqual([{ indeks: 0, kode: 'KELAS_DITOLAK', kelas: 'kirim' }]);
    }
    await new Promise((r) => setTimeout(r, 300));
    for (const j of ['/dok/12/tte', '/data/12/kunci', '/berkas/12/serah']) expect(situs.hitung(j), j).toBe(0);
  } finally {
    await manager.shutdown();
  }
});

test('F5 + N7: centang pernyataan/non-data ditolak; halaman berpernyataan = kunci centang; opsi data boleh', async () => {
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
    // Checkbox pernyataan = halaman akhir: tidak ada centang AI sama sekali di halaman ini (review N7).
    expect(p.sinyal.halamanAkhir).toBe(true);
    for (const e of [pernyataan, kabar, sama]) {
      const r = await manager.aksi(o, {
        ...o,
        rencanaHash: H,
        seq: p.seq,
        aksi: [{ jenis: 'centang', ref: e.ref, nilai: true }],
      });
      expect(r.hasil, e.nama).toEqual([{ indeks: 0, kode: 'HALAMAN_AKHIR' }]);
    }
  } finally {
    await manager.shutdown();
  }
  const data = await sesi(situs, '/s4-data', 's4-data');
  try {
    const kabar = satu(data.p, 'Kirimi saya kabar');
    const sama = satu(data.p, 'Alamat domisili sama dengan KTP');
    const centang = (ref: string) =>
      data.manager.aksi(data.o, {
        ...data.o,
        rencanaHash: H,
        seq: data.p.seq,
        aksi: [{ jenis: 'centang', ref, nilai: true }],
      });
    expect((await centang(kabar.ref)).hasil).toEqual([{ indeks: 0, kode: 'TERLARANG' }]);
    expect((await centang(sama.ref)).hasil).toEqual([{ indeks: 0, kode: 'ok' }]);
  } finally {
    await data.manager.shutdown();
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
    expect(pembuka).toMatchObject({ peran: 'tautan', kelas: 'kirim', tautanPembuka: true });
    expect(satu(p, 'Ajukan Sekarang')).not.toHaveProperty('tautanPembuka');
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
    expect(giliran()!.pesan).toContain('tombol Buka');
    expect(giliran()!.tautan).toEqual({
      ref: pembuka.ref,
      nama: 'Ajukan Permohonan Kartu Keluarga',
      host: new URL(situs.origin).host,
      jalur: '/permohonan/kk',
    });
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

test('N1 (PoC D): serahkan ketuk_tautan ke tombol kirim di halaman akhir ditolak worker', async () => {
  const { manager, o, sesiId, p } = await sesi(situs, '/akhir', 'akhir');
  const events: PendampingEvent[] = [];
  await manager.attach(sesiId, {
    send: (m: PendampingServerMessage) => void (m.type === 'event' && events.push(m.event)),
    frame: () => {},
    ack: () => {},
    close: () => {},
  });
  try {
    expect(p.sinyal.halamanAkhir).toBe(true);
    const kirim = satu(p, 'Kirim Permohonan');
    const r = await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'serahkan', alasan: 'ketuk_tautan', ref: kirim.ref }],
    });
    expect(r.hasil).toEqual([{ indeks: 0, kode: 'KELAS_DITOLAK' }]);
    expect(events.some((e) => e.jenis === 'giliran_anda' && e.alasan === 'ketuk_tautan')).toBe(false);
    expect(manager.status(o).mode).toBe('ai');
    expect(situs.hitung('/api/final-d')).toBe(0);
  } finally {
    await manager.shutdown();
  }
});

test('N5 (PoC E): buka_tautan = navigasi GET dari worker; listener halaman (preventDefault + POST) tidak jalan', async () => {
  const { manager, o, sesiId, p } = await sesi(situs, '/pembuka-jahat', 'pembuka-jahat');
  const events: PendampingEvent[] = [];
  await manager.attach(sesiId, {
    send: (m: PendampingServerMessage) => void (m.type === 'event' && events.push(m.event)),
    frame: () => {},
    ack: () => {},
    close: () => {},
  });
  try {
    const pembuka = satu(p, 'Ajukan Permohonan Kartu Keluarga');
    expect(pembuka.tautanPembuka).toBe(true);
    // buka_tautan di luar giliran ketuk_tautan diabaikan (penghitung situs dipakai bersama antar tes).
    const awal = situs.hitung('/permohonan/kk');
    await manager.handleClient(sesiId, { type: 'buka_tautan', ref: pembuka.ref });
    expect(situs.hitung('/permohonan/kk')).toBe(awal);
    await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'serahkan', alasan: 'ketuk_tautan', ref: pembuka.ref }],
    });
    await expect
      .poll(() => events.find((e) => e.jenis === 'giliran_anda' && e.alasan === 'ketuk_tautan'), {
        timeout: 10_000,
      })
      .toMatchObject({
        tautan: { ref: pembuka.ref, nama: 'Ajukan Permohonan Kartu Keluarga', jalur: '/permohonan/kk' },
      });
    // Ref lain dari perangkat ditolak; ref tautan yang disorot dibuka.
    await manager.handleClient(sesiId, { type: 'buka_tautan', ref: 'e999' });
    expect(manager.status(o).mode).toBe('takeover');
    expect(situs.hitung('/permohonan/kk')).toBe(awal);
    await manager.handleClient(sesiId, { type: 'buka_tautan', ref: pembuka.ref });
    await expect.poll(() => situs.hitung('/permohonan/kk'), { timeout: 10_000 }).toBe(awal + 1);
    await expect.poll(() => manager.status(o).mode, { timeout: 10_000 }).toBe('ai');
    expect((await manager.amati(o)).pengamatan.jalur).toBe('/permohonan/kk');
    await new Promise((r) => setTimeout(r, 500));
    expect(situs.hitung('/api/final-e')).toBe(0);
    expect(manager.kurasJejak(o).catatan).toContainEqual({ jenis: 'ambil_alih', fase: 'selesai' });
  } finally {
    await manager.shutdown();
  }
});

test('TOCTOU (PoC E3): href ditukar setelah ditampilkan = buka_tautan tidak membuka apa pun', async () => {
  const { manager, o, sesiId, p } = await sesi(situs, '/pembuka-ganti', 'pembuka-ganti');
  const events: PendampingEvent[] = [];
  await manager.attach(sesiId, {
    send: (m: PendampingServerMessage) => void (m.type === 'event' && events.push(m.event)),
    frame: () => {},
    ack: () => {},
    close: () => {},
  });
  try {
    const pembuka = satu(p, 'Ajukan Permohonan Kartu Keluarga');
    const awal = situs.hitung('/permohonan/kk');
    await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'serahkan', alasan: 'ketuk_tautan', ref: pembuka.ref }],
    });
    // Yang ditampilkan ke warga = href semula (halaman menukarnya 3 detik sesudah dimuat).
    expect(events.find((e) => e.jenis === 'giliran_anda' && e.alasan === 'ketuk_tautan')).toMatchObject({
      tautan: { ref: pembuka.ref, jalur: '/permohonan/kk' },
    });
    await new Promise((r) => setTimeout(r, 3_500));
    await manager.handleClient(sesiId, { type: 'buka_tautan', ref: pembuka.ref });
    await new Promise((r) => setTimeout(r, 1_000));
    expect(situs.hitung('/p/12/x')).toBe(0);
    expect(situs.hitung('/permohonan/kk')).toBe(awal);
    expect(manager.status(o).mode).toBe('takeover');
    expect(events.at(-1)).toMatchObject({
      jenis: 'giliran_anda',
      alasan: 'periksa',
      pesan: expect.stringContaining('berubah'),
    });
    expect(events.at(-1)).not.toHaveProperty('tautan');
    expect(manager.kurasJejak(o).catatan).not.toContainEqual({ jenis: 'ambil_alih', fase: 'selesai' });
  } finally {
    await manager.shutdown();
  }
});

test('kode N4: tautan target=_blank yang diketuk warga dibuka di halaman utama (pop-up ditutup)', async () => {
  const { manager, o, sesiId } = await sesi(situs, '/popup', 'popup');
  try {
    await manager.handleClient(sesiId, { type: 'ambil_alih' });
    await ketuk(manager, sesiId, 150, 340);
    await expect
      .poll(
        async () => {
          // 503 "halaman sedang berpindah" sementara di bawah beban = belum, coba lagi.
          try {
            return (await manager.amati(o, true)).pengamatan.jalur;
          } catch (e) {
            if (e instanceof PendampingError && e.status === 503) return undefined;
            throw e;
          }
        },
        { timeout: 10_000 },
      )
      .toBe('/permohonan/kk');
  } finally {
    await manager.shutdown();
  }
});

test('probe gel4 (1101/3312): halaman tantangan Cloudflare 403 = giliran verifikasi warga, bukan sukses', async () => {
  const { manager, o, sesiId } = await sesi(situs, '/cf-tantangan', 'cf-tantangan', false);
  const events: PendampingEvent[] = [];
  await manager.attach(sesiId, {
    send: (m: PendampingServerMessage) => void (m.type === 'event' && events.push(m.event)),
    frame: () => {},
    ack: () => {},
    close: () => {},
  });
  try {
    await expect.poll(() => manager.status(o).mode, { timeout: 15_000 }).toBe('takeover');
    expect(manager.status(o).status).toBe('berjalan');
    expect(manager.status(o).pesan).toMatch(/verifikasi/i);
    // Bukan sukses: tidak ada pengiriman warga, selesai ditolak.
    await expect(manager.selesai(o)).rejects.toMatchObject({ status: 409 });
  } finally {
    await manager.shutdown();
  }
});

/** Event verifikasi_situs ber-sorot (kotak widget tantangan) terakhir. */
const sorotVerifikasi = (events: PendampingEvent[]) =>
  events.findLast(
    (e): e is Extract<PendampingEvent, { jenis: 'giliran_anda' }> =>
      e.jenis === 'giliran_anda' && e.alasan === 'verifikasi_situs' && e.sorot !== undefined,
  )?.sorot;

test('probe gel4 1372/3275: interstitial Turnstile = giliran warga + sorot widget; dicentang warga, AI lanjut sendiri', async () => {
  const awal = situs.hitung(JALUR_TS_LOLOS);
  const { manager, o, sesiId, events } = await sesi(situs, '/ts-antara', 'ts-antara', false, true);
  try {
    await expect.poll(() => manager.status(o).mode, { timeout: 15_000 }).toBe('takeover');
    await expect.poll(() => sorotVerifikasi(events), { timeout: 15_000 }).toBeTruthy();
    const kotak = sorotVerifikasi(events)!;
    expect(kotak.lebar).toBeGreaterThanOrEqual(290);
    expect(manager.status(o).pesan).toMatch(/Verify you are human/);
    // Navigator mengamati: mode tetap giliran warga (AI menunggu), aksi apa pun tidak dijalankan.
    const a = await manager.amati(o);
    expect(a.mode).toBe('takeover');
    const r = await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: a.pengamatan.seq,
      aksi: [{ jenis: 'serahkan', alasan: 'captcha' }],
    });
    expect(r.hasil.every((h) => h.kode === 'DILEWATI')).toBe(true);
    // Tanpa ketukan warga tidak ada yang mencentang (AI tidak pernah menyentuh widget).
    await new Promise((ok) => setTimeout(ok, 2_000));
    expect(situs.hitung(JALUR_TS_LOLOS)).toBe(awal);
    expect(manager.status(o).mode).toBe('takeover');

    // Warga sendiri mencentang (ketukan di kotak sorot, diteruskan CDP sampai ke iframe).
    await ketuk(manager, sesiId, kotak.x + 30, kotak.y + kotak.tinggi / 2);
    await expect.poll(() => manager.status(o).mode, { timeout: 15_000 }).toBe('ai');
    expect(manager.status(o).pesan).toMatch(/Verifikasi selesai\. AI melanjutkan/);
    expect(situs.hitung(JALUR_TS_LOLOS)).toBe(awal + 1);
    // AI lanjut sendiri mengamati halaman berikutnya (judul/URL berganti, tantangan hilang).
    const b = await manager.amati(o);
    expect(b.mode).toBe('ai');
    expect(b.pengamatan.judul).not.toMatch(/verify/i);
    expect(satu(b.pengamatan, 'NIK Pemohon')).toMatchObject({ peran: 'teks' });
  } finally {
    await manager.shutdown();
  }
});

test('probe gel4 1372/3275: CAPTCHA diserahkan sebelum widget tantangan terdeteksi -> tetap lanjut otomatis setelah lolos', async () => {
  const awal = situs.hitung(JALUR_TS_LOLOS);
  const { manager, o, sesiId, p, events } = await sesi(situs, '/ts-lambat', 'ts-lambat', true, true);
  try {
    // Navigator melihat sinyal tantangan di pengamatan (widget belum muncul) dan menyerahkan CAPTCHA ke warga.
    expect(p.sinyal.tantangan).toBe(true);
    expect(manager.status(o).mode).toBe('ai');
    const r = await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'serahkan', alasan: 'captcha' }],
    });
    expect(r.hasil[0]?.kode).toBe('ok');
    expect(manager.status(o).mode).toBe('takeover');
    pemicuTs = true;
    // Widget muncul di dokumen yang sama: pemeriksaan tantangan menyorotnya untuk warga.
    await expect.poll(() => sorotVerifikasi(events), { timeout: 15_000 }).toBeTruthy();
    const kotak = sorotVerifikasi(events)!;
    expect(situs.hitung(JALUR_TS_LOLOS)).toBe(awal);
    await ketuk(manager, sesiId, kotak.x + 30, kotak.y + kotak.tinggi / 2);
    // Tantangan hilang: serah CAPTCHA di dokumen tantangan itu selesai, AI lanjut tanpa "Lanjutkan" dari warga.
    await expect.poll(() => manager.status(o).mode, { timeout: 15_000 }).toBe('ai');
    expect(manager.status(o).pesan).toMatch(/Verifikasi selesai\. AI melanjutkan/);
    const b = await manager.amati(o);
    expect(b.mode).toBe('ai');
    expect(satu(b.pengamatan, 'NIK Pemohon')).toMatchObject({ peran: 'teks' });
    expect(manager.kurasJejak(o).catatan).toContainEqual(
      expect.objectContaining({ jenis: 'ambil_alih', fase: 'selesai' }),
    );
  } finally {
    await manager.shutdown();
  }
});

test('probe gel4 (7371): blokir keras Cloudflare (you have been blocked) = dipandu dengan pesan jujur', async () => {
  const { manager, o } = await sesi(situs, '/cf-blokir', 'cf-blokir', false);
  try {
    await expect.poll(() => manager.status(o).status, { timeout: 15_000 }).toBe('dipandu');
    const st = manager.status(o);
    expect(st.pesan).toMatch(/memblokir peramban server Urusin/);
    expect(st.pesan).toMatch(/perangkat Anda sendiri/);
    expect(st.status).not.toBe('berhasil');
  } finally {
    await manager.shutdown();
  }
});

test('probe gel4 6171: konten fade-in teramati setelah transisi selesai (tenang menunggu animasi)', async () => {
  const { manager, p } = await sesi(situs, '/pudar', 'pudar');
  try {
    expect(satu(p, 'Nama Pudar')).toMatchObject({ peran: 'teks', isian: 'kosong' });
    expect(satu(p, 'Tempat Lahir Pudar')).toMatchObject({ peran: 'teks' });
  } finally {
    await manager.shutdown();
  }
});

test('probe gel4 6171: blok tautan di balik preloader, jeda setTimeout sebelum fade-in, tetap teramati', async () => {
  const { manager, p } = await sesi(situs, '/pudar-tautan', 'pudar-tautan');
  try {
    for (const nama of ['Daftar Antrian Pudar', 'Cek Status Pudar', 'Unduh Formulir Pudar'])
      expect(satu(p, nama)).toMatchObject({ peran: 'tautan' });
  } finally {
    await manager.shutdown();
  }
});

test('probe gel4 6171: body opacity 0 sampai setTimeout: tautan/tombol teramati setelah tampil', async () => {
  const { manager, p } = await sesi(situs, '/pudar-body', 'pudar-body');
  try {
    expect(satu(p, 'Antrian Body Pudar')).toMatchObject({ peran: 'tautan' });
    expect(satu(p, 'Tombol Body Pudar')).toMatchObject({ peran: 'tombol' });
  } finally {
    await manager.shutdown();
  }
});

test('probe 3208: SPA lambat (0 elemen saat load) teramati setelah DOM tenang', async () => {
  const { manager, p } = await sesi(situs, '/spa', 'spa');
  try {
    expect(satu(p, 'Nama Lengkap')).toMatchObject({ peran: 'teks', isian: 'kosong' });
  } finally {
    await manager.shutdown();
  }
});

test('probe 3674: redirect JS halaman sesudah navigasi lolos bila jalur bersih, diblokir bila jalur tulis', async () => {
  const bersih = await sesi(situs, '/alih', 'alih');
  try {
    await expect
      .poll(async () => (await bersih.manager.amati(bersih.o)).pengamatan.jalur, { timeout: 10_000 })
      .toBe('/tutup');
  } finally {
    await bersih.manager.shutdown();
  }
  const tulis = await sesi(situs, '/alih-tulis', 'alih-tulis');
  try {
    await new Promise((r) => setTimeout(r, 1_500));
    expect(situs.hitung('/permohonan/9/kirim')).toBe(0);
    expect(tulis.manager.kurasJejak(tulis.o).catatan).toContainEqual(
      expect.objectContaining({ jenis: 'blokir', metode: 'GET' }),
    );
  } finally {
    await tulis.manager.shutdown();
  }
});

test('H3/N3: warga mengirim sendiri dari kotak sorot final -> sukses diterima worker; bukti Navigator menyusul', async () => {
  const { manager, o, sesiId, p } = await sesi(situs, '/kirim-warga', 'sukses');
  try {
    await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'serahkan', alasan: 'final', ref: satu(p, 'Kirim Permohonan').ref }],
    });
    await expect.poll(() => manager.status(o).mode, { timeout: 10_000 }).toBe('takeover');
    // Sebelum warga mengirim: halaman sukses belum ada, /selesai = 409.
    await expect(manager.selesai(o, { nomor: 'REG-2026-0001' })).rejects.toMatchObject({ status: 409 });
    await ketuk(manager, sesiId, 150, 340);
    await expect.poll(() => situs.hitung('/sukses'), { timeout: 10_000 }).toBe(1);
    await expect.poll(() => manager.status(o).status, { timeout: 10_000 }).toBe('siaga');
    expect(manager.status(o).hasil).toBe('berhasil');
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

test('re-review LOW: POST warga yang bukan kiriman final tidak membuat sukses otomatis (tetap butuh /selesai)', async () => {
  const { manager, o, sesiId, p } = await sesi(situs, '/cek-status', 'cek-status');
  try {
    expect(p.sinyal.halamanAkhir).toBe(false);
    await manager.handleClient(sesiId, { type: 'ambil_alih' });
    const sebelum = situs.hitung('/hasil-cek');
    await ketuk(manager, sesiId, 150, 430);
    await expect.poll(() => situs.hitung('/hasil-cek'), { timeout: 10_000 }).toBe(sebelum + 1);
    // Halaman hasil mirip sukses, tetapi bukan kiriman final: sesi tidak ditandai berhasil sendiri.
    await new Promise((r) => setTimeout(r, 6_500));
    expect(manager.status(o).status).toBe('berjalan');
    expect(manager.status(o).hasil).toBeUndefined();
  } finally {
    await manager.shutdown();
  }
});

test('kode N1 + re-review LOW: AI menyerah, warga mengirim sendiri (bukan kotak sorot final) -> berhasil lewat /selesai', async () => {
  const { manager, o, sesiId, p } = await sesi(situs, '/kirim-warga', 'menyerah');
  try {
    await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'serahkan', alasan: 'tidak_yakin' }],
    });
    await expect.poll(() => manager.status(o).mode, { timeout: 10_000 }).toBe('takeover');
    const sebelum = situs.hitung('/sukses');
    await ketuk(manager, sesiId, 150, 340);
    await expect.poll(() => situs.hitung('/sukses'), { timeout: 10_000 }).toBe(sebelum + 1);
    // Tanpa ketukan kotak sorot final: tidak diterima otomatis, tetapi /selesai (Navigator) menerimanya karena
    // ada tulis warga dan halaman sukses.
    await new Promise((r) => setTimeout(r, 6_000));
    expect(manager.status(o).status).toBe('berjalan');
    await expect
      .poll(
        () =>
          manager
            .selesai(o)
            .then((v) => v.status)
            .catch(() => 'belum'),
        { timeout: 10_000 },
      )
      .toBe('siaga');
    expect(manager.status(o).hasil).toBe('berhasil');
  } finally {
    await manager.shutdown();
  }
});

test('N1 "Saya sudah mengirim": AI berhenti, /selesai 409 sebelum warga mengirim, berhasil sesudahnya', async () => {
  const { manager, o, sesiId, p } = await sesi(situs, '/kirim-warga', 'berhenti-kirim');
  try {
    // Halaman non-akhir: sukses otomatis tidak berlaku; hanya laporan warga (/selesai) yang diperiksa worker.
    expect(p.sinyal.halamanAkhir).toBe(false);
    await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'serahkan', alasan: 'berhenti' }],
    });
    await expect.poll(() => manager.status(o).mode, { timeout: 10_000 }).toBe('takeover');
    // Warga menekan "Saya sudah mengirim" sebelum mengirim: ditolak (belum ada tulis warga).
    await expect(manager.selesai(o)).rejects.toMatchObject({ status: 409 });
    const sebelum = situs.hitung('/sukses');
    await ketuk(manager, sesiId, 150, 340);
    await expect.poll(() => situs.hitung('/sukses'), { timeout: 10_000 }).toBe(sebelum + 1);
    await expect
      .poll(
        () =>
          manager
            .selesai(o)
            .then((v) => v.status)
            .catch(() => 'belum'),
        { timeout: 10_000 },
      )
      .toBe('siaga');
    expect(manager.status(o).hasil).toBe('berhasil');
  } finally {
    await manager.shutdown();
  }
});

for (const jalur of ['/dasbor', '/label', '/draf'])
  test(`N3 (PoC F ${jalur}): bukan sukses; /selesai = 409 tanpa pengiriman warga`, async () => {
    const { manager, o, sesiId, p } = await sesi(situs, jalur, `f${jalur.slice(1)}`);
    try {
      expect(p.sinyal.sukses).toBe(false);
      await manager.handleClient(sesiId, { type: 'ambil_alih' });
      await expect(manager.selesai(o)).rejects.toMatchObject({ status: 409 });
      expect(manager.status(o).status).toBe('berjalan');
    } finally {
      await manager.shutdown();
    }
  });

test('N7 (poc-centang): centang deklarasi/berkata kerja tulis tidak pernah dicentang AI', async () => {
  const { manager, o, p } = await sesi(situs, '/centang-n7', 'centang-n7');
  try {
    for (const nama of [
      'Data yang saya isi sesuai KTP dan KK',
      'Saya sudah membaca persyaratan layanan',
      'Kirim permohonan KK baru sekarang',
    ]) {
      const e = satu(p, nama);
      expect(e.terlarang, nama).toBe('pernyataan');
      const r = await manager.aksi(o, {
        ...o,
        rencanaHash: H,
        seq: p.seq,
        aksi: [{ jenis: 'centang', ref: e.ref, nilai: true }],
      });
      expect(['TERLARANG', 'HALAMAN_AKHIR'], nama).toContain(r.hasil[0]?.kode);
    }
  } finally {
    await manager.shutdown();
  }
});

test('mode ketat: redirect JS halaman akhir sendiri tidak lolos', async () => {
  const { manager, o, p } = await sesi(situs, '/akhir-alih', 'akhir-alih');
  try {
    expect(p.sinyal.halamanAkhir).toBe(true);
    await new Promise((r) => setTimeout(r, 3_500));
    expect((await manager.amati(o, true)).pengamatan.jalur).toBe('/akhir-alih');
    expect(manager.kurasJejak(o).catatan).toContainEqual(
      expect.objectContaining({ jenis: 'blokir', metode: 'GET', jendela: 'ai_diam' }),
    );
  } finally {
    await manager.shutdown();
  }
});

test('berhenti: serah akhir tanpa janji coba lagi; Lanjutkan tetap giliran warga', async () => {
  const { manager, o, sesiId, p } = await sesi(situs, '/s4-data', 'berhenti');
  const events: PendampingEvent[] = [];
  await manager.attach(sesiId, {
    send: (m: PendampingServerMessage) => void (m.type === 'event' && events.push(m.event)),
    frame: () => {},
    ack: () => {},
    close: () => {},
  });
  try {
    await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'serahkan', alasan: 'berhenti' }],
    });
    await expect.poll(() => manager.status(o).mode, { timeout: 10_000 }).toBe('takeover');
    const g = events.find((e) => e.jenis === 'giliran_anda' && e.alasan === 'berhenti');
    expect(g && 'pesan' in g ? g.pesan : '').not.toMatch(/coba lagi/i);
    await manager.handleClient(sesiId, { type: 'kembalikan' });
    await new Promise((r) => setTimeout(r, 300));
    expect(manager.status(o).mode).toBe('takeover');
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

test('N2: POST tertunda dari klik AI tidak lolos; halaman kotor dimuat ulang dan diserahkan ke warga', async () => {
  const { manager, o, sesiId, p } = await sesi(situs, '/tertunda', 'tertunda');
  const events: PendampingEvent[] = [];
  await manager.attach(sesiId, {
    send: (m: PendampingServerMessage) => void (m.type === 'event' && events.push(m.event)),
    frame: () => {},
    ack: () => {},
    close: () => {},
  });
  try {
    const r = await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'klik', ref: satu(p, 'Lanjut').ref }],
    });
    expect(r.hasil).toEqual([{ indeks: 0, kode: 'ok', kelas: 'lanjut' }]);
    // POST pertama muncul 1,5 detik sesudah klik (AI diam): halaman kotor -> muat ulang -> giliran warga.
    await expect.poll(() => manager.status(o).mode, { timeout: 10_000 }).toBe('takeover');
    await expect
      .poll(
        () => events.some((e) => e.jenis === 'giliran_anda' && e.pesan.includes('mengirim data sendiri')),
        {
          timeout: 10_000,
        },
      )
      .toBe(true);
    // Muat ulang mematikan timer: langkah 1 tampil lagi, select langkah 2 tersembunyi.
    const p2 = (await manager.amati(o)).pengamatan;
    expect(p2.jalur).toBe('/tertunda');
    expect(semua(p2, 'Jenis layanan')).toEqual([]);
    // AI tidak bisa menyentuh halaman selama giliran warga (PoC: pilih membuka jendela isi untuk POST tertunda).
    const pilih = await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p2.seq,
      aksi: [{ jenis: 'klik', ref: satu(p2, 'Lanjut').ref }],
    });
    expect(pilih.hasil[0]?.kode).not.toBe('ok');
    await new Promise((r) => setTimeout(r, 3_000));
    expect(situs.hitung('/api/final-b')).toBe(0);
    expect(manager.kurasJejak(o).catatan).toContainEqual(
      expect.objectContaining({ jenis: 'blokir', metode: 'POST', jendela: 'ai_diam' }),
    );
  } finally {
    await manager.shutdown();
  }
});

test('N4/A2: klik AI yang meninggalkan retry = dimuat ulang sebelum serah; kotor kedua = hanya submit asli', async () => {
  const { manager, o, sesiId, p } = await sesi(situs, '/retry-tanpa-batas', 'retry-tb');
  const events: PendampingEvent[] = [];
  await manager.attach(sesiId, {
    send: (m: PendampingServerMessage) => void (m.type === 'event' && events.push(m.event)),
    frame: () => {},
    ack: () => {},
    close: () => {},
  });
  const tunggu = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const pesanTerakhir = () =>
    events.filter((e) => e.jenis === 'giliran_anda').at(-1) as { pesan?: string } | undefined;
  try {
    const r = await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'klik', ref: satu(p, 'Lanjut').ref }],
    });
    expect(r.hasil).toEqual([{ indeks: 0, kode: 'GERBANG_MEMBLOKIR', kelas: 'lanjut' }]);
    expect(manager.status(o).mode).toBe('takeover');
    expect(pesanTerakhir()?.pesan).toContain('dimuat ulang');
    // Timer retry mati bersama dokumen lama: ketukan apa pun (termasuk tautan fragmen dan type=button) tidak
    // meloloskan apa-apa dari klik AI.
    for (const [x, y] of [
      [100, 400],
      [100, 540],
      [150, 665],
      [150, 705],
      [150, 745],
      [150, 135],
      [150, 175],
    ] as const) {
      await ketuk(manager, sesiId, x, y);
      await tunggu(700);
      expect(situs.hitung('/api/final-a'), `ketukan y=${y}`).toBe(0);
    }
    await manager.handleClient(sesiId, { type: 'text', teks: 'Budi' });
    await tunggu(1_000);
    expect(situs.hitung('/api/final-a')).toBe(0);
    // Kontrol positif: dokumen baru bersih, tombol type=button milik warga tetap mengirim.
    const wargaA = situs.hitung('/api/warga-a');
    await ketuk(manager, sesiId, 100, 620);
    await expect.poll(() => situs.hitung('/api/warga-a'), { timeout: 10_000 }).toBe(wargaA + 1);

    // Kotor kedua di URL yang sama: muat ulang sekali per URL sudah terpakai, timer hidup. Jendela tulis hanya
    // untuk kotak sorot atau tombol submit asli; tautan fragmen, type=button, dan kontrol isian tidak.
    await manager.handleClient(sesiId, { type: 'kembalikan' });
    await expect.poll(() => manager.status(o).mode, { timeout: 10_000 }).toBe('ai');
    const p2 = (await manager.amati(o)).pengamatan;
    const r2 = await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p2.seq,
      aksi: [{ jenis: 'klik', ref: satu(p2, 'Lanjut').ref }],
    });
    expect(r2.hasil).toEqual([{ indeks: 0, kode: 'GERBANG_MEMBLOKIR', kelas: 'lanjut' }]);
    expect(manager.status(o).mode).toBe('takeover');
    expect(pesanTerakhir()?.pesan).not.toContain('dimuat ulang');
    const wargaA2 = situs.hitung('/api/warga-a');
    for (const [x, y] of [
      [100, 400],
      [150, 665],
      [150, 135],
      [150, 175],
      [100, 620],
    ] as const) {
      await ketuk(manager, sesiId, x, y);
      await tunggu(1_000);
      expect(situs.hitung('/api/final-a'), `kotor kedua, ketukan y=${y}`).toBe(0);
    }
    expect(situs.hitung('/api/warga-a')).toBe(wargaA2);
    // Kontrol positif: tombol submit asli warga sampai.
    await ketuk(manager, sesiId, 150, 800);
    await expect.poll(() => situs.hitung('/api/warga-a2'), { timeout: 10_000 }).toBe(1);
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

test('review G4: tinjauan akhir + kolom wajib kosong tetap terkunci; Lanjut ditolak, redirect tidak lolos', async () => {
  const { manager, o, p } = await sesi(situs, '/akhir-catatan', 'akhir-catatan');
  try {
    expect(p.sinyal.halamanAkhir).toBe(true);
    const lanjut = satu(p, 'Lanjut');
    expect(lanjut.kelas).toBe('kirim');
    const r = await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'klik', ref: lanjut.ref }],
    });
    expect(r.hasil).toEqual([{ indeks: 0, kode: 'HALAMAN_AKHIR' }]);
    await new Promise((r) => setTimeout(r, 2_500));
    expect(situs.hitung('/permohonan/12/go4')).toBe(0);
    expect(situs.hitung('/api/final-g4')).toBe(0);
  } finally {
    await manager.shutdown();
  }
});

test('probe 3324/3404: pembuka kalender ui_lokal, tetapi klik AI di halaman akhir tetap ditolak', async () => {
  const { manager, o, p } = await sesi(situs, '/daftar-kalender', 'daftar-kalender');
  try {
    expect(p.sinyal.halamanAkhir).toBe(true);
    const kalender = satu(p, 'Buka kalender');
    expect(kalender.kelas).toBe('ui_lokal');
    expect(satu(p, 'Daftar Sekarang').kelas).toBe('kirim');
    const r = await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'klik', ref: kalender.ref }],
    });
    expect(r.hasil).toEqual([{ indeks: 0, kode: 'HALAMAN_AKHIR' }]);
    expect(situs.hitung('/api/daftar')).toBe(0);
  } finally {
    await manager.shutdown();
  }
});

test('probe gel4 3279: tombol MASUK khusus layar lebar -> viewport dilebarkan, dokumen lain kembali ke lebar ponsel', async () => {
  const { manager, o, p } = await sesi(situs, '/responsif', 'responsif');
  try {
    // Lebar ponsel (390) menyembunyikan MASUK; worker melebarkan ke 992 (batas lg) dan memberi tahu warga.
    expect(p.judul).toBe('lebar 992');
    expect(semua(p, 'MASUK').length).toBeGreaterThan(0);
    expect(manager.status(o).pesan).toBe(PESAN_LAYAR_LEBAR);
    // Tidak ada yang diklik worker saat melebarkan.
    expect(situs.hitung('/responsif-masuk')).toBe(0);
    const bantuan = semua(p, 'Bantuan').find((e) => e.kelas === 'navigasi');
    expect(bantuan).toBeTruthy();
    const r = await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'klik', ref: bantuan!.ref }],
    });
    expect(r.hasil[0]?.kode).toBe('ok');
    // Dokumen lain: kembali ke lebar ponsel.
    await expect
      .poll(async () => (await manager.amati(o)).pengamatan.judul, { timeout: 10_000 })
      .toBe('lebar 390');
  } finally {
    await manager.shutdown();
  }
});

test('probe gel4 3279: MASUK di menu collapse tertutup -> tidak dilebarkan (dibuka lewat menu)', async () => {
  const { manager, o, p } = await sesi(situs, '/responsif-menu', 'responsif-menu');
  try {
    expect(p.judul).toBe('lebar 390');
    expect(manager.status(o).pesan).not.toBe(PESAN_LAYAR_LEBAR);
    // QA prod gel6 Depok: menu hamburger dibuka sendiri (tanpa melebarkan layar), Masuk kini teramati.
    expect(semua(p, 'Masuk').map((e) => e.kelas)).toEqual(['navigasi']);
    expect(situs.hitung('/responsif-masuk')).toBe(0);
  } finally {
    await manager.shutdown();
  }
});

test('smoke 3279: situs 503 tanpa kendali sejak dokumen pertama -> sesi berakhir jujur (gangguan), bukan halaman kosong', async () => {
  const { manager, o } = await sesi(situs, '/gangguan-503', 'gangguan-503', false);
  try {
    await expect.poll(() => manager.status(o).status, { timeout: 20_000 }).toBe('gagal');
    expect(manager.status(o).pesan).toBe(pesanGangguan(new URL(situs.origin).host, 503));
  } finally {
    await manager.shutdown();
  }
});

test('smoke 3279: halaman 500 yang tetap berisi formulir tidak dianggap gangguan', async () => {
  const { manager, o, p } = await sesi(situs, '/galat-500-berisi', 'galat-500-berisi');
  try {
    expect(satu(p, 'NIK Pemohon')).toMatchObject({ peran: 'teks' });
    await new Promise((r) => setTimeout(r, 3_000));
    expect(manager.status(o).status).toBe('berjalan');
  } finally {
    await manager.shutdown();
  }
});

test('probe gel5 3402: "Masuk atau Daftar" pembuka offcanvas = ui_lokal; AI membukanya dan tautan Masuk muncul', async () => {
  const { manager, o, p } = await sesi(situs, '/panel-masuk', 'panel-masuk');
  try {
    const pembuka = satu(p, 'Masuk atau Daftar');
    expect(pembuka.kelas).toBe('ui_lokal');
    // Masuk di offcanvas tertutup: dibuka lewat panel, bukan dengan melebarkan layar.
    expect(p.judul).toBe('lebar 390');
    const r = await manager.aksi(o, {
      ...o,
      rencanaHash: H,
      seq: p.seq,
      aksi: [{ jenis: 'klik', ref: pembuka.ref }],
    });
    expect(r.hasil[0]?.kode).toBe('ok');
    await expect
      .poll(async () => semua((await manager.amati(o)).pengamatan, 'Masuk').map((e) => e.kelas), {
        timeout: 10_000,
      })
      .toEqual(['navigasi']);
    expect(situs.hitung('/responsif-masuk')).toBe(0);
  } finally {
    await manager.shutdown();
  }
});

test('probe gel5 3402: MASUK khusus layar lebar di halaman berformulir (bukan polos) tetap memicu pelebaran', async () => {
  const { manager, o, p } = await sesi(situs, '/responsif-form', 'responsif-form');
  try {
    expect(p.judul).toBe('lebar 992');
    expect(semua(p, 'MASUK').length).toBeGreaterThan(0);
    expect(manager.status(o).pesan).toBe(PESAN_LAYAR_LEBAR);
  } finally {
    await manager.shutdown();
  }
});

test('probe gel5 6171: konten dibuka sesudah data XHR lambat -> batas tunggu dari jaringan idle, tautan teramati', async () => {
  const { manager, p } = await sesi(situs, '/pudar-data', 'pudar-data');
  try {
    for (const nama of ['Kartu Keluarga Data', 'Akta Kelahiran Data', 'Pindah Datang Data'])
      expect(satu(p, nama).kelas, nama).toBe('navigasi');
  } finally {
    await manager.shutdown();
  }
});

test('QA gel6 Medan: load tertahan sumber daya menggantung -> pengamatan pertama tetap cepat (DOM siap), fase jujur', async () => {
  const t0 = Date.now();
  const { manager, o, p, events } = await sesi(situs, '/beranda-gantung', 'beranda-gantung', true, true);
  try {
    // Dulu: tunggu load sampai batas 10 dtk sebelum pengamatan pertama.
    expect(Date.now() - t0).toBeLessThan(8_000);
    expect(satu(p, 'Sudah punya akun? Masuk').kelas).toBe('navigasi');
    const fase = events.flatMap((e) => (e.jenis === 'langkah' ? [e.fase ?? e.label] : []));
    expect(fase).toEqual(expect.arrayContaining(['membuka', 'membaca']));
    expect(fase).not.toContain('mengisi');
    expect(manager.status(o).pesan).not.toMatch(/mengisi/i);
  } finally {
    await manager.shutdown();
  }
});

test('QA gel6 Depok: Login di menu offcanvas (pembuka aria-controls tanpa nama) terbuka sendiri dan teramati', async () => {
  const { manager, p } = await sesi(situs, '/menu-depok', 'menu-depok');
  try {
    expect(p.judul).toBe('lebar 390');
    expect(satu(p, 'Login').kelas).toBe('navigasi');
    expect(situs.hitung('/responsif-masuk')).toBe(0);
  } finally {
    await manager.shutdown();
  }
});
