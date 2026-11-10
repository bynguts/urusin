import { afterEach, describe, expect, it, vi } from 'vitest';
import { bangunPengamatan, type PetaRef } from './amatan.js';
import { jalankanAksi, runOp, type AksiRunner, type HasilAksiOp } from './runner-ops.js';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const pasang = (html: string) => {
  document.body.innerHTML = html;
  return bangunPengamatan(document, { seq: 1 });
};
const refDari = (h: ReturnType<typeof pasang>, nama: string) => {
  const e = h.pengamatan.elemen.find((x) => x.nama === nama);
  if (!e) throw new Error(`elemen "${nama}" tidak teramati`);
  return e.ref;
};
const aksi = (peta: PetaRef, ...a: AksiRunner[]) => jalankanAksi(document, a, peta).hasil;

describe('op aksi: klik', () => {
  it('menolak submitter (kirim) tanpa menjalankan handler apa pun', () => {
    const h = pasang(
      '<form><label>Nama <input name="n"></label><button type="submit">Lanjut</button></form>',
    );
    const ditekan = vi.fn();
    const kirim = vi.fn((e: Event) => e.preventDefault());
    document.querySelector('button')!.addEventListener('click', ditekan);
    document.querySelector('form')!.addEventListener('submit', kirim);
    const [r] = aksi(h.peta, { jenis: 'klik', ref: refDari(h, 'Lanjut') });
    expect(r).toMatchObject({
      status: 'ditolak',
      kode: 'KLIK_DITOLAK',
      aturan: 'K4_SUBMITTER',
      kelas: 'kirim',
    });
    expect(r!.fitur).toMatchObject({ tag: 'button', submitterAsli: true });
    expect(ditekan).not.toHaveBeenCalled();
    expect(kirim).not.toHaveBeenCalled();
  });

  it('klasifikasi diulang saat klik: tombol yang berubah jadi submit setelah amati tetap ditolak', () => {
    const h = pasang('<form><button type="button">Lanjut</button></form>');
    expect(h.pengamatan.elemen[0]!.kelas).toBe('lanjut');
    // Situs mengganti type tanpa mengubah nama: sidik sama, tetapi kelas saat klik = kirim.
    document.querySelector('button')!.setAttribute('type', 'submit');
    const ditekan = vi.fn();
    document.querySelector('button')!.addEventListener('click', ditekan);
    expect(aksi(h.peta, { jenis: 'klik', ref: 'e1' })[0]).toMatchObject({
      status: 'ditolak',
      kelas: 'kirim',
    });
    expect(ditekan).not.toHaveBeenCalled();
  });

  it('REF_BASI bila sidik berubah; REF_TIDAK_DIKENAL bila ref tidak ada di peta', () => {
    const h = pasang('<button type="button">Lanjut</button>');
    document.querySelector('button')!.textContent = 'Kirim Permohonan';
    expect(aksi(h.peta, { jenis: 'klik', ref: 'e1' })[0]).toMatchObject({
      status: 'gagal',
      kode: 'REF_BASI',
      aturan: 'A_REF_BASI',
    });
    document.body.innerHTML = '';
    expect(aksi(h.peta, { jenis: 'klik', ref: 'e1' })[0]).toMatchObject({ kode: 'REF_BASI' });
    expect(aksi(h.peta, { jenis: 'klik', ref: 'e99' })[0]).toMatchObject({ kode: 'REF_TIDAK_DIKENAL' });
  });

  it('lanjut: diklik (handler jalan), lalu aksi berikutnya dilewati untuk amati ulang', () => {
    const h = pasang('<label>Nama <input name="n"></label><button type="button">Lanjut ›</button>');
    const ditekan = vi.fn();
    document.querySelector('button')!.addEventListener('click', ditekan);
    const hasil = aksi(
      h.peta,
      { jenis: 'klik', ref: refDari(h, 'Lanjut ›') },
      { jenis: 'isi', ref: refDari(h, 'Nama'), placeholder: '{{PEMOHON.NAMA}}', nilai: 'Budi Contoh' },
    );
    expect(hasil.map((r) => [r.status, r.aturan])).toEqual([
      ['ok', 'K10_LANJUT'],
      ['dilewati', 'A_DILEWATI'],
    ]);
    expect(ditekan).toHaveBeenCalledOnce();
    expect(document.querySelector('input')!.value).toBe('');
  });

  it('navigasi: TIDAK diklik, dikembalikan sebagai href absolut untuk Page.navigate worker', () => {
    const h = pasang('<a href="/layanan/kk?x=1" target="_blank">Daftar Layanan</a>');
    const ditekan = vi.fn((e: Event) => e.preventDefault());
    document.querySelector('a')!.addEventListener('click', ditekan);
    const [r] = aksi(h.peta, { jenis: 'klik', ref: 'e1' });
    expect(r).toMatchObject({
      status: 'navigasi',
      kelas: 'navigasi',
      aturan: 'K8_NAVIGASI',
      href: 'http://localhost:3000/layanan/kk?x=1',
    });
    expect(ditekan).not.toHaveBeenCalled();
  });

  it('ui_lokal diklik dan aksi berikutnya tetap berjalan', () => {
    const h = pasang('<div role="tab">Alamat</div><label>Kota <input name="kota"></label>');
    const hasil = aksi(
      h.peta,
      { jenis: 'klik', ref: refDari(h, 'Alamat') },
      { jenis: 'isi', ref: refDari(h, 'Kota'), placeholder: '{{ALAMAT.KOTA}}', nilai: 'Kota Contoh' },
    );
    expect(hasil.map((r) => r.status)).toEqual(['ok', 'ok']);
  });

  it('kunci halaman akhir: tidak ada klik sama sekali, bahkan tab', () => {
    const h = pasang('<div role="tab">Ringkasan</div><button type="button">Lanjut</button>');
    document.body.insertAdjacentHTML('afterbegin', '<p>Dengan ini saya menyatakan data di atas benar.</p>');
    for (const ref of ['e1', 'e2']) {
      expect(aksi(h.peta, { jenis: 'klik', ref })[0]).toMatchObject({
        status: 'ditolak',
        kode: 'HALAMAN_AKHIR',
        aturan: 'A_HALAMAN_AKHIR',
      });
    }
  });
});

describe('op aksi: tulis', () => {
  it('isi: nilai masuk ke field, hasil tidak memuat nilai, placeholder dibawa untuk jejak', () => {
    const h = pasang('<label>NIK <input name="nik"></label>');
    const nilai = '9999000011112222';
    const hasil = aksi(h.peta, { jenis: 'isi', ref: 'e1', placeholder: '{{PEMOHON.NIK}}', nilai });
    expect(document.querySelector('input')!.value).toBe(nilai);
    expect(hasil).toEqual([
      { i: 0, jenis: 'isi', ref: 'e1', status: 'ok', aturan: 'A_OK', placeholder: '{{PEMOHON.NIK}}' },
    ]);
    expect(JSON.stringify(hasil)).not.toContain(nilai);
  });

  it('isi ke field terlarang (sandi, OTP, CAPTCHA) ditolak; centang pernyataan ditolak', () => {
    const h = pasang(`<label>Kata Sandi <input type="password" name="p"></label>
      <label>Kode OTP <input name="otp"></label>
      <div><img src="/captcha.png" alt="captcha"><input name="c" placeholder="Kode"></div>
      <label><input type="checkbox" name="s"> Saya menyatakan data ini benar</label>`);
    const isi = (ref: string): AksiRunner => ({
      jenis: 'isi',
      ref,
      placeholder: '{{PEMOHON.NIK}}',
      nilai: 'x',
    });
    for (const ref of ['e1', 'e2', 'e3']) {
      expect(aksi(h.peta, isi(ref))[0]).toMatchObject({
        status: 'ditolak',
        kode: 'TERLARANG',
        aturan: 'A_TERLARANG',
      });
    }
    expect(aksi(h.peta, { jenis: 'centang', ref: 'e4', nilai: true })[0]).toMatchObject({
      kode: 'TERLARANG',
    });
    expect(
      [...document.querySelectorAll('input')].every((i) => i.value === '' || i.type === 'checkbox'),
    ).toBe(true);
    expect((document.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(false);
  });

  it('isi ke field nonaktif / bukan field teks gagal; aksi gagal menghentikan sisanya', () => {
    const h = pasang(
      '<label>A <input name="a" disabled></label><label>B <input name="b"></label><button type="button">Lanjut</button>',
    );
    const hasil = aksi(
      h.peta,
      { jenis: 'isi', ref: 'e1', placeholder: '{{A.B}}', nilai: 'x' },
      { jenis: 'isi', ref: 'e2', placeholder: '{{A.B}}', nilai: 'y' },
    );
    expect(hasil.map((r) => r.kode ?? r.status)).toEqual(['ELEMEN_NONAKTIF', 'dilewati']);
    expect(aksi(h.peta, { jenis: 'isi', ref: 'e3', placeholder: '{{A.B}}', nilai: 'x' })[0]).toMatchObject({
      kode: 'ELEMEN_TIDAK_SESUAI',
    });
  });

  it('pilih: indeks opsi teramati, nilai placeholder (cocok teks), indeks di luar jangkauan', () => {
    const h = pasang(
      '<select aria-label="Agama"><option value="">-- Pilih --</option><option value="1">Islam</option><option value="2">Kristen</option></select>',
    );
    const sel = document.querySelector('select')!;
    expect(aksi(h.peta, { jenis: 'pilih', ref: 'e1', opsi: 2 })[0]!.status).toBe('ok');
    expect(sel.value).toBe('2');
    expect(
      aksi(h.peta, { jenis: 'pilih', ref: 'e1', placeholder: '{{PEMOHON.AGAMA}}', nilai: 'ISLAM' })[0]!
        .status,
    ).toBe('ok');
    expect(sel.value).toBe('1');
    expect(aksi(h.peta, { jenis: 'pilih', ref: 'e1', opsi: 9 })[0]).toMatchObject({ kode: 'OPSI_TIDAK_ADA' });
  });

  it('pilih pada select yang onchange memanggil form.submit(): pilih diizinkan (gerbang tulis worker yang memblokir POST)', () => {
    const h = pasang(
      '<form><select aria-label="Kota" name="k"><option value="">-</option><option value="a">A</option></select></form>',
    );
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    document
      .querySelector('select')!
      .addEventListener('change', () => document.querySelector('form')!.submit());
    expect(aksi(h.peta, { jenis: 'pilih', ref: 'e1', opsi: 1 })[0]!.status).toBe('ok');
    expect(submit).toHaveBeenCalled();
  });

  it('pilih radio dan centang biasa', () => {
    const h = pasang(`<fieldset><legend>Jenis Kelamin</legend>
      <label><input type="radio" name="jk" value="L"> Laki-laki</label><label><input type="radio" name="jk" value="P"> Perempuan</label></fieldset>
      <label><input type="checkbox" name="kabar"> Kirimi saya kabar</label>`);
    expect(aksi(h.peta, { jenis: 'pilih', ref: 'e1', opsi: 1 })[0]!.status).toBe('ok');
    expect((document.querySelector('input[value=P]') as HTMLInputElement).checked).toBe(true);
    expect(aksi(h.peta, { jenis: 'centang', ref: 'e2', nilai: true })[0]!.status).toBe('ok');
    expect((document.querySelector('input[name=kabar]') as HTMLInputElement).checked).toBe(true);
  });

  it('unggah ke field berkas', () => {
    const h = pasang('<label>KTP <input type="file" name="ktp"></label>');
    const r = aksi(h.peta, {
      jenis: 'unggah',
      ref: 'e1',
      berkas: { name: 'ktp.png', mime: 'image/png', base64: btoa('png') },
    });
    expect(r[0]!.status).toBe('ok');
    expect((document.querySelector('input') as HTMLInputElement).files?.[0]?.name).toBe('ktp.png');
  });
});

describe('runOp: amati dan aksi', () => {
  it('amati mengembalikan pengamatan + peta; aksi mengembalikan hasil per aksi', async () => {
    document.body.innerHTML = '<label>Nama <input name="n"></label><button type="submit">Kirim</button>';
    const r = await runOp({ kind: 'amati', seq: 3 });
    expect(r.ok).toBe(true);
    const { pengamatan, peta } = (r as { value: ReturnType<typeof bangunPengamatan> }).value;
    expect(pengamatan.seq).toBe(3);
    const a = await runOp({
      kind: 'aksi',
      peta,
      aksi: [
        { jenis: 'isi', ref: 'e1', placeholder: '{{PEMOHON.NAMA}}', nilai: 'Nama Contoh' },
        { jenis: 'klik', ref: 'e2' },
      ],
    });
    expect((a as { value: HasilAksiOp }).value.hasil.map((x) => x.status)).toEqual(['ok', 'ditolak']);
    const lagi = await runOp({ kind: 'amati', seq: 4, diisi: { [peta.e1!.sidik]: '{{PEMOHON.NAMA}}' } });
    expect((lagi as { value: ReturnType<typeof bangunPengamatan> }).value.pengamatan.elemen[0]!.isian).toBe(
      '{{PEMOHON.NAMA}}',
    );
  });
});
