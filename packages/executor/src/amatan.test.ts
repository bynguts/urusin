import { afterEach, describe, expect, it } from 'vitest';
import { PengamatanSchema } from '@urusin/contracts';
import { BATAS_AMATAN, bangunPengamatan, elemenDariJalur, ikatUlang, sidikElemen } from './amatan.js';
import { setNativeValue } from './runner-ops.js';

afterEach(() => {
  document.body.innerHTML = '';
  document.title = '';
});

const amati = (diisi?: Record<string, string>) => bangunPengamatan(document, { seq: 7, diisi });
const elemenBernama = (p: ReturnType<typeof amati>['pengamatan'], nama: string) =>
  p.elemen.find((e) => e.nama === nama);

const FORM = `
  <h1>Permohonan Kartu Keluarga</h1>
  <div role="alert">Lengkapi kolom bertanda *</div>
  <p>Paragraf biasa yang tidak ikut teks pengamatan.</p>
  <form id="f">
    <label for="nik">NIK *</label><input id="nik" name="nik" required placeholder="16 digit">
    <label>Nama Lengkap <input name="nama"></label>
    <input name="email" type="email" placeholder="Surel aktif">
    <table><tr><td>Tanggal Lahir</td><td><input name="tgl" type="date"></td></tr></table>
    <input name="umur" type="number" aria-label="Umur" value="17">
    <textarea name="alamat" aria-label="Alamat">Alamat bawaan situs</textarea>
    <select name="agama" aria-label="Agama"><option value="">-- Pilih --</option><option value="1">Islam</option><option value="2">Kristen</option></select>
    <fieldset><legend>Jenis Kelamin</legend>
      <label><input type="radio" name="jk" value="L"> Laki-laki</label>
      <label><input type="radio" name="jk" value="P"> Perempuan</label>
    </fieldset>
    <label><input type="checkbox" name="setuju"> Dengan ini saya menyatakan data benar</label>
    <label><input type="checkbox" name="kabar" checked> Kirimi saya kabar</label>
    <label>Kata Sandi <input type="password" name="pw"></label>
    <label>Kode OTP <input name="kode" autocomplete="one-time-code"></label>
    <div><img src="/captcha.php" alt="captcha"><input name="cap" placeholder="Ketik kode di gambar"></div>
    <label>Berkas KTP <input type="file" name="ktp"></label>
    <div><input name="hp" aria-invalid="true" aria-label="Nomor HP"><span class="invalid-feedback">Nomor HP wajib diisi</span></div>
    <input type="hidden" name="_token" value="rahasia-csrf">
    <button type="button">Lanjut</button>
    <button type="submit">Kirim</button>
  </form>
  <a href="/layanan">Daftar Layanan</a>
  <div role="tab">Data Anak</div>`;

describe('bangunPengamatan', () => {
  it('elemen: ref, peran, nama dari label, petunjuk, wajib, opsi, kelas, form, terlarang, galat', () => {
    document.title = 'Formulir KK - Disdukcapil';
    document.body.innerHTML = FORM;
    const { pengamatan: p, peta } = amati();
    const by = (nama: string) => p.elemen.find((e) => e.nama === nama);

    expect(p.v).toBe(1);
    expect(p.seq).toBe(7);
    expect(p.host).toBe('localhost:3000');
    expect(p.jalur).toBe('/');
    expect(p.judul).toBe('Formulir KK - Disdukcapil');
    expect(p.elemen.map((e) => e.ref)).toEqual(p.elemen.map((_, i) => `e${i + 1}`));
    expect(Object.keys(peta)).toEqual(p.elemen.map((e) => e.ref));

    expect(by('NIK')).toMatchObject({
      peran: 'teks',
      wajib: true,
      petunjuk: '16 digit',
      isian: 'kosong',
      form: 'f0',
    });
    expect(by('Nama Lengkap')).toMatchObject({ peran: 'teks', isian: 'kosong' });
    expect(by('Surel aktif')).toMatchObject({ peran: 'teks' }); // placeholder sebagai nama
    expect(by('Tanggal Lahir')).toMatchObject({ peran: 'tanggal' }); // sel tabel tetangga
    expect(by('Umur')).toMatchObject({ peran: 'angka', isian: 'terisi_situs' });
    expect(by('Alamat')).toMatchObject({ peran: 'area', isian: 'terisi_situs' });
    expect(by('Agama')).toMatchObject({
      peran: 'pilihan',
      opsi: ['-- pilih --', 'islam', 'kristen'],
      isian: 'kosong',
    });
    expect(by('Jenis Kelamin')).toMatchObject({
      peran: 'radio',
      opsi: ['Laki-laki', 'Perempuan'],
      isian: 'kosong',
    });
    expect(by('Dengan ini saya menyatakan data benar')).toMatchObject({
      peran: 'centang',
      terlarang: 'pernyataan',
    });
    expect(by('Kirimi saya kabar')).toMatchObject({ peran: 'centang', isian: 'terisi_situs' });
    expect(by('Kata Sandi')).toMatchObject({ terlarang: 'sandi' });
    expect(by('Kode OTP')).toMatchObject({ terlarang: 'otp' });
    expect(by('Ketik kode di gambar')).toMatchObject({ terlarang: 'captcha' });
    expect(by('Berkas KTP')).toMatchObject({ peran: 'berkas', isian: 'kosong' });
    expect(by('Nomor HP')).toMatchObject({ galat: 'Nomor HP wajib diisi' });
    expect(by('Lanjut')).toMatchObject({ peran: 'tombol', kelas: 'kirim' }); // halaman memuat pernyataan
    expect(by('Kirim')).toMatchObject({ peran: 'tombol', kelas: 'masuk' }); // submitter di form bersandi
    expect(by('Daftar Layanan')).toMatchObject({ peran: 'tautan', kelas: 'kirim' });
    expect(by('Data Anak')).toMatchObject({ peran: 'tab' });
    expect(p.elemen.some((e) => e.nama.includes('_token'))).toBe(false);

    expect(p.sinyal).toEqual({
      login: true,
      otp: true,
      captcha: true,
      tantangan: false,
      halamanAkhir: true,
      sukses: false,
      galatForm: true,
    });
    // teks hanya judul + peringatan, bukan paragraf biasa
    expect(p.teks).toContain('Permohonan Kartu Keluarga');
    expect(p.teks).toContain('Lengkapi kolom bertanda *');
    expect(p.teks).not.toContain('Paragraf biasa');
    expect(p.sidik).toMatch(/^[0-9a-f]{14}$/);
  });

  it('formulir biasa tanpa pernyataan: tombol type=button Lanjut = lanjut, tautan = navigasi', () => {
    document.body.innerHTML = `<form><label>Nama <input name="n"></label><button type="button">Lanjut</button></form>
      <a href="/layanan">Daftar Layanan</a><div role="tab">Data Anak</div>`;
    const { pengamatan: p } = amati();
    expect(p.sinyal.halamanAkhir).toBe(false);
    expect(p.elemen.map((e) => [e.nama, e.kelas])).toEqual([
      ['Nama', undefined],
      ['Lanjut', 'lanjut'],
      ['Daftar Layanan', 'navigasi'],
      ['Data Anak', 'ui_lokal'],
    ]);
  });

  it('tautanPembuka hanya untuk tautan GET yang kirim karena nama saja', () => {
    document.body.innerHTML = `<a href="/permohonan/kk">Ajukan Permohonan Kartu Keluarga</a>
      <a href="/permohonan/12/ajukan">Ajukan Sekarang</a>
      <a href="/layanan">Daftar Layanan</a>
      <button type="button">Ajukan</button>`;
    const { pengamatan: p } = amati();
    expect(PengamatanSchema.safeParse(p).success).toBe(true);
    expect(p.elemen.map((e) => [e.nama, e.kelas, e.tautanPembuka])).toEqual([
      ['Ajukan Permohonan Kartu Keluarga', 'kirim', true],
      ['Ajukan Sekarang', 'kirim', undefined],
      ['Daftar Layanan', 'navigasi', undefined],
      ['Ajukan', 'kirim', undefined],
    ]);
    expect(elemenBernama(p, 'Daftar Layanan')).not.toHaveProperty('tautanPembuka');
  });

  it('tautan di halaman akhir tidak pernah ditandai pembuka', () => {
    document.body.innerHTML = `<label><input type="checkbox"> Dengan ini saya menyatakan data benar</label>
      <a href="/permohonan/kk">Ajukan Permohonan</a>`;
    const { pengamatan: p } = amati();
    expect(p.sinyal.halamanAkhir).toBe(true);
    expect(elemenBernama(p, 'Ajukan Permohonan')).toMatchObject({ kelas: 'kirim' });
    expect(elemenBernama(p, 'Ajukan Permohonan')).not.toHaveProperty('tautanPembuka');
  });

  it('isian: kosong / terisi_situs / terisi_warga / placeholder yang diisi worker', () => {
    document.body.innerHTML = `<label>A <input name="a"></label><label>B <input name="b" value="bawaan"></label>
      <label>C <input name="c"></label><label>D <input name="d"></label>
      <select aria-label="S" name="s"><option value="x">X</option><option value="y">Y</option></select>
      <label><input type="checkbox" name="k"> K</label>`;
    const [, , c, d] = [...document.querySelectorAll('input')];
    setNativeValue(c!, 'diketik warga');
    setNativeValue(d!, 'diisi worker');
    (document.querySelector('select') as HTMLSelectElement).selectedIndex = 1;
    (document.querySelector('input[type=checkbox]') as HTMLInputElement).checked = true;
    const diisi = { [sidikElemen(d!)]: '{{PEMOHON.NAMA}}' };
    const isian = amati(diisi).pengamatan.elemen.map((e) => [e.nama, e.isian]);
    expect(isian).toEqual([
      ['A', 'kosong'],
      ['B', 'terisi_situs'],
      ['C', 'terisi_warga'],
      ['D', '{{PEMOHON.NAMA}}'],
      ['S', 'terisi_warga'],
      ['K', 'terisi_warga'],
    ]);
  });

  it('sinyal: tantangan Cloudflare/Turnstile, sukses dengan nomor pendaftaran', () => {
    document.title = 'Just a moment...';
    document.body.innerHTML = '<div id="challenge-running"></div>';
    expect(amati().pengamatan.sinyal.tantangan).toBe(true);
    document.title = 'Formulir';
    document.body.innerHTML =
      '<div class="cf-turnstile"><iframe src="https://challenges.cloudflare.com/turnstile/if/ov2"></iframe></div>';
    expect(amati().pengamatan.sinyal.tantangan).toBe(true);
    document.body.innerHTML = '<h2>Pendaftaran berhasil</h2><p>Nomor Registrasi: REG-2026-000123</p>';
    expect(amati().pengamatan.sinyal).toMatchObject({ sukses: true, tantangan: false, login: false });
  });

  it('probe SIDAK: tautan layanan berikon credit-card = tautanPembuka, toggler menu = ui_lokal', () => {
    document.body.innerHTML = `<button class="navbar-toggler" aria-expanded="false">Menu</button>
      <a class="nav-link" href="/layanan/kk"><svg class="feather feather-credit-card"></svg><span>KK</span></a>`;
    const { pengamatan: p } = amati();
    expect(p.elemen.map((e) => [e.nama, e.kelas, e.tautanPembuka])).toEqual([
      ['Menu', 'ui_lokal', undefined],
      ['KK', 'kirim', true],
    ]);
  });

  it('probe 1102: tag ber-namespace (<cms:render>) tetap menghasilkan jalur yang bisa di-resolve', () => {
    document.body.innerHTML = `<cms:render><div><label>Nama <input name="n"></label>
      <a href="/layanan">Layanan</a></div></cms:render><cms:render><a href="/kontak">Kontak</a></cms:render>`;
    const { pengamatan: p, peta } = amati();
    expect(p.elemen.map((e) => e.nama)).toEqual(['Nama', 'Layanan', 'Kontak']);
    for (const e of p.elemen) {
      const el = elemenDariJalur(document, peta[e.ref]!.jalur);
      expect(el, peta[e.ref]!.jalur).not.toBeNull();
      expect(sidikElemen(el!)).toBe(peta[e.ref]!.sidik);
    }
  });

  it('sukses positif: judul hasil, alert, popup SweetAlert, nomor berdigit', () => {
    for (const html of [
      '<h1>Pendaftaran Berhasil</h1><p>Simpan nomor Anda.</p>',
      '<div class="alert alert-success">Nomor registrasi Anda: 3374-2026-0001</div>',
      '<div class="swal2-popup"><h2 class="swal2-title">Sukses!</h2><div>Permohonan berhasil dikirim.</div></div>',
      '<div role="status">No. Antrean: A-0123</div>',
    ]) {
      document.body.innerHTML = html;
      expect(amati().pengamatan.sinyal.sukses, html).toBe(true);
    }
  });

  it('sukses: probe portal nyata (beranda/FAQ/tahapan/petunjuk) bukan positif palsu', () => {
    for (const html of [
      // 6402 Kukar: petunjuk di beranda login, token tanpa digit.
      '<h3>LOGIN</h3><div class="alert alert-info">Cek nomor registrasi disini</div>',
      '<div class="alert alert-info">Masukkan nomor resi anda untuk melacak</div>',
      // 3276 Depok: tahapan layanan.
      '<h3>Tahapan Layanan</h3><h6>Setelah pendaftaran berhasil diverifikasi dan dinyatakan lengkap anda akan mendapat jadwal</h6>',
      '<ol><li><h6>Pendaftaran berhasil diverifikasi</h6></li></ol>',
      // Badan halaman / FAQ / menu: tidak pernah dibaca.
      '<p>Pendaftaran berhasil dikirim bila semua berkas lengkap.</p><p>Nomor registrasi: REG-2026-0001</p>',
      '<div class="accordion"><h5>Bagaimana jika permohonan berhasil diajukan?</h5></div>',
      '<nav><a href="/bukti">Cetak Bukti Pendaftaran</a></nav><h2>Bukti Pendaftaran tidak ditemukan</h2>',
      '<footer><h4>Permohonan Anda telah berhasil</h4></footer>',
      '<h2>Lacak Bukti Pendaftaran</h2>',
      // Review N3 (PoC F): dasbor, label kolom, draf wizard.
      '<nav><a href="/bukti">Cetak Bukti Pendaftaran</a> <a href="/layanan">Layanan</a></nav><h1>Selamat datang</h1>',
      '<h1>Bukti Pendaftaran</h1>',
      '<form><label>Nomor Antrian Online <input name="antri"></label><label>Nama <input name="nama"></label></form>',
      '<div class="alert alert-success">Data berhasil disimpan. Silakan lanjut ke tahap 2 dari 4.</div><label>Nama Ayah <input name="ayah"></label>',
      '<div class="alert alert-success">Data berhasil disimpan</div>',
    ]) {
      document.body.innerHTML = html;
      expect(amati().pengamatan.sinyal.sukses, html).toBe(false);
    }
  });

  it('batas keras: 150 elemen (kendali formulir didahulukan), opsi ≤40, panjang teks', () => {
    const menu = Array.from({ length: 200 }, (_, i) => `<a href="/m/${i}">Menu ${i}</a>`).join('');
    const opsi = Array.from({ length: 60 }, (_, i) => `<option>${'Opsi '.repeat(30)}${i}</option>`).join('');
    const judul = Array.from({ length: 80 }, (_, i) => `<h2>${'Judul panjang '.repeat(5)}${i}</h2>`).join('');
    document.body.innerHTML = `${menu}${judul}<form><select aria-label="${'Nama '.repeat(60)}">${opsi}</select>
      <label>Nama <input name="n"></label></form>`;
    const { pengamatan: p } = amati();
    expect(p.elemen).toHaveLength(BATAS_AMATAN.elemen);
    expect(p.elemen.filter((e) => e.peran !== 'tautan')).toHaveLength(2);
    const sel = p.elemen.find((e) => e.peran === 'pilihan')!;
    expect(sel.opsi).toHaveLength(40);
    expect(sel.opsi!.every((o) => o.length <= 80)).toBe(true);
    expect(sel.nama.length).toBeLessThanOrEqual(120);
    expect(p.teks.length).toBeLessThanOrEqual(2500);
  });

  it('peta ref: jalur nth-of-type menunjuk elemen yang sama; tidak ada yang ditulis ke DOM', () => {
    document.body.innerHTML = FORM;
    const sebelum = document.documentElement.outerHTML;
    const { pengamatan: p, peta } = amati();
    expect(document.documentElement.outerHTML).toBe(sebelum);
    for (const e of p.elemen) {
      const el = elemenDariJalur(document, peta[e.ref]!.jalur);
      expect(el).not.toBeNull();
      expect(sidikElemen(el!)).toBe(peta[e.ref]!.sidik);
    }
    expect(peta.e1!.jalur).toMatch(/^html > body:nth-of-type\(1\) > /);
  });

  it('ikatUlang: ref lama dipetakan ke ref baru lewat sidik; ambigu/hilang = null', () => {
    document.body.innerHTML = '<label>Nama <input name="n"></label><button type="button">Lanjut</button>';
    const lama = amati().peta;
    document.body.innerHTML =
      '<p>Info baru</p><label>Alamat <input name="a"></label><label>Nama <input name="n"></label><button type="button">Lanjut</button>';
    const baru = amati().peta;
    expect(ikatUlang(lama, baru, 'e1')).toBe('e2');
    expect(ikatUlang(lama, baru, 'e2')).toBe('e3');
    expect(ikatUlang(lama, baru, 'e9')).toBeNull();
    document.body.innerHTML = '<button type="button">Lanjut</button><button type="button">Lanjut</button>';
    expect(ikatUlang(lama, amati().peta, 'e2')).toBeNull();
  });

  it('sidik halaman berubah saat isian berubah (deteksi kemajuan), tetap bila tidak ada yang berubah', () => {
    document.body.innerHTML = '<label>Nama <input name="n"></label>';
    const a = amati().pengamatan.sidik;
    expect(amati().pengamatan.sidik).toBe(a);
    setNativeValue(document.querySelector('input')!, 'sesuatu');
    expect(amati().pengamatan.sidik).not.toBe(a);
  });
});

/** PRNG deterministik (mulberry32) supaya kegagalan bisa diulang dari seed. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('properti: pengamatan tidak pernah memuat nilai isian', () => {
  // Nilai acak sintetis (bukan PII nyata). Selalu memuat huruf g-z atau 16 digit, sehingga tidak mungkin
  // kebetulan muncul di dalam hash heksadesimal 14 digit.
  const HURUF = 'ghjkmnpqrstuvwxyz';
  const CAMPUR = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .-@/';
  function nilaiAcak(r: () => number): string {
    const jenis = Math.floor(r() * 3);
    if (jenis === 0) return Array.from({ length: 16 }, () => Math.floor(r() * 10)).join('');
    const pj = 4 + Math.floor(r() * 20);
    const isi = Array.from({ length: pj }, () => CAMPUR[Math.floor(r() * CAMPUR.length)]).join('');
    return HURUF[Math.floor(r() * HURUF.length)]! + isi.trim() + HURUF[Math.floor(r() * HURUF.length)]!;
  }

  const TIPE = ['text', 'email', 'tel', 'search', 'url', 'password', 'number'];

  it('300 halaman acak: tidak satu pun nilai (diketik, bawaan situs, atau digemakan situs) terserialisasi', () => {
    let diperiksa = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const r = prng(seed);
      const n = 3 + Math.floor(r() * 12);
      const nilai: string[] = [];
      const bagian: string[] = ['<h1>Formulir uji</h1><form>'];
      for (let i = 0; i < n; i++) {
        const tipe = TIPE[Math.floor(r() * TIPE.length)]!;
        const bawaan = r() < 0.3 ? nilaiAcak(r).replace(/"/g, '') : '';
        if (bawaan && tipe !== 'number') nilai.push(bawaan);
        const attrBawaan = bawaan && tipe !== 'number' ? ` value="${bawaan}"` : '';
        if (r() < 0.2)
          bagian.push(
            `<label>Catatan ${i} <textarea name="t${i}">${attrBawaan ? bawaan : ''}</textarea></label>`,
          );
        else bagian.push(`<label>Kolom ${i} <input type="${tipe}" name="k${i}"${attrBawaan}></label>`);
      }
      bagian.push('<button type="button">Lanjut</button></form><div role="alert" id="gema"></div>');
      document.body.innerHTML = bagian.join('');
      // Isi sebagian field lewat setter native (seperti AI/warga), termasuk angka untuk type=number.
      for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
        if (r() < 0.7) {
          const v = el.type === 'number' ? String(1000000 + Math.floor(r() * 9e15)) : nilaiAcak(r);
          setNativeValue(el, v);
          if (el.value === v) nilai.push(v);
        }
      }
      // Situs menggemakan nilai di pesan galat/judul (pola umum "NIK 1234... tidak ditemukan").
      const gema = nilai[Math.floor(r() * nilai.length)];
      if (gema) {
        document.getElementById('gema')!.textContent = `Data ${gema} tidak ditemukan`;
        document.title = `Hasil ${gema}`;
      }
      const hasil = bangunPengamatan(document, { seq: seed });
      PengamatanSchema.parse(hasil.pengamatan); // juga sah menurut kontrak WP-D
      const serial = JSON.stringify(hasil);
      for (const v of nilai) {
        diperiksa++;
        expect(serial.includes(v), `seed ${seed}: nilai bocor`).toBe(false);
        expect(serial.toLowerCase().includes(v.toLowerCase()), `seed ${seed}: nilai bocor (huruf)`).toBe(
          false,
        );
      }
      document.title = '';
    }
    expect(diperiksa).toBeGreaterThan(1000);
  }, 60_000); // 300 halaman DOM nyata + parse zod; jauh di atas 5 s bawaan saat turbo paralel
});
