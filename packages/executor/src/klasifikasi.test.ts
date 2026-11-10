import { afterEach, describe, expect, it } from 'vitest';
import {
  bolehDiklikAi,
  halamanAkhir,
  klasifikasi,
  normalTeks,
  putuskanKelas,
  type KelasKendali,
} from './klasifikasi.js';

afterEach(() => {
  document.body.innerHTML = '';
});

/** Pasang HTML lalu klasifikasikan elemen bertanda `data-uji` (DOM nyata happy-dom: form, dialog, gaya). */
function kelasDari(html: string): KelasKendali {
  document.body.innerHTML = html;
  const el = document.querySelector('[data-uji]');
  if (!el) throw new Error('fixture tanpa [data-uji]');
  return klasifikasi(el).kelas;
}

// Karakter khusus ditulis sebagai entitas HTML supaya terlihat jelas di sumber tes.
const CYR_I = '&#x456;'; // Kiril "і"
const CYR_A = '&#x430;'; // Kiril "а"
const ZWSP = '&#x200B;';
const BOM = '&#xFEFF;';

const TABEL: [string, string, KelasKendali][] = [
  // --- baris wajib dari spesifikasi §3 ---
  ['submit eksplisit bernama Lanjut', '<form><button type="submit" data-uji>Lanjut</button></form>', 'kirim'],
  ['button tanpa type di form', '<form><input name="q"><button data-uji>Lanjut</button></form>', 'kirim'],
  ['type=button Lanjut ›, sisi klien', '<button type="button" data-uji>Lanjut ›</button>', 'lanjut'],
  [
    'type=button Simpan dan Lanjutkan',
    '<button type="button" data-uji>Simpan dan Lanjutkan</button>',
    'kirim',
  ],
  ['tautan jalur selesai', '<a href="/pendaftaran/selesai/12" data-uji>Selesai</a>', 'kirim'],
  ['tautan Daftar Layanan', '<a href="/layanan/kk" data-uji>Daftar Layanan</a>', 'navigasi'],
  ['tautan data-method=delete', '<a href="/x" data-method="delete" data-uji>Lihat</a>', 'kirim'],
  [
    'aria-label Lanjut, teks KIRIM',
    '<button type="button" aria-label="Lanjut" data-uji>KIRIM</button>',
    'kirim',
  ],
  ['homoglif Kiril pada Kirim', `<button type="button" data-uji>K${CYR_I}rim</button>`, 'tidak_pasti'],
  [
    'ikon paper-plane tanpa nama',
    '<button type="button" data-uji><i class="fa fa-paper-plane"></i></button>',
    'kirim',
  ],
  [
    'Ya di modal "Yakin mengirim?"',
    '<div class="modal" role="dialog"><p>Yakin mengirim?</p><button type="button" data-uji>Ya</button></div>',
    'kirim',
  ],
  ['input type=image', '<input type="image" src="kirim.png" alt="Lanjut" data-uji>', 'kirim'],
  [
    'Lanjut di halaman pernyataan',
    '<p>Dengan ini saya menyatakan bahwa data di atas benar.</p><button type="button" data-uji>Lanjut</button>',
    'kirim',
  ],
  ['role=tab', '<div role="tablist"><div role="tab" data-uji>Data Anak</div></div>', 'ui_lokal'],
  [
    'checkbox Turnstile',
    '<div class="cf-turnstile"><iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile" data-uji></iframe></div>',
    'tantangan',
  ],
  ['tautan javascript:', '<a href="javascript:void(0)" data-uji>Detail</a>', 'tidak_pasti'],

  // --- aturan 1: tersembunyi / nonaktif ---
  ['display:none', '<button type="button" style="display:none" data-uji>Lanjut</button>', 'tidak_pasti'],
  [
    'visibility:hidden leluhur',
    '<div style="visibility:hidden"><button type="button" data-uji>Lanjut</button></div>',
    'tidak_pasti',
  ],
  ['opacity 0', '<button type="button" style="opacity:0" data-uji>Lanjut</button>', 'tidak_pasti'],
  ['aria-hidden leluhur', '<div aria-hidden="true"><a href="/info" data-uji>Info</a></div>', 'tidak_pasti'],
  ['disabled', '<button type="button" disabled data-uji>Lanjut</button>', 'tidak_pasti'],
  ['aria-disabled', '<button type="button" aria-disabled="true" data-uji>Lanjut</button>', 'tidak_pasti'],
  [
    'fieldset disabled',
    '<fieldset disabled><button type="button" data-uji>Lanjut</button></fieldset>',
    'tidak_pasti',
  ],
  ['inert', '<div inert><button type="button" data-uji>Lanjut</button></div>', 'tidak_pasti'],

  // --- aturan 2: tantangan ---
  [
    'reCAPTCHA checkbox',
    '<div class="g-recaptcha"><div role="checkbox" data-uji>Saya bukan robot</div></div>',
    'tantangan',
  ],

  // --- aturan 3: masuk ---
  [
    'submit di form login',
    '<form><input type="password" name="p"><button type="submit" data-uji>Masuk</button></form>',
    'masuk',
  ],
  [
    'type=button Masuk di form bersandi',
    '<form><input type="password" name="p"><button type="button" data-uji>Masuk</button></form>',
    'masuk',
  ],
  ['tombol Login tanpa form', '<button type="button" data-uji>Login</button>', 'masuk'],

  // --- aturan 4: submitter asli, apa pun teksnya ---
  ['input submit Berikutnya', '<form><input type="submit" value="Berikutnya" data-uji></form>', 'kirim'],
  [
    'button type tak dikenal di form = submit',
    '<form><button type="lanjut" data-uji>Lanjut</button></form>',
    'kirim',
  ],
  ['button tanpa type di form = submit', '<form><button data-uji>Selanjutnya</button></form>', 'kirim'],
  [
    'button tanpa type dengan atribut form= = submit',
    '<form id="f1"></form><button form="f1" data-uji>Selanjutnya</button>',
    'kirim',
  ],
  [
    'button type=submit eksplisit di luar form = submit',
    '<button type="submit" data-uji>Lanjut</button>',
    'kirim',
  ],
  // Probe: tombol tanpa type di luar form tidak mengirim apa pun (menu seluler, wizard JS) = tombol biasa.
  ['button tanpa type di luar form = tombol biasa', '<button data-uji>Selanjutnya</button>', 'lanjut'],
  [
    'button type tak dikenal di luar form = tombol biasa',
    '<button type="lanjut" data-uji>Lanjut</button>',
    'lanjut',
  ],
  [
    'toggler menu seluler tanpa type di luar form',
    '<button class="navbar-toggler" aria-expanded="false" data-uji>Menu</button>',
    'ui_lokal',
  ],
  ['tombol tanpa type bernama Kirim di luar form tetap NEG', '<button data-uji>Kirim</button>', 'kirim'],

  // --- aturan 5: atribut berbahaya ---
  ['formaction', '<button type="button" formaction="/simpan" data-uji>Lanjut</button>', 'kirim'],
  [
    'onclick submit()',
    '<button type="button" onclick="document.forms[0].submit()" data-uji>Lanjut</button>',
    'kirim',
  ],
  ['href # dengan $.post', `<a href="#" onclick="$.post('/x')" data-uji>Lihat</a>`, 'kirim'],
  [
    'onclick fetch',
    `<button type="button" onclick="fetch('/api',{method:'POST'})" data-uji>Lanjut</button>`,
    'kirim',
  ],
  ['onclick confirm()', `<a href="/info" onclick="return confirm('Yakin?')" data-uji>Info</a>`, 'kirim'],
  ['htmx hx-post', '<button type="button" hx-post="/simpan" data-uji>Lanjut</button>', 'kirim'],
  ['data-confirm', '<button type="button" data-confirm="Yakin?" data-uji>Lanjut</button>', 'kirim'],

  // --- aturan 6: dialog konfirmasi ---
  ['alertdialog', '<div role="alertdialog"><button type="button" data-uji>Lanjut</button></div>', 'kirim'],

  // --- aturan 7: NEG pada nama/ikon/jalur ---
  ['Ya', '<button type="button" data-uji>Ya</button>', 'kirim'],
  ['OK', '<button type="button" data-uji>OK</button>', 'kirim'],
  ['Batal', '<button type="button" data-uji>Batal</button>', 'kirim'],
  ['Daftar (tombol)', '<button type="button" data-uji>Daftar</button>', 'kirim'],
  [
    'aria-label Hapus, teks Lanjut',
    '<button type="button" aria-label="Hapus" data-uji>Lanjut</button>',
    'kirim',
  ],
  [
    'aria-label Simpan, teks Lanjut',
    '<button type="button" aria-label="Simpan" data-uji>Lanjut</button>',
    'kirim',
  ],
  ['zero-width di dalam Kirim', `<button type="button" data-uji>Kir${ZWSP}im</button>`, 'kirim'],
  [
    'KIRIM lebar penuh (NFKD)',
    '<button type="button" data-uji>&#xFF2B;&#xFF29;&#xFF32;&#xFF29;&#xFF2D;</button>',
    'kirim',
  ],
  [
    'tombol berikon material send',
    '<button type="button" data-uji><span class="material-icons">send</span></button>',
    'kirim',
  ],
  ['id btnSubmit', '<button type="button" id="btnSubmit" data-uji>Lanjut</button>', 'kirim'],
  ['tautan /logout', '<a href="/logout" data-uji>Profil</a>', 'kirim'],
  ['tautan kueri aksi=hapus', '<a href="/permohonan?aksi=hapus&id=3" data-uji>Lihat</a>', 'kirim'],
  ['tautan download', '<a href="/panduan.pdf" download data-uji>Panduan</a>', 'kirim'],
  ['tautan Unduh Formulir', '<a href="/formulir" data-uji>Unduh Formulir</a>', 'kirim'],
  ['tautan Keluar', '<a href="/akun" data-uji>Keluar</a>', 'kirim'],

  // --- teks curiga: tidak pernah positif ---
  ['homoglif Kiril pada Lanjut', `<button type="button" data-uji>L${CYR_A}njut</button>`, 'tidak_pasti'],
  ['zero-width di Lanjut', `<button type="button" data-uji>Lan${ZWSP}jut</button>`, 'tidak_pasti'],
  ['BOM di akhir Lanjut', `<button type="button" data-uji>Lanjut${BOM}</button>`, 'tidak_pasti'],
  ['homoglif di tautan', `<a href="/info" data-uji>Inf${CYR_A}</a>`, 'tidak_pasti'],
  ['tombol tanpa nama', '<button type="button" data-uji></button>', 'tidak_pasti'],
  ['tautan gambar tanpa alt', '<a href="/" data-uji><img src="logo.png"></a>', 'tidak_pasti'],

  // --- aturan 8: navigasi GET bersih ---
  [
    'tautan Kartu Keluarga (bukan "keluar")',
    '<a href="/layanan/kartu-keluarga" data-uji>Kartu Keluarga</a>',
    'navigasi',
  ],
  ['tautan gambar ber-alt', '<a href="/" data-uji><img src="logo.png" alt="Beranda"></a>', 'navigasi'],
  ['tautan absolut', '<a href="https://contoh.go.id/info" data-uji>Informasi</a>', 'navigasi'],
  ['tautan target _blank', '<a href="/persyaratan" target="_blank" data-uji>Persyaratan</a>', 'navigasi'],
  ['tautan fragmen saja', '<a href="#bagian-2" data-uji>Bagian 2</a>', 'tidak_pasti'],

  // --- aturan 9: UI lokal ---
  [
    'dropdown data-bs-toggle',
    '<a href="#" data-bs-toggle="dropdown" aria-expanded="false" data-uji>Menu</a>',
    'ui_lokal',
  ],
  [
    'aria-controls',
    '<button type="button" aria-controls="p1" aria-expanded="false" data-uji>Rincian</button>',
    'ui_lokal',
  ],
  ['summary', '<details><summary data-uji>Syarat dokumen</summary><p>KTP</p></details>', 'ui_lokal'],
  ['data-toggle tab', '<a href="#tab2" data-toggle="tab" data-uji>Alamat</a>', 'ui_lokal'],

  // --- aturan 10: lanjut ---
  ['Selanjutnya', '<button type="button" data-uji>Selanjutnya</button>', 'lanjut'],
  ['Next', '<button type="button" data-uji>Next</button>', 'lanjut'],
  ['role=button Lanjutkan', '<div role="button" data-uji>Lanjutkan</div>', 'lanjut'],
  ['input type=button Lanjut', '<input type="button" value="Lanjut" data-uji>', 'lanjut'],
  ['aria-label setuju', '<button type="button" aria-label="Lanjut" data-uji>Lanjut</button>', 'lanjut'],
  [
    'aria-label tidak setuju',
    '<button type="button" aria-label="Detail" data-uji>Lanjut</button>',
    'tidak_pasti',
  ],
  ['bukan nama persis', '<button type="button" data-uji>Lanjut Isi Data</button>', 'tidak_pasti'],

  // --- aturan 11: lainnya ---
  ['type=reset', '<button type="reset" data-uji>Ulangi</button>', 'tidak_pasti'],
  ['tombol biasa lain', '<button type="button" data-uji>Lihat Detail</button>', 'tidak_pasti'],
  ['div tanpa peran', '<div data-uji>Lanjut</div>', 'tidak_pasti'],
  ['input teks', '<input type="text" name="nama" data-uji>', 'tidak_pasti'],

  // --- F3: kata kerja tulis di nama tautan; frasa menu persis saja yang dikecualikan ---
  ['tautan Ajukan Permohonan', '<a href="/permohonan/12/ajukan" data-uji>Ajukan Permohonan</a>', 'kirim'],
  ['tautan Daftar Sekarang', '<a href="/pendaftaran/proses?id=12" data-uji>Daftar Sekarang</a>', 'kirim'],
  ['tautan Proses Permohonan', '<a href="/permohonan/12/final" data-uji>Proses Permohonan</a>', 'kirim'],
  ['tautan Register', '<a href="/akta/register/12" data-uji>Register</a>', 'kirim'],
  ['tautan menu Status Pengajuan', '<a href="/cek/status" data-uji>Status Pengajuan</a>', 'navigasi'],
  ['tautan menu Alur Proses ›', '<a href="/informasi/alur" data-uji>Alur Proses ›</a>', 'navigasi'],
  ['menu aman tetapi jalur ajuan', '<a href="/pengajuan/12" data-uji>Status Pengajuan</a>', 'kirim'],
  ['tautan netral ke jalur final', '<a href="/permohonan/12/final" data-uji>Buka</a>', 'kirim'],
  ['tautan netral ke jalur terima', '<a href="/surat/terima?id=1" data-uji>Lihat</a>', 'kirim'],
  ['tautan netral ke jalur send', '<a href="/api/send/1" data-uji>Lihat</a>', 'kirim'],

  // --- N6 (PoC C): kata kerja tulis/pengesahan lain ---
  ['tautan Tanda Tangani Dokumen', '<a href="/dok/12/tte" data-uji>Tanda Tangani Dokumen</a>', 'kirim'],
  ['tautan Finalisasi Data', '<a href="/data/12/kunci" data-uji>Finalisasi Data</a>', 'kirim'],
  ['tautan Serahkan Berkas', '<a href="/berkas/12/serah" data-uji>Serahkan Berkas</a>', 'kirim'],
  ['tautan TTE', '<a href="/dok/12" data-uji>TTE</a>', 'kirim'],
  ['tautan Setor Berkas', '<a href="/berkas/12" data-uji>Setor Berkas</a>', 'kirim'],
  ['tautan Sahkan', '<a href="/dok/12" data-uji>Sahkan Dokumen</a>', 'kirim'],
  ['tautan Terbitkan', '<a href="/dok/12" data-uji>Terbitkan Akta</a>', 'kirim'],
  ['tautan Laporkan', '<a href="/dok/12" data-uji>Laporkan Kelahiran</a>', 'kirim'],
  ['tautan Kunci Data', '<a href="/dok/12" data-uji>Kunci Data</a>', 'kirim'],
  ['tautan netral ke jalur tanda-tangan', '<a href="/dok/12/tanda-tangan" data-uji>Buka</a>', 'kirim'],
  ['tautan netral ke jalur tte', '<a href="/dok/12/tte" data-uji>Buka</a>', 'kirim'],
  ['tombol Tanda Tangan', '<button type="button" data-uji>Tanda Tangan</button>', 'kirim'],
  [
    'tautan Lanjutkan Permohonan tetap navigasi',
    '<a href="/permohonan/12/lanjutkan" data-uji>Lanjutkan Permohonan</a>',
    'navigasi',
  ],

  // --- F4: aktivator leluhur dan kontrol label; kelas paling ketat menang ---
  [
    'span role=button Lanjut di dalam button submit',
    '<form method="post" action="/ajukan"><button type="submit"><span role="button" data-uji>Lanjut</span></button></form>',
    'kirim',
  ],
  [
    'label role=button Lanjut untuk submit di luar layar',
    '<form method="post" action="/ajukan"><label for="k" role="button" data-uji>Lanjut</label><button id="k" type="submit">x</button></form>',
    'kirim',
  ],
  [
    'span role=button Lanjut di dalam button tanpa type (GET ke iframe)',
    '<form method="get" action="/permohonan/kirim" target="sink"><button><span role="button" data-uji>Lanjut</span></button></form>',
    'kirim',
  ],
  [
    'span role=button Lanjut di dalam tautan jalur kirim',
    '<a href="/permohonan/kirim"><span role="button" data-uji>Lanjut</span></a>',
    'kirim',
  ],
  [
    'span role=button Lanjut di dalam button type=button',
    '<button type="button"><span role="button" data-uji>Lanjut</span></button>',
    'lanjut',
  ],
];

describe('klasifikator klik final (tabel §3)', () => {
  it('tabel memuat minimal 40 baris', () => {
    expect(TABEL.length).toBeGreaterThanOrEqual(40);
  });

  it.each(TABEL)('%s', (_judul, html, harapan) => {
    expect(kelasDari(html)).toBe(harapan);
  });

  it('handler fetch POST lewat addEventListener tetap "lanjut" (gerbang tulis worker yang memblokir)', () => {
    document.body.innerHTML = '<button type="button" data-uji>Lanjut ›</button>';
    const el = document.querySelector('[data-uji]')!;
    el.addEventListener('click', () => void fetch('/api/simpan', { method: 'POST' }).catch(() => undefined));
    expect(klasifikasi(el).kelas).toBe('lanjut');
  });

  it('AI hanya boleh mengklik navigasi, ui_lokal, lanjut', () => {
    const semua: KelasKendali[] = [
      'navigasi',
      'ui_lokal',
      'lanjut',
      'kirim',
      'masuk',
      'tantangan',
      'tidak_pasti',
    ];
    expect(semua.filter(bolehDiklikAi)).toEqual(['navigasi', 'ui_lokal', 'lanjut']);
  });

  it('aturan pertama yang cocok menang dan id aturan dicatat', () => {
    document.body.innerHTML =
      '<form><input type="password"><button type="submit" style="display:none" data-uji>Masuk</button></form>';
    expect(klasifikasi(document.querySelector('[data-uji]')!).aturan).toBe('K1_TERSEMBUNYI');
    document.body.innerHTML = '<form><button type="submit" data-uji>Lanjut</button></form>';
    expect(klasifikasi(document.querySelector('[data-uji]')!).aturan).toBe('K4_SUBMITTER');
  });

  it('putuskanKelas murni: fitur yang sama selalu memberi kelas yang sama', () => {
    document.body.innerHTML = '<button type="button" data-uji>Lanjut</button>';
    const { fitur } = klasifikasi(document.querySelector('[data-uji]')!);
    expect(putuskanKelas(fitur)).toEqual(putuskanKelas({ ...fitur }));
    expect(putuskanKelas({ ...fitur, submitterAsli: true }).kelas).toBe('kirim');
    expect(putuskanKelas({ ...fitur, teksCuriga: true }).kelas).toBe('tidak_pasti');
  });

  it('normalTeks: NFKD, huruf kecil, diakritik dibuang, karakter tak terlihat dipertahankan', () => {
    expect(normalTeks('  Lanjútkan \n ')).toBe('lanjutkan');
    expect(normalTeks('ＫＩＲＩＭ'.normalize('NFC'))).toBe('kirim');
    expect(normalTeks(`a${String.fromCharCode(0x200b)}b`)).toHaveLength(3);
    expect(normalTeks(`a${String.fromCharCode(0xfeff)}`)).toHaveLength(2);
  });
});

describe('K7_NEG_NAMA_TAUTAN: tautan yang kena NEG hanya lewat nama', () => {
  const aturan = (html: string) => {
    document.body.innerHTML = html;
    return klasifikasi(document.querySelector('[data-uji]')!);
  };

  it('nama saja (jalur/id/ikon bersih) = kirim dengan aturan tersendiri', () => {
    for (const html of [
      // N6: menu "Laporan" tetap tautan pembuka (warga membukanya lewat tombol Buka).
      '<a href="/laporan/kelahiran" data-uji>Laporan Kelahiran</a>',
      '<a href="/permohonan/kk" data-uji>Ajukan Permohonan Kartu Keluarga</a>',
      '<a href="/formulir" data-uji>Mulai Pendaftaran</a>',
      '<a href="/layanan/akta" data-uji>Proses Akta Kelahiran</a>',
      // Ikon NEG tidak menambah apa pun pada tautan GET bersih: nama yang menentukan.
      '<a href="/permohonan/kk" data-uji><i class="fa fa-paper-plane"></i> Ajukan</a>',
    ])
      expect(aturan(html)).toMatchObject({ kelas: 'kirim', aturan: 'K7_NEG_NAMA_TAUTAN' });
  });

  it('NEG lewat jalur/id/ikon/unduhan/atribut, atau bukan tautan GET = K7_NEG biasa', () => {
    for (const html of [
      '<a href="/permohonan/12/ajukan" data-uji>Ajukan Permohonan</a>',
      '<a href="/permohonan/kk" class="btn-submit" data-uji>Ajukan Permohonan</a>',
      '<a href="/permohonan/kk" class="fa fa-paper-plane" data-uji>Ajukan</a>',
      '<a href="/permohonan/kk" download data-uji>Ajukan Permohonan</a>',
      '<a href="#" data-uji>Ajukan Permohonan</a>',
      '<a href="javascript:void(0)" data-uji>Ajukan Permohonan</a>',
      '<button type="button" data-uji>Ajukan Permohonan</button>',
    ])
      expect(aturan(html), html).toMatchObject({ kelas: 'kirim', aturan: expect.not.stringMatching(/NAMA/) });
  });

  it('probe SIDAK: ikon feather credit-card pada tautan layanan GET = pembuka (K7_NEG_IKON_TAUTAN)', () => {
    const sidak = (nama: string, jalur: string) =>
      `<a class="nav-link" href="${jalur}" data-uji><svg class="feather feather-credit-card"></svg><span>${nama}</span></a>`;
    for (const [nama, jalur] of [
      ['KIA', '/layanan/kia'],
      ['KK', '/layanan/kk'],
      ['KTP-el', '/layanan/ktp-el'],
    ] as const)
      expect(aturan(sidak(nama, jalur)), nama).toMatchObject({
        kelas: 'kirim',
        aturan: 'K7_NEG_IKON_TAUTAN',
      });
    // Ikon NEG pada tombol / tautan tidak bersih tetap K7_NEG.
    expect(aturan('<button type="button" data-uji><i class="fa fa-trash"></i> Data</button>')).toMatchObject({
      kelas: 'kirim',
      aturan: 'K7_NEG',
    });
    expect(aturan('<a href="/x/12/hapus" data-uji><i class="fa fa-trash"></i> Data</a>')).toMatchObject({
      kelas: 'kirim',
      aturan: 'K7_NEG',
    });
    expect(aturan('<a href="#" data-uji><i class="fa fa-print"></i> Data</a>')).toMatchObject({
      kelas: 'kirim',
      aturan: 'K7_NEG',
    });
  });

  it('probe 1901: tautan di dalam <button type=button> tanpa sinyal tetap navigasi', () => {
    expect(
      aturan(
        '<button type="button" class="btn btn-info"><a class="button active" href="/jenis-layanan" data-uji>Jenis Layanan</a></button>',
      ),
    ).toMatchObject({ kelas: 'navigasi', aturan: 'K8_NAVIGASI' });
    // Pembungkus yang mengirim / berbahaya / bernama NEG tetap mengunci.
    for (const html of [
      '<form><button><a href="/jenis-layanan" data-uji>Jenis Layanan</a></button></form>',
      '<button type="button" onclick="fetch(\'/x\',{method:\'POST\'})"><a href="/l" data-uji>Lihat</a></button>',
      '<button type="button" aria-label="Kirim"><a href="/l" data-uji>Lihat</a></button>',
    ])
      expect(bolehDiklikAi(aturan(html).kelas), html).toBe(false);
  });

  it('<base href>: host/jalur tautan dihitung dari baseURI (URL yang benar-benar dibuka)', () => {
    const base = document.createElement('base');
    base.href = 'https://contoh.go.id/permohonan/12/';
    document.head.appendChild(base);
    try {
      document.body.innerHTML = '<a href="ajukan" data-uji>Detail</a>';
      const k = klasifikasi(document.querySelector('[data-uji]')!);
      expect(k.fitur.href).toMatchObject({ host: 'contoh.go.id', jalur: '/permohonan/12/ajukan' });
      expect(k).toMatchObject({ kelas: 'kirim', aturan: 'K7_NEG' });
    } finally {
      base.remove();
    }
  });

  it('data-method non-GET tetap K5_ATRIBUT', () => {
    expect(aturan('<a href="/permohonan/kk" data-method="post" data-uji>Ajukan</a>')).toMatchObject({
      kelas: 'kirim',
      aturan: 'K5_ATRIBUT',
    });
  });
});

describe('halamanAkhir', () => {
  const akhir = (html: string) => {
    document.body.innerHTML = html;
    return halamanAkhir(document);
  };

  it('frasa pernyataan / tinjauan menandai halaman akhir (halaman berformulir/bertombol)', () => {
    const b = '<button type="button">Kirim</button>';
    expect(akhir(`<p>Dengan ini saya menyatakan bahwa data yang saya isi adalah benar.</p>${b}`)).toBe(true);
    expect(akhir(`<h2>Periksa kembali data Anda</h2>${b}`)).toBe(true);
    expect(akhir('<h2>Ringkasan Permohonan</h2><form><input name="catatan"></form>')).toBe(true);
    expect(akhir(`<h3>Konfirmasi Pengajuan</h3>${b}`)).toBe(true);
    // Tanpa kolom/tombol sama sekali: tidak ada yang bisa dikirim, bukan halaman akhir.
    expect(akhir('<h3>Konfirmasi Pengajuan</h3><p>Teks saja.</p>')).toBe(false);
  });

  it('probe 1971: "konfirmasi pendaftaran" di FAQ akordeon beranda bukan halaman akhir', () => {
    // Meniru beranda SIPELANGI: hero + pencarian + FAQ akordeon (jawaban terlipat) + kaki.
    const html = `<nav class="navbar"><a class="navbar-brand" href="/">Si Pelangi</a>
      <button class="navbar-toggler" type="button">Toggle navigation</button></nav>
      <section><h1>Sistem Informasi Pengajuan</h1><a class="btn btn-primary" href="/permohonan/buat">Buat Permohonan</a>
      <form action="/cari"><input name="keyword"><button class="btn">Cari</button></form></section>
      <section><h2>Temukan Jawaban untuk Pertanyaan Kamu</h2>
      <div class="accordion" id="faq"><div class="accordion-item">
        <div class="accordion-header collapsed" role="button">Bagaimana proses registrasi sebagai Agen?</div>
        <div class="accordion-collapse collapse"><div class="accordion-body">Isi formulir lalu tunggu email
          konfirmasi pendaftaran dari admin. Periksa kembali data Anda sebelum mengirim.</div></div></div></div></section>
      <footer><p>Dengan ini kami menyatakan layanan gratis.</p></footer>`;
    expect(akhir(html)).toBe(false);
    // Kontrol: frasa yang sama di isi halaman (bukan FAQ) tetap mengunci.
    expect(
      akhir(html.replace('<h1>Sistem Informasi Pengajuan</h1>', '<h1>Konfirmasi Pendaftaran</h1>')),
    ).toBe(true);
  });

  it('checkbox pernyataan yang terlihat menandai halaman akhir; tersembunyi tidak', () => {
    expect(akhir('<label><input type="checkbox"> Saya setuju dengan syarat dan ketentuan</label>')).toBe(
      true,
    );
    expect(
      akhir(
        '<label style="display:none"><input type="checkbox"> Saya setuju dengan syarat dan ketentuan</label>',
      ),
    ).toBe(false);
  });

  it('pernyataan diperluas (benar, paham, konsekuensi, bersedia, sanksi) menandai halaman akhir', () => {
    expect(
      akhir('<label><input type="checkbox"> Data di atas sudah benar dan saya pahami konsekuensinya</label>'),
    ).toBe(true);
    expect(akhir('<label><input type="checkbox"> Saya bersedia menerima sanksi</label>')).toBe(true);
    expect(akhir('<label><input type="checkbox"> Alamat domisili sama dengan KTP</label>')).toBe(false);
  });

  it('halaman formulir biasa bukan halaman akhir; frasa di dalam textarea/skrip diabaikan', () => {
    expect(akhir('<h1>Formulir Permohonan KK</h1><label>Nama <input></label><button>Lanjut</button>')).toBe(
      false,
    );
    expect(
      akhir('<textarea>Dengan ini saya menyatakan</textarea><script>"dengan ini saya menyatakan"</script>'),
    ).toBe(false);
  });
});
