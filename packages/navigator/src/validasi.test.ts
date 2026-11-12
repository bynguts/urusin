import { readFileSync } from 'node:fs';
import { AksiSchema, RencanaHalamanSchema, type Pengamatan } from '@urusin/contracts';
import { findStrictViolations, toStrictJsonSchema } from '@urusin/llm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  halamanDaftarAkun,
  kolomKredensial,
  petunjukWarga,
  pintuAkun,
  ATURAN,
  KATALOG_PLACEHOLDER,
  RencanaKetatSchema,
  hashRencana,
  kelaziman,
  pembukaPengajuan,
  validasiRencana,
  type IdAturan,
} from './validasi.js';

const fixture = <T>(nama: string): T =>
  (
    JSON.parse(
      readFileSync(new URL(`../../contracts/fixtures/navigator/${nama}.json`, import.meta.url), 'utf8'),
    ) as { data: T }
  ).data;

/** Halaman formulir replika (fixture kontrak) + kolom catatan, identitas samar, tab, dan isian warga. */
export function halamanForm(): Pengamatan {
  const p = fixture<Pengamatan>('pengamatan-formulir');
  return {
    ...p,
    elemen: [
      ...p.elemen,
      { ref: 'e8', peran: 'area', nama: 'Catatan untuk petugas' },
      { ref: 'e9', peran: 'teks', nama: 'Nomor Identitas Pemohon' },
      { ref: 'e10', peran: 'tab', nama: 'Data Anak', kelas: 'ui_lokal' },
      { ref: 'e11', peran: 'tombol', nama: 'Lanjut', kelas: 'lanjut', form: 'f0' },
      { ref: 'e12', peran: 'teks', nama: 'Nomor HP', isian: 'terisi_warga' },
      { ref: 'e13', peran: 'teks', nama: 'Kata sandi', terlarang: 'sandi' },
    ],
  };
}

const tolak = (mentah: unknown, p: Pengamatan = halamanForm()): IdAturan[] => {
  const v = validasiRencana(mentah, p);
  return v.ok ? [] : v.aturan;
};
const rencana = (...aksi: unknown[]) => ({ aksi });

describe('validator rencana: suite penolakan (setiap penolakan punya id aturan)', () => {
  const kasus: [string, unknown, IdAturan][] = [
    ['bukan objek', 'klik e6', 'SKEMA_TIDAK_SAH'],
    ['aksi kosong', rencana(), 'SKEMA_TIDAK_SAH'],
    ['jenis tak dikenal (kirim)', rencana({ jenis: 'kirim', ref: 'e6' }), 'SKEMA_TIDAK_SAH'],
    ['URL di aksi', rencana({ jenis: 'klik', ref: 'e7', url: 'https://evil.example' }), 'SKEMA_TIDAK_SAH'],
    [
      'teks bebas sebagai nilai',
      rencana({ jenis: 'isi', ref: 'e2', nilai: 'Budi Santoso' }),
      'SKEMA_TIDAK_SAH',
    ],
    [
      'NIK mentah sebagai nilai',
      rencana({ jenis: 'isi', ref: 'e1', nilai: ['3312', '0115', '0890', '0001'].join('') }),
      'SKEMA_TIDAK_SAH',
    ],
    ['tombol keyboard', rencana({ jenis: 'tekan', tombol: 'Enter' }), 'SKEMA_TIDAK_SAH'],
    ['JS', rencana({ jenis: 'klik', ref: 'e7', js: 'form.submit()' }), 'SKEMA_TIDAK_SAH'],
    ['ref bukan pola', rencana({ jenis: 'klik', ref: '#kirim' }), 'SKEMA_TIDAK_SAH'],
    ['ref karangan', rencana({ jenis: 'isi', ref: 'e99', nilai: '{{PEMOHON.NAMA}}' }), 'REF_TIDAK_DIAMATI'],
    [
      'ref serahkan karangan',
      rencana({ jenis: 'serahkan', alasan: 'final', ref: 'e77' }),
      'REF_TIDAK_DIAMATI',
    ],
    [
      'placeholder di luar katalog',
      rencana({ jenis: 'isi', ref: 'e2', nilai: '{{PEMOHON.SANDI}}' }),
      'PLACEHOLDER_TIDAK_DIKENAL',
    ],
    [
      'placeholder orang di luar brankas',
      rencana({ jenis: 'isi', ref: 'e2', nilai: '{{ORANG2.NAMA}}' }),
      'PLACEHOLDER_TIDAK_DIKENAL',
    ],
    [
      'indeks opsi di luar rentang',
      rencana({ jenis: 'pilih', ref: 'e3', nilai: { opsi: 3 } }),
      'OPSI_DI_LUAR_RENTANG',
    ],
    [
      'pilih indeks pada elemen tanpa opsi',
      rencana({ jenis: 'pilih', ref: 'e9', nilai: { opsi: 0 } }),
      'PERAN_TIDAK_COCOK',
    ],
    [
      'isi ke kolom terlarang (sandi)',
      rencana({ jenis: 'isi', ref: 'e13', nilai: '{{PEMOHON.NAMA}}' }),
      'KOLOM_TERLARANG',
    ],
    ['centang pernyataan', rencana({ jenis: 'centang', ref: 'e5', nilai: true }), 'KOLOM_TERLARANG'],
    [
      'timpa isian warga',
      rencana({ jenis: 'isi', ref: 'e12', nilai: '{{PEMOHON.HP}}' }),
      'KOLOM_DIISI_WARGA',
    ],
    [
      'NIK ke kolom catatan',
      rencana({ jenis: 'isi', ref: 'e8', nilai: '{{PEMOHON.NIK}}' }),
      'NIK_KOLOM_TIDAK_LAZIM',
    ],
    [
      'NIK ke kolom nama',
      rencana({ jenis: 'isi', ref: 'e2', nilai: '{{PEMOHON.NIK}}' }),
      'NIK_KOLOM_TIDAK_LAZIM',
    ],
    [
      'KK ke kolom catatan',
      rencana({ jenis: 'isi', ref: 'e8', nilai: '{{PEMOHON.KK}}' }),
      'NIK_KOLOM_TIDAK_LAZIM',
    ],
    ['klik tombol kirim', rencana({ jenis: 'klik', ref: 'e6' }), 'KELAS_KLIK_DITOLAK'],
    ['klik elemen tanpa kelas', rencana({ jenis: 'klik', ref: 'e1' }), 'KELAS_KLIK_DITOLAK'],
    ['isi ke tombol', rencana({ jenis: 'isi', ref: 'e11', nilai: '{{PEMOHON.NAMA}}' }), 'PERAN_TIDAK_COCOK'],
    ['unggah ke kolom teks', rencana({ jenis: 'unggah', ref: 'e2', berkas: 'KTP' }), 'PERAN_TIDAK_COCOK'],
    ['berkas tak dikenal', rencana({ jenis: 'unggah', ref: 'e4', berkas: 'PASPOR' }), 'BERKAS_TIDAK_DIKENAL'],
    [
      'kolom ditulis dua kali',
      rencana(
        { jenis: 'isi', ref: 'e2', nilai: '{{PEMOHON.NAMA}}' },
        { jenis: 'isi', ref: 'e2', nilai: '{{PEMOHON.NAMA}}' },
      ),
      'REF_GANDA',
    ],
    [
      'klik bukan aksi terakhir',
      rencana({ jenis: 'klik', ref: 'e11' }, { jenis: 'isi', ref: 'e2', nilai: '{{PEMOHON.NAMA}}' }),
      'KLIK_BUKAN_AKHIR',
    ],
    [
      'dua aksi terminal',
      rencana({ jenis: 'serahkan', alasan: 'final' }, { jenis: 'tidak_bisa', sebab: 'lainnya' }),
      'TERMINAL_GANDA',
    ],
    [
      'terminal bukan terakhir',
      rencana({ jenis: 'serahkan', alasan: 'final' }, { jenis: 'isi', ref: 'e2', nilai: '{{PEMOHON.NAMA}}' }),
      'TERMINAL_BUKAN_AKHIR',
    ],
  ];

  it.each(kasus)('%s → %s', (_n, mentah, aturan) => {
    expect(tolak(mentah)).toContain(aturan);
  });

  it('halaman akhir terkunci: klik apa pun (bahkan navigasi) ditolak', () => {
    const p = { ...halamanForm(), sinyal: { ...halamanForm().sinyal, halamanAkhir: true } };
    expect(tolak(rencana({ jenis: 'klik', ref: 'e7' }), p)).toContain('HALAMAN_AKHIR_TERKUNCI');
    expect(tolak(rencana({ jenis: 'serahkan', alasan: 'final' }), p)).toEqual([]);
  });

  it('setiap id aturan punya kasus uji di suite ini', () => {
    const teruji = new Set([...kasus.map((k) => k[2]), 'HALAMAN_AKHIR_TERKUNCI']);
    expect(ATURAN.filter((a) => !teruji.has(a))).toEqual([]);
  });

  it('id aturan sesuai pola audit jejak_pendamping', () => {
    for (const a of ATURAN) expect(a).toMatch(/^[A-Z][A-Z0-9_]{1,63}$/);
  });
});

describe('validator rencana: rencana sah', () => {
  it('fixture kontrak lolos; kolom persetujuan per baris tanpa nilai', () => {
    const v = validasiRencana(fixture('rencana-isi'), halamanForm());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.kolom).toEqual([{ placeholder: '{{PEMOHON.NIK}}', labelPortal: 'Nomor Induk Kependudukan' }]);
    expect(v.berkas).toEqual(['KTP']);
    expect(v.rencanaHash).toMatch(/^[0-9a-f]{64}$/);
    const h = halamanForm();
    expect(v.rencanaHash).toBe(hashRencana({ ...v.rencana, host: h.host, sidik: h.sidik, seq: h.seq }));
  });

  it('rencana identik di halaman lain (seq/sidik beda) tidak berbagi rencanaHash', () => {
    const a = validasiRencana(fixture('rencana-isi'), halamanForm());
    const b = validasiRencana(fixture('rencana-isi'), { ...halamanForm(), seq: 9 });
    expect(a.ok && b.ok).toBe(true);
    expect(a.rencanaHash).not.toBe(b.rencanaHash);
  });

  it('NIK ke kolom identitas yang samar: lolos tetapi baris ditandai tidakLazim', () => {
    const v = validasiRencana(
      rencana({ jenis: 'isi', ref: 'e9', nilai: '{{PEMOHON.NIK}}' }, { jenis: 'klik', ref: 'e11' }),
      halamanForm(),
    );
    expect(v.ok && v.kolom).toEqual([
      { placeholder: '{{PEMOHON.NIK}}', labelPortal: 'Nomor Identitas Pemohon', tidakLazim: true },
    ]);
  });

  it('F8: data non-sensitif ke kolom yang labelnya tidak cocok = samar (baris ditandai tidakLazim)', () => {
    expect(kelaziman('{{PEMOHON.HP}}', { peran: 'teks', nama: 'Nomor HP' })).toBe('lazim');
    expect(kelaziman('{{PEMOHON.HP}}', { peran: 'teks', nama: 'Nomor Rekening' })).toBe('samar');
    expect(kelaziman('{{PEMOHON.NAMA}}', { peran: 'teks', nama: 'Kata kunci pencarian' })).toBe('samar');
  });

  it('Nomor HP: placeholder 0819xxxx, label HP/telepon/WhatsApp, type/autocomplete tel = lazim (QA Bandar Lampung)', () => {
    const hp = '{{PEMOHON.HP}}';
    for (const e of [
      { peran: 'teks' as const, nama: 'No. HP', petunjuk: '0819xxxxxxxx' },
      { peran: 'teks' as const, nama: 'Nomor Telepon' },
      { peran: 'teks' as const, nama: 'WhatsApp' },
      { peran: 'teks' as const, nama: 'No. Seluler' },
      // Label samar, tetapi placeholder berformat nomor seluler.
      { peran: 'teks' as const, nama: 'Kontak', petunjuk: '0819xxxxxxxx' },
      { peran: 'teks' as const, nama: '0819xxxxxxxx' },
      { peran: 'angka' as const, nama: 'Nomor', petunjuk: '+62 812-3456-7890' }, // pii-scan:allow contoh format sintetis
      // Label samar, tetapi atribut terstruktur kolom (type=tel / autocomplete=tel / name=no_hp).
      { peran: 'teks' as const, nama: 'Kontak', isyarat: 'tel' as const },
    ])
      expect(kelaziman(hp, e), JSON.stringify(e)).toBe('lazim');
    const v = validasiRencana(rencana({ jenis: 'isi', ref: 'e20', nilai: hp }), {
      ...halamanForm(),
      elemen: [
        ...halamanForm().elemen,
        { ref: 'e20', peran: 'teks', nama: 'Nomor Kontak', petunjuk: '0819xxxxxxxx' },
      ],
    });
    expect(v.ok && v.kolom).toEqual([{ placeholder: hp, labelPortal: 'Nomor Kontak' }]);
  });

  it('peringatan tetap muncul bila memang meragukan', () => {
    const hp = '{{PEMOHON.HP}}';
    // Nomor HP ke kolom "Nama Ibu" (name=nama_ibu): samar, baris ditandai tidakLazim.
    expect(kelaziman(hp, { peran: 'teks', nama: 'Nama Ibu', isyarat: 'nama' })).toBe('samar');
    expect(kelaziman(hp, { peran: 'teks', nama: 'Nama Ibu' })).toBe('samar');
    // Isyarat jenis lain tidak membuat HP lazim; angka acak bukan contoh nomor seluler.
    expect(kelaziman(hp, { peran: 'teks', nama: 'Kontak', isyarat: 'email' })).toBe('samar');
    expect(kelaziman(hp, { peran: 'teks', nama: 'Nomor Rekening', petunjuk: '1234567890' })).toBe('samar');
    // Email: contoh format / isyarat.
    expect(
      kelaziman('{{PEMOHON.EMAIL}}', { peran: 'teks', nama: 'Kontak', petunjuk: 'nama@contoh.com' }), // pii-scan:allow contoh sintetis
    ).toBe('lazim');
    // Data sensitif tidak pernah lazim lewat isyarat atau contoh format.
    expect(kelaziman('{{PEMOHON.NIK}}', { peran: 'teks', nama: 'Kontak', isyarat: 'tel' })).toBe('asing');
    const v = validasiRencana(rencana({ jenis: 'isi', ref: 'e20', nilai: hp }), {
      ...halamanForm(),
      elemen: [...halamanForm().elemen, { ref: 'e20', peran: 'teks', nama: 'Nama Ibu', isyarat: 'nama' }],
    });
    expect(v.ok && v.kolom).toEqual([{ placeholder: hp, labelPortal: 'Nama Ibu', tidakLazim: true }]);
  });

  it('homoglif pada label NIK tidak pernah dianggap lazim (default tolak)', () => {
    const e = { peran: 'teks' as const, nama: 'NІK' /* І Kiril */ };
    expect(kelaziman('{{PEMOHON.NIK}}', e)).toBe('asing');
    expect(kelaziman('{{PEMOHON.NIK}}', { peran: 'teks', nama: 'N​IK pemohon' })).toBe('lazim');
  });

  it('klik tab ui_lokal, tautan navigasi, dan lanjut diizinkan sebagai aksi terakhir', () => {
    for (const ref of ['e10', 'e7', 'e11'])
      expect(validasiRencana(rencana({ jenis: 'klik', ref }), halamanForm()).ok).toBe(true);
  });

  it('hash rencana kanonik: urutan kunci tidak berpengaruh', () => {
    expect(hashRencana({ aksi: [{ ref: 'e1', jenis: 'klik' }] })).toBe(
      hashRencana({ aksi: [{ jenis: 'klik', ref: 'e1' }] }),
    );
  });
});

describe('tautan pembuka (kirim karena nama saja): AI membukanya lewat navigasi GET worker', () => {
  const beranda = (over: Partial<Pengamatan> = {}): Pengamatan => ({
    ...halamanForm(),
    elemen: [
      { ref: 'e1', peran: 'tautan', nama: 'Mulai Pendaftaran', kelas: 'kirim', tautanPembuka: true },
      { ref: 'e2', peran: 'tombol', nama: 'Ajukan', kelas: 'kirim', tautanPembuka: true },
      { ref: 'e3', peran: 'tautan', nama: 'Kirim Data', kelas: 'kirim' },
    ],
    ...over,
  });

  it('QA gel6: klik ke tautan pembuka diterima apa adanya (bukan giliran warga "Buka"); hash = rencana itu', () => {
    const p = beranda();
    const v = validasiRencana(rencana({ jenis: 'klik', ref: 'e1' }), p);
    expect(v).toMatchObject({ ok: true, rencana: { aksi: [{ jenis: 'klik', ref: 'e1' }] } });
    expect(v.rencanaHash).toBe(
      hashRencana({ aksi: [{ jenis: 'klik', ref: 'e1' }], host: p.host, sidik: p.sidik, seq: p.seq }),
    );
  });

  it('tanpa penanda, bukan tautan, atau di halaman akhir: tetap ditolak sebagai klik kirim', () => {
    expect(tolak(rencana({ jenis: 'klik', ref: 'e3' }), beranda())).toContain('KELAS_KLIK_DITOLAK');
    expect(tolak(rencana({ jenis: 'klik', ref: 'e2' }), beranda())).toContain('KELAS_KLIK_DITOLAK');
    const akhir = beranda({ sinyal: { ...halamanForm().sinyal, halamanAkhir: true } });
    expect(tolak(rencana({ jenis: 'klik', ref: 'e1' }), akhir)).toEqual(
      expect.arrayContaining(['KELAS_KLIK_DITOLAK', 'HALAMAN_AKHIR_TERKUNCI']),
    );
  });

  it('N1: model tidak bisa memilih ketuk_tautan sendiri (mis. menyorot tombol Kirim sebagai "tautan")', () => {
    // PoC D review keamanan: serahkan ketuk_tautan ke tombol kirim di halaman tinjauan.
    const tinjau = beranda({
      elemen: [{ ref: 'e9', peran: 'tombol', nama: 'Kirim Permohonan', kelas: 'kirim' }],
      sinyal: { ...halamanForm().sinyal, halamanAkhir: true },
    });
    for (const p of [tinjau, beranda()])
      for (const ref of ['e9', 'e1'])
        expect(tolak(rencana({ jenis: 'serahkan', alasan: 'ketuk_tautan', ref }), p)).toEqual([
          'SKEMA_TIDAK_SAH',
        ]);
    // `berhenti` hanya serah akhir loop sendiri, bukan pilihan model.
    expect(tolak(rencana({ jenis: 'serahkan', alasan: 'berhenti' }), beranda())).toEqual(['SKEMA_TIDAK_SAH']);
  });

  it('N1: ref serah harus diamati dan cocok dengan alasannya (isi_sendiri hanya ke kolom)', () => {
    const p = beranda({
      elemen: [
        ...beranda().elemen,
        { ref: 'e4', peran: 'teks', nama: 'Nomor Kitir', kelas: 'ui_lokal' },
        { ref: 'e5', peran: 'tombol', nama: 'Kirim', kelas: 'kirim' },
      ],
    });
    expect(tolak(rencana({ jenis: 'serahkan', alasan: 'isi_sendiri', ref: 'e5' }), p)).toEqual([
      'PERAN_TIDAK_COCOK',
    ]);
    expect(tolak(rencana({ jenis: 'serahkan', alasan: 'final', ref: 'e77' }), p)).toEqual([
      'REF_TIDAK_DIAMATI',
    ]);
    expect(validasiRencana(rencana({ jenis: 'serahkan', alasan: 'isi_sendiri', ref: 'e4' }), p).ok).toBe(
      true,
    );
    expect(validasiRencana(rencana({ jenis: 'serahkan', alasan: 'final', ref: 'e5' }), p).ok).toBe(true);
  });

  it('serah selain final tidak boleh menyorot tombol kirim akhir', () => {
    const p = beranda({
      elemen: [
        ...beranda().elemen,
        { ref: 'e5', peran: 'tombol', nama: 'Kirim Permohonan', kelas: 'kirim' },
        { ref: 'e6', peran: 'tombol', nama: 'Masuk', kelas: 'masuk' },
      ],
      sinyal: { ...halamanForm().sinyal, halamanAkhir: true },
    });
    for (const alasan of ['masuk_akun', 'otp', 'captcha', 'tidak_yakin'] as const)
      expect(tolak(rencana({ jenis: 'serahkan', alasan, ref: 'e5' }), p)).toEqual(['KELAS_KLIK_DITOLAK']);
    expect(validasiRencana(rencana({ jenis: 'serahkan', alasan: 'final', ref: 'e5' }), p).ok).toBe(true);
    expect(validasiRencana(rencana({ jenis: 'serahkan', alasan: 'masuk_akun', ref: 'e6' }), p).ok).toBe(true);
    expect(validasiRencana(rencana({ jenis: 'serahkan', alasan: 'tidak_yakin' }), p).ok).toBe(true);
  });
});

describe('pembukaPengajuan: CTA mulai/daftar layanan didahulukan di atas tautan informasi', () => {
  // Cermin amatan probe 9171 (PaceMace Kota Jayapura, gel5-prod): beranda tanpa formulir.
  const paceMace = (over: Partial<Pengamatan> = {}): Pengamatan => ({
    ...halamanForm(),
    jalur: '/pacemace/',
    judul: 'PaceMace - Kota Jayapura',
    elemen: [
      { ref: 'e1', peran: 'tautan', nama: 'PaceMace', kelas: 'navigasi' },
      { ref: 'e2', peran: 'tombol', nama: 'Toggle navigation', kelas: 'ui_lokal' },
      { ref: 'e6', peran: 'tautan', nama: 'Persyaratan & Formulir', kelas: 'navigasi' },
      { ref: 'e8', peran: 'tautan', nama: 'Mulai Pendaftaran', kelas: 'kirim', tautanPembuka: true },
      { ref: 'e10', peran: 'tautan', nama: 'Cek Status KTP-el', kelas: 'navigasi' },
      { ref: 'e12', peran: 'tautan', nama: 'Pojok Dukcapil', kelas: 'navigasi' },
    ],
    ...over,
  });

  it('beranda PaceMace: "Mulai Pendaftaran" dipilih, bukan "Persyaratan & Formulir"', () => {
    expect(pembukaPengajuan(paceMace())).toBe('e8');
    // Menu ponsel + desktop memuat CTA yang sama dua kali: tetap satu CTA.
    const ganda = paceMace({
      elemen: [
        ...paceMace().elemen,
        { ref: 'e20', peran: 'tautan', nama: 'Mulai  pendaftaran', kelas: 'kirim', tautanPembuka: true },
      ],
    });
    expect(pembukaPengajuan(ganda)).toBe('e8');
    for (const nama of ['Ajukan Permohonan', 'Buat Permohonan Baru', 'Daftar Sekarang'])
      expect(
        pembukaPengajuan(
          paceMace({
            elemen: [{ ref: 'e3', peran: 'tautan', nama, kelas: 'kirim', tautanPembuka: true }],
          }),
        ),
      ).toBe('e3');
  });

  it('tidak berlaku: halaman berformulir, halaman masuk/akhir/tantangan, CTA akun, atau dua CTA berbeda', () => {
    expect(pembukaPengajuan(halamanForm())).toBeUndefined();
    const s = paceMace().sinyal;
    for (const k of ['login', 'halamanAkhir', 'tantangan', 'captcha', 'otp'] as const)
      expect(pembukaPengajuan(paceMace({ sinyal: { ...s, [k]: true } }))).toBeUndefined();
    const berkolom = paceMace({
      elemen: [...paceMace().elemen, { ref: 'e30', peran: 'teks', nama: 'Nomor resi' }],
    });
    expect(pembukaPengajuan(berkolom)).toBeUndefined();
    for (const nama of ['Daftar Akun', 'Registrasi', 'Masuk / Daftar'])
      expect(
        pembukaPengajuan(
          paceMace({ elemen: [{ ref: 'e3', peran: 'tautan', nama, kelas: 'kirim', tautanPembuka: true }] }),
        ),
      ).toBeUndefined();
    // Tanpa penanda tautanPembuka (tombol kirim biasa) tidak pernah dipilih.
    expect(
      pembukaPengajuan(
        paceMace({ elemen: [{ ref: 'e3', peran: 'tombol', nama: 'Mulai Pendaftaran', kelas: 'kirim' }] }),
      ),
    ).toBeUndefined();
    const dua = paceMace({
      elemen: [
        ...paceMace().elemen,
        { ref: 'e9', peran: 'tautan', nama: 'Ajukan Akta Kematian', kelas: 'kirim', tautanPembuka: true },
      ],
    });
    expect(pembukaPengajuan(dua)).toBeUndefined();
  });
});

describe('skema ketat', () => {
  it('bisa dikirim sebagai json_schema strict', () => {
    const s = toStrictJsonSchema(RencanaKetatSchema);
    expect(findStrictViolations(s)).toEqual([]);
  });

  it('setiap rencana yang lolos skema ketat + validator juga sah menurut kontrak', () => {
    const ref = fc.constantFrom('e1', 'e2', 'e3', 'e4', 'e7', 'e9', 'e10', 'e11', 'e99');
    const ph = fc.constantFrom(...Object.keys(KATALOG_PLACEHOLDER), '{{ANAK.NIK}}');
    const aksi = fc.oneof(
      fc.record({ jenis: fc.constant('isi'), ref, nilai: ph }),
      fc.record({
        jenis: fc.constant('pilih'),
        ref,
        nilai: fc.record({ opsi: fc.integer({ min: 0, max: 5 }) }),
      }),
      fc.record({ jenis: fc.constant('klik'), ref }),
      fc.record({ jenis: fc.constant('unggah'), ref, berkas: fc.constantFrom('KTP', 'KK', 'X') }),
      fc.record({ jenis: fc.constant('serahkan'), alasan: fc.constantFrom('final', 'tidak_yakin') }),
    );
    fc.assert(
      fc.property(fc.array(aksi, { minLength: 1, maxLength: 6 }), (a) => {
        const v = validasiRencana({ aksi: a }, halamanForm());
        if (v.ok) {
          expect(RencanaHalamanSchema.safeParse(v.rencana).success).toBe(true);
          for (const x of v.rencana.aksi) expect(AksiSchema.safeParse(x).success).toBe(true);
        } else expect(v.aturan.length).toBeGreaterThan(0);
      }),
      { numRuns: 300 },
    );
  });
});

describe('QA prod gel6: pintu akun dan petunjuk warga', () => {
  const p = (elemen: Pengamatan['elemen'], sinyal: Partial<Pengamatan['sinyal']> = {}): Pengamatan => ({
    ...halamanForm(),
    sinyal: { ...halamanForm().sinyal, ...sinyal },
    elemen,
  });

  it('pintuAkun: masuk yang boleh dibuka = buka; tombol masuk = serahkan; Masuk didahulukan atas Daftar', () => {
    expect(
      pintuAkun(
        p([
          { ref: 'e5', peran: 'tautan', nama: 'DAFTAR AKUN', kelas: 'kirim', tautanPembuka: true },
          { ref: 'e4', peran: 'tautan', nama: 'LOGIN', kelas: 'navigasi' },
        ]),
      ),
    ).toEqual({ jenis: 'buka', ref: 'e4' });
    expect(pintuAkun(p([{ ref: 'e1', peran: 'tombol', nama: 'Masuk', kelas: 'masuk' }]))).toEqual({
      jenis: 'serahkan',
      ref: 'e1',
    });
  });

  it('pintuAkun: bukan untuk halaman masuk, sesi aktif, formulir, CTA layanan tanpa daftar akun, nama campuran', () => {
    const masuk = { ref: 'e1', peran: 'tautan' as const, nama: 'Masuk', kelas: 'navigasi' as const };
    expect(pintuAkun(p([masuk], { login: true }))).toBeUndefined();
    expect(
      pintuAkun(p([masuk, { ref: 'e2', peran: 'tautan', nama: 'Logout', kelas: 'navigasi' }])),
    ).toBeUndefined();
    expect(pintuAkun(p([...halamanForm().elemen, masuk]))).toBeUndefined();
    expect(
      pintuAkun(
        p([
          masuk,
          { ref: 'e8', peran: 'tautan', nama: 'Mulai Pendaftaran', kelas: 'kirim', tautanPembuka: true },
        ]),
      ),
    ).toBeUndefined();
    expect(
      pintuAkun(
        p([{ ref: 'e1', peran: 'tautan', nama: 'Masuk & Ajukan', kelas: 'kirim', tautanPembuka: true }]),
      ),
    ).toBeUndefined();
    expect(
      pintuAkun(p([{ ref: 'e1', peran: 'tautan', nama: 'Surat Masuk Dinas', kelas: 'navigasi' }])),
    ).toBeUndefined();
  });

  it('klik tautan pembuka di halaman akhir tetap ditolak (kelas dan kunci akhir)', () => {
    const akhir = p([{ ref: 'e1', peran: 'tautan', nama: 'Login', kelas: 'kirim', tautanPembuka: true }], {
      halamanAkhir: true,
    });
    expect(tolak(rencana({ jenis: 'klik', ref: 'e1' }), akhir)).toEqual(
      expect.arrayContaining(['KELAS_KLIK_DITOLAK', 'HALAMAN_AKHIR_TERKUNCI']),
    );
  });

  it('petunjukWarga: akun lalu layanan lalu menu; tombol kirim tidak pernah disorot', () => {
    expect(
      petunjukWarga(
        p([
          { ref: 'e1', peran: 'tombol', nama: 'Kirim Pengajuan', kelas: 'kirim' },
          { ref: 'e2', peran: 'tautan', nama: 'Lihat Layanan', kelas: 'navigasi' },
          { ref: 'e3', peran: 'tombol', nama: 'Toggle menu', kelas: 'ui_lokal' },
        ]),
      ),
    ).toBe('e2');
    expect(petunjukWarga(p([{ ref: 'e3', peran: 'tombol', nama: 'Toggle menu', kelas: 'ui_lokal' }]))).toBe(
      'e3',
    );
    expect(
      petunjukWarga(p([{ ref: 'e1', peran: 'tombol', nama: 'Daftar', kelas: 'kirim' }])),
    ).toBeUndefined();
  });
});

describe('halamanDaftarAkun + kolom kredensial (QA prod 2026-11-12 Klampid "Buat Akun")', () => {
  const sinyal = { ...halamanForm().sinyal, login: true };
  const buatAkun = (): Pengamatan => ({
    ...halamanForm(),
    jalur: '/app/register',
    judul: 'Buat Akun',
    sinyal,
    elemen: [
      { ref: 'e1', peran: 'teks', nama: 'NIK' },
      { ref: 'e2', peran: 'teks', nama: 'Username' },
      { ref: 'e3', peran: 'teks', nama: 'Email' },
      { ref: 'e4', peran: 'teks', nama: 'Nomor Telepon' },
      { ref: 'e5', peran: 'teks', nama: 'Password', terlarang: 'sandi' },
      { ref: 'e6', peran: 'tombol', nama: 'Daftar', kelas: 'kirim' },
    ],
  });
  const masuk = (elemen: Pengamatan['elemen'], judul = 'Masuk'): Pengamatan => ({
    ...halamanForm(),
    jalur: '/login',
    judul,
    teks: 'Silakan masuk',
    sinyal,
    elemen,
  });

  it('formulir Buat Akun = daftar akun; formulir masuk (NIK/email + sandi + CAPTCHA) bukan', () => {
    expect(halamanDaftarAkun(buatAkun())).toBe(true);
    expect(
      halamanDaftarAkun(
        masuk([
          { ref: 'e1', peran: 'teks', nama: 'NIK' },
          { ref: 'e2', peran: 'teks', nama: 'Kata sandi', terlarang: 'sandi' },
          { ref: 'e3', peran: 'teks', nama: 'Kode keamanan', terlarang: 'captcha' },
          { ref: 'e4', peran: 'centang', nama: 'Ingat saya' },
        ]),
      ),
    ).toBe(false);
    expect(
      halamanDaftarAkun(
        masuk([
          { ref: 'e1', peran: 'teks', nama: 'Username' },
          { ref: 'e2', peran: 'teks', nama: 'Password', terlarang: 'sandi' },
        ]),
      ),
    ).toBe(false);
    // Sandi + konfirmasi sandi = daftar akun walau kolom datanya sedikit.
    expect(
      halamanDaftarAkun(
        masuk([
          { ref: 'e1', peran: 'teks', nama: 'Email' },
          { ref: 'e2', peran: 'teks', nama: 'Password', terlarang: 'sandi' },
          { ref: 'e3', peran: 'teks', nama: 'Ulangi Password', terlarang: 'sandi' },
        ]),
      ),
    ).toBe(true);
    // Dua kolom data + penanda daftar di judul.
    expect(
      halamanDaftarAkun(
        masuk(
          [
            { ref: 'e1', peran: 'teks', nama: 'Email' },
            { ref: 'e2', peran: 'teks', nama: 'Nomor HP' },
            { ref: 'e3', peran: 'teks', nama: 'Password', terlarang: 'sandi' },
          ],
          'Registrasi Akun',
        ),
      ),
    ).toBe(true);
    // Tanpa kolom sandi: bukan halaman akun.
    expect(halamanDaftarAkun({ ...buatAkun(), sinyal: halamanForm().sinyal })).toBe(false);
  });

  it('username/nama pengguna/sandi tidak pernah diisi AI (KOLOM_TERLARANG), data diri boleh', () => {
    const p = buatAkun();
    expect(tolak(rencana({ jenis: 'isi', ref: 'e2', nilai: '{{PEMOHON.EMAIL}}' }), p)).toEqual([
      'KOLOM_TERLARANG',
    ]);
    const v = validasiRencana(
      rencana(
        { jenis: 'isi', ref: 'e1', nilai: '{{PEMOHON.NIK}}' },
        { jenis: 'isi', ref: 'e3', nilai: '{{PEMOHON.EMAIL}}' },
        { jenis: 'isi', ref: 'e4', nilai: '{{PEMOHON.HP}}' },
        { jenis: 'serahkan', alasan: 'isi_sendiri', ref: 'e2' },
      ),
      p,
    );
    expect(v.ok).toBe(true);
    expect(kolomKredensial({ nama: 'Nama Pengguna' })).toBe(true);
    expect(kolomKredensial({ nama: 'Nama Lengkap' })).toBe(false);
  });
});
