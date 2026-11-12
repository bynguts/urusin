import { randomInt } from 'node:crypto';
import type { CatatanPendamping, Pengamatan } from '@urusin/contracts';
import { describe, expect, it } from 'vitest';
import { createGerbangTulis, JENDELA_ISI_MS, type Jendela } from './gerbang-tulis.js';
import {
  labelAman,
  namaPortal,
  pesanMasukAkun,
  pesanPetunjuk,
  GenerikRun,
  naikHttps,
  PESAN_GENERIK,
  redaksi,
  tidakLazim,
  type AksiRunner,
  type HasilRunner,
  type IzinGenerik,
  type PetaRef,
  type TanganHalaman,
} from './generik.js';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const PH_NAMA = '{{PEMOHON.NAMA}}';
const PH_NIK = '{{PEMOHON.NIK}}';
const T0 = 5_000_000;

function pengamatan(over: Partial<Pengamatan> = {}): Pengamatan {
  return {
    v: 1,
    seq: 0,
    host: 'portal.contoh.go.id',
    jalur: '/layanan/kk',
    judul: 'Formulir KK',
    sinyal: {
      login: false,
      otp: false,
      captcha: false,
      tantangan: false,
      halamanAkhir: false,
      sukses: false,
      galatForm: false,
    },
    elemen: [
      { ref: 'e1', peran: 'teks', nama: 'Nama lengkap', isian: 'kosong' },
      { ref: 'e2', peran: 'teks', nama: 'Nomor Induk Kependudukan', isian: 'kosong' },
      { ref: 'e3', peran: 'tombol', nama: 'Lanjut', kelas: 'lanjut' },
      { ref: 'e4', peran: 'tautan', nama: 'Daftar Layanan', kelas: 'navigasi' },
      { ref: 'e5', peran: 'tombol', nama: 'Kirim', kelas: 'kirim' },
    ],
    teks: 'Isi formulir berikut.',
    sidik: 'sidik-halaman',
    ...over,
  };
}

const PETA: PetaRef = {
  e1: { jalur: 'form > input:nth-of-type(1)', sidik: 's-nama' },
  e2: { jalur: 'form > input:nth-of-type(2)', sidik: 's-nik' },
  e3: { jalur: 'form > button:nth-of-type(1)', sidik: 's-lanjut' },
  e4: { jalur: 'nav > a:nth-of-type(1)', sidik: 's-tautan' },
  e5: { jalur: 'form > button:nth-of-type(2)', sidik: 's-kirim' },
};

type Opsi = {
  amati?: () => Pengamatan;
  aksi?: (a: AksiRunner) => HasilRunner | null;
  urlBoleh?: (url: string) => boolean;
  /** Dipanggil saat worker menavigasi (mis. untuk mensimulasikan redirect yang dibatalkan allowlist). */
  saatNavigasi?: (run: GenerikRun) => void;
  /** URL dokumen akhir setelah navigasi ke URL tertentu (mensimulasikan redirect 302). */
  alihkan?: Record<string, string>;
  peta?: PetaRef;
  /** Href tautan pembuka per ref (op runner `tautan`). */
  tautan?: Record<string, string>;
  /** Tangan `lebarkan` (probe gel4 3279); undefined = tangan tanpa kemampuan itu. */
  lebarkan?: () => Promise<boolean>;
  belumTampil?: () => Promise<boolean>;
};

function harness(o: Opsi = {}) {
  let now = T0;
  const panggilan: AksiRunner[] = [];
  const navigasi: string[] = [];
  const jendelaSaatAksi: Jendela[] = [];
  const jejak: CatatanPendamping[] = [];
  const serah: { alasan: string; pesan: string; sorot: unknown; tautan?: unknown }[] = [];
  const tidakBisa: string[] = [];
  const diisiDikirim: Record<string, string>[] = [];
  const minta: Parameters<IzinGenerik['minta']>[0][] = [];
  const vault = new Map<string, string>();
  const setuju = new Map<string, Set<string>>();
  const ref: { run?: GenerikRun } = {};
  let urlKini = 'https://portal.contoh.go.id/form';
  const gerbang = createGerbangTulis({
    wargaPegang: () => false,
    onBlokir: (c, j) => ref.run!.blokir(c, j),
    now: () => now,
  });
  const tangan: TanganHalaman = {
    async amati(_seq, diisi) {
      diisiDikirim.push(diisi);
      return { pengamatan: (o.amati ?? pengamatan)(), peta: o.peta ?? PETA };
    },
    async aksi(a) {
      panggilan.push(a);
      jendelaSaatAksi.push(gerbang.jendela());
      return o.aksi ? o.aksi(a) : { status: 'ok', aturan: 'A_OK' };
    },
    async navigasi(url) {
      jendelaSaatAksi.push(gerbang.jendela());
      navigasi.push(url);
      urlKini = o.alihkan?.[url] ?? url;
      o.saatNavigasi?.(ref.run!);
    },
    sorot: async () => ({ x: 1, y: 2, lebar: 3, tinggi: 4 }),
    tautan: async (r) => o.tautan?.[r],
    tenang: async () => {},
    urlKini: () => urlKini,
    ...(o.lebarkan ? { lebarkan: o.lebarkan } : {}),
    ...(o.belumTampil ? { belumTampil: o.belumTampil } : {}),
  };
  const izin: IzinGenerik = {
    disetujui: (h, sidik, ph) => setuju.get(h)?.has(`${sidik}|${ph}`) ?? false,
    berkasDisetujui: (h, nama) => setuju.get(h)?.has(`berkas|${nama}`) ?? false,
    minta: (p) => void minta.push(p),
    nilai: (ph) => vault.get(ph),
    berkas: () => undefined,
    vault: () => vault.entries(),
  };
  const run = (ref.run = new GenerikRun({
    tangan,
    gerbang,
    izin,
    urlBoleh: o.urlBoleh ?? (() => true),
    jejak: (c) => void jejak.push(c),
    serahkan: (alasan, pesan, sorot, tautan) =>
      void serah.push({ alasan, pesan, sorot, ...(tautan ? { tautan } : {}) }),
    tidakBisa: (p) => void tidakBisa.push(p),
    now: () => now,
  }));
  return {
    run,
    gerbang,
    panggilan,
    navigasi,
    jendelaSaatAksi,
    jejak,
    serah,
    tidakBisa,
    diisiDikirim,
    minta,
    vault,
    setujui: (h: string, ...k: string[]) => setuju.set(h, new Set(k)),
    maju: (ms: number) => (now += ms),
  };
}

describe('GenerikRun: kunci halaman akhir', () => {
  it('klik pada halaman akhir = HALAMAN_AKHIR tanpa menyentuh halaman', async () => {
    const h = harness({
      amati: () => pengamatan({ sinyal: { ...pengamatan().sinyal, halamanAkhir: true } }),
    });
    const p = await h.run.amati();
    expect(p?.sinyal.halamanAkhir).toBe(true);
    const r = await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'klik', ref: 'e3' }] });
    expect(r).toEqual([{ indeks: 0, kode: 'HALAMAN_AKHIR' }]);
    expect(h.panggilan).toEqual([]);
  });

  it('N7: centang pada halaman akhir = HALAMAN_AKHIR tanpa menyentuh halaman', async () => {
    const h = harness({
      amati: () => pengamatan({ sinyal: { ...pengamatan().sinyal, halamanAkhir: true } }),
    });
    await h.run.amati();
    const r = await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'centang', ref: 'e1', nilai: true }] });
    expect(r).toEqual([{ indeks: 0, kode: 'HALAMAN_AKHIR' }]);
    expect(h.panggilan).toEqual([]);
  });

  it('kunci mengikuti pengamatan terakhir', async () => {
    let akhir = true;
    const h = harness({
      amati: () => pengamatan({ sinyal: { ...pengamatan().sinyal, halamanAkhir: akhir } }),
    });
    await h.run.amati();
    akhir = false;
    await h.run.amati();
    const r = await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'klik', ref: 'e3' }] });
    expect(r[0]?.kode).toBe('ok');
  });
});

describe('GenerikRun: tombol masuk khusus layar lebar (probe gel4 3279)', () => {
  const beranda = (masuk: boolean) =>
    pengamatan({
      jalur: '/',
      judul: 'Beranda',
      elemen: [
        { ref: 'e1', peran: 'tautan', nama: 'Beranda', kelas: 'navigasi' },
        { ref: 'e2', peran: 'tombol', nama: 'Menu', kelas: 'ui_lokal' },
        ...(masuk ? [{ ref: 'e3', peran: 'tautan' as const, nama: 'Masuk', kelas: 'masuk' as const }] : []),
      ],
    });

  it('halaman tanpa formulir dan tanpa kendali masuk: tangan melebarkan lalu halaman diamati ulang', async () => {
    let lebar = false;
    let dipanggil = 0;
    const h = harness({
      amati: () => beranda(lebar),
      lebarkan: async () => {
        dipanggil++;
        if (lebar) return false;
        lebar = true;
        return true;
      },
    });
    const p = await h.run.amati();
    expect(dipanggil).toBe(1);
    expect(p?.elemen.map((e) => e.nama)).toContain('Masuk');
    // Peta ref/jejak milik pengamatan sesudah dilebarkan saja.
    expect(h.jejak.filter((c) => c.jenis === 'amati')).toHaveLength(1);
    expect(h.diisiDikirim).toHaveLength(2);
  });

  it('probe gel5 3402: halaman berformulir/banyak tautan tanpa kendali masuk tetap diperiksa', async () => {
    let dipanggil = 0;
    await harness({ amati: () => pengamatan(), lebarkan: async () => (dipanggil++, false) }).run.amati();
    expect(dipanggil).toBe(1);
  });

  it('kendali masuk terlihat, formulir masuk, atau pantau baca-saja: tidak melebarkan', async () => {
    let dipanggil = 0;
    const lebarkan = async () => (dipanggil++, false);
    for (const amati of [
      () => beranda(true),
      () => pengamatan({ sinyal: { ...pengamatan().sinyal, login: true }, elemen: [] }),
    ]) {
      const h = harness({ amati, lebarkan });
      await h.run.amati();
      await h.run.amati(true);
    }
    // Pantau tidak pernah mengubah halaman, bahkan di halaman polos.
    await harness({ amati: () => beranda(false), lebarkan }).run.amati(true);
    expect(dipanggil).toBe(0);
  });
});

describe('GenerikRun: persetujuan terikat rencanaHash', () => {
  it('isi tanpa persetujuan = BELUM_DISETUJUI, tidak ada aksi yang dijalankan, lembar diminta', async () => {
    const h = harness();
    await h.run.amati();
    h.vault.set(PH_NAMA, 'Budi Santoso');
    const r = await h.run.aksi({
      rencanaHash: H1,
      aksi: [
        { jenis: 'klik', ref: 'e4' },
        { jenis: 'isi', ref: 'e1', nilai: PH_NAMA },
        { jenis: 'isi', ref: 'e2', nilai: PH_NIK },
      ],
    });
    expect(r).toEqual([
      { indeks: 0, kode: 'DILEWATI' },
      { indeks: 1, kode: 'BELUM_DISETUJUI' },
      { indeks: 2, kode: 'BELUM_DISETUJUI' },
    ]);
    expect(h.panggilan).toEqual([]);
    expect(h.minta).toEqual([
      {
        rencanaHash: H1,
        // Tujuan persetujuan = origin halaman yang sedang diisi.
        origin: 'https://portal.contoh.go.id',
        berkas: [],
        kolom: [
          { placeholder: PH_NAMA, labelPortal: 'Nama lengkap', sidik: 's-nama' },
          { placeholder: PH_NIK, labelPortal: 'Nomor Induk Kependudukan', sidik: 's-nik' },
        ],
      },
    ]);
  });

  it('pasangan disetujui untuk rencana itu saja; rencana lain = BELUM_DISETUJUI', async () => {
    const h = harness();
    await h.run.amati();
    h.vault.set(PH_NAMA, 'Budi Santoso');
    h.setujui(H1, `s-nama|${PH_NAMA}`);
    const lain = await h.run.aksi({ rencanaHash: H2, aksi: [{ jenis: 'isi', ref: 'e1', nilai: PH_NAMA }] });
    expect(lain).toEqual([{ indeks: 0, kode: 'BELUM_DISETUJUI' }]);
    expect(h.panggilan).toEqual([]);
    const ok = await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'isi', ref: 'e1', nilai: PH_NAMA }] });
    expect(ok).toEqual([{ indeks: 0, kode: 'ok' }]);
    expect(h.panggilan).toEqual([{ jenis: 'isi', ref: 'e1', placeholder: PH_NAMA, nilai: 'Budi Santoso' }]);
    // Jendela isi: XHR non-GET boleh <= 3 detik.
    expect(h.jendelaSaatAksi).toEqual([{ jenis: 'ai_isi', sampai: T0 + JENDELA_ISI_MS }]);
    // Pengamatan berikutnya menampilkan placeholder (bukan nilai) untuk kolom yang diisi worker.
    await h.run.amati();
    expect(h.diisiDikirim.at(-1)).toEqual({ 's-nama': PH_NAMA });
  });

  it('pasangan disetujui untuk kolom lain (sidik beda) tidak berlaku', async () => {
    const h = harness();
    await h.run.amati();
    h.vault.set(PH_NIK, '1234567890123456'); // pii-scan:allow (nilai sintetis)
    h.setujui(H1, `s-nik|${PH_NIK}`);
    const r = await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'isi', ref: 'e1', nilai: PH_NIK }] });
    expect(r).toEqual([{ indeks: 0, kode: 'BELUM_DISETUJUI' }]);
    expect(h.minta[0]?.kolom[0]).toMatchObject({
      placeholder: PH_NIK,
      labelPortal: 'Nama lengkap',
      tidakLazim: true,
    });
  });
});

describe('GenerikRun: ref', () => {
  it('tanpa pengamatan = REF_TIDAK_ADA; seq lain = REF_BASI; ref asing = REF_TIDAK_ADA', async () => {
    const h = harness();
    expect(await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'klik', ref: 'e3' }] })).toEqual([
      { indeks: 0, kode: 'REF_TIDAK_ADA' },
    ]);
    const p = await h.run.amati();
    expect(
      await h.run.aksi({
        rencanaHash: H1,
        seq: p!.seq + 7,
        aksi: [
          { jenis: 'klik', ref: 'e3' },
          { jenis: 'klik', ref: 'e4' },
        ],
      }),
    ).toEqual([
      { indeks: 0, kode: 'REF_BASI' },
      { indeks: 1, kode: 'DILEWATI' },
    ]);
    expect(await h.run.aksi({ rencanaHash: H1, seq: p!.seq, aksi: [{ jenis: 'klik', ref: 'e99' }] })).toEqual(
      [{ indeks: 0, kode: 'REF_TIDAK_ADA' }],
    );
    expect(h.panggilan).toEqual([]);
  });

  it('sidik berubah di halaman = REF_BASI; aksi berikutnya dilewati', async () => {
    const h = harness({ aksi: () => ({ status: 'gagal', aturan: 'A_REF_BASI', kode: 'REF_BASI' }) });
    await h.run.amati();
    const r = await h.run.aksi({
      rencanaHash: H1,
      aksi: [
        { jenis: 'centang', ref: 'e1', nilai: true },
        { jenis: 'klik', ref: 'e3' },
      ],
    });
    expect(r).toEqual([
      { indeks: 0, kode: 'REF_BASI' },
      { indeks: 1, kode: 'DILEWATI' },
    ]);
  });
});

describe('GenerikRun: kolom dari validator web', () => {
  it('label dan tidakLazim web dipakai; tidakLazim = OR dengan heuristik worker', async () => {
    const h = harness();
    await h.run.amati();
    await h.run.aksi({
      rencanaHash: H1,
      aksi: [
        { jenis: 'isi', ref: 'e1', nilai: PH_NAMA },
        { jenis: 'isi', ref: 'e2', nilai: PH_NIK },
      ],
      kolom: [
        { placeholder: PH_NAMA, labelPortal: 'Nama (sesuai KTP)', tidakLazim: true },
        { placeholder: PH_NIK, labelPortal: 'Catatan' },
      ],
    });
    expect(h.minta[0]?.kolom).toEqual([
      { placeholder: PH_NAMA, labelPortal: 'Nama (sesuai KTP)', tidakLazim: true, sidik: 's-nama' },
      // Web tidak menandai, heuristik worker menandai NIK ke label "Catatan".
      { placeholder: PH_NIK, labelPortal: 'Catatan', tidakLazim: true, sidik: 's-nik' },
    ]);
  });

  it('tanpa kolom web: label dari pengamatan', async () => {
    const h = harness();
    await h.run.amati();
    await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'isi', ref: 'e1', nilai: PH_NAMA }] });
    expect(h.minta[0]?.kolom).toEqual([
      { placeholder: PH_NAMA, labelPortal: 'Nama lengkap', sidik: 's-nama' },
    ]);
  });
});

describe('GenerikRun: amati pantau', () => {
  it('pantau: tanpa jejak, peta ref tetap milik pengamatan terakhir (ref pantau = REF_BASI)', async () => {
    const h = harness();
    const p1 = await h.run.amati();
    const p2 = await h.run.amati(true);
    expect(p2!.seq).toBeGreaterThan(p1!.seq);
    expect(h.jejak.filter((c) => c.jenis === 'amati')).toHaveLength(1);
    const basi = await h.run.aksi({ rencanaHash: H1, seq: p2!.seq, aksi: [{ jenis: 'klik', ref: 'e3' }] });
    expect(basi).toEqual([{ indeks: 0, kode: 'REF_BASI' }]);
    const r = await h.run.aksi({ rencanaHash: H1, seq: p1!.seq, aksi: [{ jenis: 'klik', ref: 'e3' }] });
    expect(r[0]?.kode).not.toBe('REF_BASI');
  });
});

describe('GenerikRun: host di luar allowlist', () => {
  it('redirect navigasi AI ke host lain: GERBANG_MEMBLOKIR, host_kandidat, serah ke warga', async () => {
    const h = harness({
      aksi: () => ({
        status: 'navigasi',
        aturan: 'K8_NAVIGASI',
        kelas: 'navigasi',
        href: 'https://portal.contoh.go.id/pindah',
      }),
      // Allowlist rute membatalkan redirect 302 ke host lain selama navigasi AI.
      saatNavigasi: (run) => run.hostDiblokir('lain.example', true),
    });
    await h.run.amati();
    const r = await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'klik', ref: 'e4' }] });
    expect(r).toEqual([{ indeks: 0, kode: 'GERBANG_MEMBLOKIR', kelas: 'navigasi' }]);
    expect(h.jejak).toContainEqual({ jenis: 'host_kandidat', host: 'lain.example' });
    expect(h.serah[0]?.pesan).toBe(PESAN_GENERIK.hostLain);
  });

  it('halaman awal yang di-redirect ke host lain juga diserahkan ke warga', async () => {
    const h = harness({ saatNavigasi: (run) => run.hostDiblokir('lain.example', true) });
    await h.run.mulai('https://portal.contoh.go.id/');
    expect(h.serah).toEqual([{ alasan: 'periksa', pesan: PESAN_GENERIK.hostLain, sorot: undefined }]);
  });

  const hanyaPortal = (u: string) => URL.parse(u)?.host === 'portal.contoh.go.id';

  it('probe gel4 9171: naikHttps menaikkan http:// host sesi https-saja, tidak pernah membuka http polos', () => {
    const boleh = (u: string) => {
      const x = URL.parse(u);
      return (
        (x?.protocol === 'https:' && x.host === 'portal.contoh.go.id') ||
        (x?.protocol === 'http:' && x.host === '127.0.0.1:4341')
      );
    };
    expect(naikHttps('http://portal.contoh.go.id/pacemace/kk?x=1#a', boleh)).toBe(
      'https://portal.contoh.go.id/pacemace/kk?x=1#a',
    );
    expect(naikHttps('http://portal.contoh.go.id:80/a', boleh)).toBe('https://portal.contoh.go.id/a');
    // Port lain, host lain, sudah https, atau http yang memang boleh (fixture) = tidak dinaikkan.
    expect(naikHttps('http://portal.contoh.go.id:8080/a', boleh)).toBeUndefined();
    expect(naikHttps('http://lain.contoh.go.id/a', boleh)).toBeUndefined();
    expect(naikHttps('https://portal.contoh.go.id/a', boleh)).toBeUndefined();
    expect(naikHttps('http://127.0.0.1:4341/a', boleh)).toBeUndefined();
    expect(naikHttps('bukan url', boleh)).toBeUndefined();
  });

  it('probe gel4 9171: klik tautan http:// ke host portal = navigasi https, bukan host lain', async () => {
    const h = harness({
      aksi: () => ({
        status: 'navigasi',
        aturan: 'K8_NAVIGASI',
        kelas: 'navigasi',
        href: 'http://portal.contoh.go.id/pacemace/layanan',
      }),
      urlBoleh: (u) => URL.parse(u)?.protocol === 'https:' && hanyaPortal(u),
    });
    await h.run.amati();
    const r = await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'klik', ref: 'e4' }] });
    expect(r).toEqual([{ indeks: 0, kode: 'ok', kelas: 'navigasi' }]);
    expect(h.navigasi).toEqual(['https://portal.contoh.go.id/pacemace/layanan']);
    expect(h.jendelaSaatAksi.at(-1)).toEqual({
      jenis: 'ai_klik',
      navKe: 'https://portal.contoh.go.id/pacemace/layanan',
    });
    expect(h.jejak.some((c) => c.jenis === 'host_kandidat')).toBe(false);
    expect(h.serah).toEqual([]);
  });

  it('redirect 302 yang ditolak proxy (bukan rute): dari URL dokumen, peramban dikembalikan', async () => {
    const pindah = 'https://portal.contoh.go.id/pindah';
    const h = harness({
      aksi: () => ({ status: 'navigasi', aturan: 'K8_NAVIGASI', kelas: 'navigasi', href: pindah }),
      urlBoleh: hanyaPortal,
      alihkan: { [pindah]: 'chrome-error://chromewebdata/' },
      // Hop redirect tidak lewat rute Playwright; proxy egress yang menolak (tanpa info dokumen).
      saatNavigasi: (run) => run.hostDiblokir('lain.example', undefined),
    });
    await h.run.amati();
    const r = await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'klik', ref: 'e4' }] });
    expect(r).toEqual([{ indeks: 0, kode: 'GERBANG_MEMBLOKIR', kelas: 'navigasi' }]);
    expect(h.jejak.filter((c) => c.jenis === 'host_kandidat')).toEqual([
      { jenis: 'host_kandidat', host: 'lain.example' },
    ]);
    expect(h.navigasi).toEqual([pindah, 'https://portal.contoh.go.id/form']);
    expect(h.serah[0]?.pesan).toBe(PESAN_GENERIK.hostLain);
    expect(h.gerbang.jendela()).toEqual({ jenis: 'ai_diam' });
  });

  it('dokumen berakhir di host http(s) lain: host itu yang jadi kandidat', async () => {
    const pindah = 'https://portal.contoh.go.id/pindah';
    const h = harness({
      aksi: () => ({ status: 'navigasi', aturan: 'K8_NAVIGASI', kelas: 'navigasi', href: pindah }),
      urlBoleh: hanyaPortal,
      alihkan: { [pindah]: 'https://sso.lain.example/masuk' },
    });
    await h.run.amati();
    const r = await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'klik', ref: 'e4' }] });
    expect(r[0]?.kode).toBe('GERBANG_MEMBLOKIR');
    expect(h.jejak).toContainEqual({ jenis: 'host_kandidat', host: 'sso.lain.example' });
  });

  it('halaman awal di-redirect lewat proxy: diserahkan ke warga, tanpa navigasi balik', async () => {
    const awal = 'https://portal.contoh.go.id/';
    const h = harness({
      urlBoleh: hanyaPortal,
      alihkan: { [awal]: 'chrome-error://chromewebdata/' },
      saatNavigasi: (run) => run.hostDiblokir('lain.example', undefined),
    });
    await h.run.mulai(awal);
    expect(h.navigasi).toEqual([awal]);
    expect(h.jejak).toContainEqual({ jenis: 'host_kandidat', host: 'lain.example' });
    expect(h.serah).toEqual([{ alasan: 'periksa', pesan: PESAN_GENERIK.hostLain, sorot: undefined }]);
  });

  it('penolakan proxy untuk subresource (dokumen tetap di allowlist): tidak dicatat, tidak diserahkan', async () => {
    const pindah = 'https://portal.contoh.go.id/pindah';
    const h = harness({
      aksi: () => ({ status: 'navigasi', aturan: 'K8_NAVIGASI', kelas: 'navigasi', href: pindah }),
      urlBoleh: hanyaPortal,
      saatNavigasi: (run) => run.hostDiblokir('cdn.lain.example', undefined),
    });
    await h.run.amati();
    const r = await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'klik', ref: 'e4' }] });
    expect(r[0]?.kode).toBe('ok');
    expect(h.jejak.filter((c) => c.jenis === 'host_kandidat')).toEqual([]);
    expect(h.serah).toEqual([]);
  });

  it('di luar aksi AI: hanya dicatat; subresource diabaikan', () => {
    const h = harness();
    h.run.hostDiblokir('iklan.example', false);
    h.run.hostDiblokir('lain.example', true);
    expect(h.jejak).toEqual([{ jenis: 'host_kandidat', host: 'lain.example' }]);
    expect(h.serah).toEqual([]);
  });
});

describe('GenerikRun: klik dan gerbang tulis', () => {
  it('klik pada tombol kirim ditolak klasifikator = KELAS_DITOLAK, dicatat tanpa teks', async () => {
    const h = harness({
      aksi: () => ({
        status: 'ditolak',
        aturan: 'K4_SUBMITTER',
        kode: 'KLIK_DITOLAK',
        kelas: 'kirim',
        fitur: { submitterAsli: true, terlihat: true, aktif: true, tag: 'button', hrefHost: '' },
      }),
    });
    await h.run.amati();
    const r = await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'klik', ref: 'e5' }] });
    expect(r).toEqual([{ indeks: 0, kode: 'KELAS_DITOLAK', kelas: 'kirim' }]);
    expect(h.jejak.find((c) => c.jenis === 'klik')).toEqual({
      jenis: 'klik',
      ref: 'e5',
      kelas: 'kirim',
      aturan: 4,
      fitur: ['submitterAsli', 'terlihat', 'aktif'],
      putusan: 'tolak',
    });
    expect(h.gerbang.jendela()).toEqual({ jenis: 'ai_diam' });
  });

  it('klik `lanjut` yang memicu fetch POST: diblokir, eskalasi `periksa` dengan sorotan', async () => {
    const h = harness({
      aksi: (a) => {
        // Handler tombol type=button memanggil fetch POST: route melihatnya selama jendela ai_klik.
        expect(
          h.gerbang.periksa({
            metode: 'POST',
            dokumen: false,
            utama: false,
            xhr: true,
            url: 'https://portal.contoh.go.id/api',
          }),
        ).toBe('blokir');
        return { status: 'ok', aturan: 'K10_LANJUT', kelas: a.jenis === 'klik' ? 'lanjut' : undefined };
      },
    });
    await h.run.amati();
    const r = await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'klik', ref: 'e3' }] });
    expect(r).toEqual([{ indeks: 0, kode: 'GERBANG_MEMBLOKIR', kelas: 'lanjut' }]);
    // Re-review A2: dokumen kotor oleh klik AI dimuat ulang (GET URL yang sama) SEBELUM serah ke warga.
    const url = 'https://portal.contoh.go.id/form';
    expect(h.jendelaSaatAksi).toEqual([{ jenis: 'ai_klik' }, { jenis: 'ai_klik', navKe: url }]);
    expect(h.navigasi).toEqual([url]);
    expect(h.serah).toEqual([
      { alasan: 'periksa', pesan: PESAN_GENERIK.kotor_klik, sorot: { x: 1, y: 2, lebar: 3, tinggi: 4 } },
    ]);
    expect(h.jejak).toContainEqual(
      expect.objectContaining({ jenis: 'blokir', metode: 'POST', jendela: 'ai_klik' }),
    );
    expect(h.gerbang.jendela()).toEqual({ jenis: 'ai_diam' });
    h.run.dokumenBaru();
    expect(h.run.kotorKeras).toBe(false);

    // Kotor kedua di URL yang sama: tidak dimuat ulang lagi; jendela warga dipersempit (kotorKeras).
    await h.run.amati();
    await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'klik', ref: 'e3' }] });
    expect(h.navigasi).toEqual([url]);
    expect(h.serah.at(-1)).toEqual({
      alasan: 'periksa',
      pesan: PESAN_GENERIK.periksa,
      sorot: { x: 1, y: 2, lebar: 3, tinggi: 4 },
    });
    expect(h.run.kotorKeras).toBe(true);
  });

  it('blokir saat ai_diam hanya dicatat (tanpa eskalasi)', async () => {
    const h = harness();
    expect(
      h.gerbang.periksa({
        metode: 'POST',
        dokumen: false,
        utama: false,
        xhr: true,
        url: 'https://portal.contoh.go.id/ping',
      }),
    ).toBe('blokir');
    expect(h.serah).toEqual([]);
    expect(h.jejak).toEqual([expect.objectContaining({ jenis: 'blokir', jendela: 'ai_diam' })]);
  });

  const postTertunda = (h: ReturnType<typeof harness>) =>
    h.gerbang.periksa({
      metode: 'POST',
      dokumen: false,
      utama: false,
      xhr: true,
      url: 'https://portal.contoh.go.id/api/final',
    });
  const tunggu = () => new Promise((r) => setTimeout(r, 0));

  it('N2: POST tertunda dari klik AI saat ai_diam = halaman kotor: muat ulang (GET) lalu serah, sekali per dokumen', async () => {
    const h = harness({ aksi: () => ({ status: 'ok', aturan: 'K10_LANJUT', kelas: 'lanjut' }) });
    await h.run.amati();
    expect(await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'klik', ref: 'e3' }] })).toEqual([
      { indeks: 0, kode: 'ok', kelas: 'lanjut' },
    ]);
    expect(h.run.kotor).toBe(false);
    expect(postTertunda(h)).toBe('blokir');
    expect(h.run.kotor).toBe(true);
    expect(postTertunda(h)).toBe('blokir');
    // amati masuk antre serial yang sama: setelah ini muat ulang dan serah sudah selesai.
    await h.run.amati(true);
    await tunggu();
    expect(h.navigasi).toEqual(['https://portal.contoh.go.id/form']);
    expect(h.jendelaSaatAksi.at(-1)).toEqual({ jenis: 'ai_klik', navKe: 'https://portal.contoh.go.id/form' });
    expect(h.serah).toEqual([{ alasan: 'periksa', pesan: PESAN_GENERIK.kotor, sorot: undefined }]);
    expect(h.gerbang.jendela()).toEqual({ jenis: 'ai_diam' });

    // Dokumen baru (hasil muat ulang) bersih; kotor lagi di URL yang sama: serah tanpa muat ulang kedua.
    h.run.dokumenBaru();
    expect(h.run.kotor).toBe(false);
    await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'klik', ref: 'e3' }] });
    postTertunda(h);
    await h.run.amati(true);
    await tunggu();
    expect(h.navigasi).toHaveLength(1);
    expect(h.serah).toHaveLength(2);
  });

  it('N2: halaman kotor tidak pernah dapat jendela XHR isi lagi', async () => {
    const h = harness();
    h.vault.set(PH_NAMA, 'Budi');
    h.setujui(H1, `s-nama|${PH_NAMA}`);
    await h.run.amati();
    await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'isi', ref: 'e1', nilai: PH_NAMA }] });
    expect(h.jendelaSaatAksi[0]).toMatchObject({ jenis: 'ai_isi' });
    h.maju(JENDELA_ISI_MS * 3);
    // Lewat jendela isi: kotor, cukup dicatat.
    expect(postTertunda(h)).toBe('blokir');
    expect(h.serah).toEqual([]);
    await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'isi', ref: 'e1', nilai: PH_NAMA }] });
    expect(h.jendelaSaatAksi[1]).toEqual({ jenis: 'ai_diam' });
    expect(postTertunda(h)).toBe('blokir');
  });

  it('N3: tulis warga tercatat sampai aksi AI berikutnya di halaman', async () => {
    const h = harness();
    await h.run.amati();
    expect(h.run.adaTulisWargaSejakAksiAi()).toBe(false);
    h.run.tulisWarga();
    expect(h.run.adaTulisWargaSejakAksiAi()).toBe(true);
    await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'pilih', ref: 'e1', nilai: { opsi: 1 } }] });
    expect(h.run.adaTulisWargaSejakAksiAi()).toBe(false);
    h.run.tulisWarga();
    await h.run.mulai('https://portal.contoh.go.id/form');
    expect(h.run.adaTulisWargaSejakAksiAi()).toBe(false);
  });

  it('heartbeat POST di dokumen yang belum disentuh AI: kotor, tetapi tanpa muat ulang/serah', async () => {
    const h = harness();
    await h.run.amati();
    postTertunda(h);
    await tunggu();
    expect(h.run.kotor).toBe(true);
    expect(h.navigasi).toEqual([]);
    expect(h.serah).toEqual([]);
  });

  it('pilih yang memicu form.submit() (POST dokumen) diblokir dan diserahkan ke warga', async () => {
    const h = harness({
      aksi: () => {
        expect(
          h.gerbang.periksa({
            metode: 'POST',
            dokumen: true,
            utama: true,
            xhr: false,
            url: 'https://portal.contoh.go.id/x',
          }),
        ).toBe('blokir');
        return { status: 'ok', aturan: 'A_OK' };
      },
    });
    await h.run.amati();
    const r = await h.run.aksi({
      rencanaHash: H1,
      aksi: [{ jenis: 'pilih', ref: 'e1', nilai: { opsi: 2 } }],
    });
    expect(r).toEqual([{ indeks: 0, kode: 'GERBANG_MEMBLOKIR' }]);
    expect(h.serah[0]?.alasan).toBe('periksa');
  });

  it.each([
    ['form POST ke iframe', { dokumen: true, utama: false, xhr: false }],
    ['sendBeacon', { dokumen: false, utama: false, xhr: false }],
  ])('pilih yang memicu %s: diblokir dan diserahkan ke warga', async (_n, bentuk) => {
    const h = harness({
      aksi: () => {
        expect(
          h.gerbang.periksa({ metode: 'POST', ...bentuk, url: 'https://portal.contoh.go.id/ajukan' }),
        ).toBe('blokir');
        return { status: 'ok', aturan: 'A_OK' };
      },
    });
    await h.run.amati();
    const r = await h.run.aksi({
      rencanaHash: H1,
      aksi: [{ jenis: 'pilih', ref: 'e1', nilai: { opsi: 1 } }],
    });
    expect(r).toEqual([{ indeks: 0, kode: 'GERBANG_MEMBLOKIR' }]);
    expect(h.serah[0]?.alasan).toBe('periksa');
  });

  it('XHR autosave dalam jendela isi lolos tanpa eskalasi', async () => {
    const h = harness({
      aksi: () => {
        expect(
          h.gerbang.periksa({
            metode: 'POST',
            dokumen: false,
            utama: false,
            xhr: true,
            url: 'https://portal.contoh.go.id/autosave',
          }),
        ).toBe('lanjut');
        return { status: 'ok', aturan: 'A_OK' };
      },
    });
    await h.run.amati();
    const r = await h.run.aksi({
      rencanaHash: H1,
      aksi: [{ jenis: 'pilih', ref: 'e1', nilai: { opsi: 1 } }],
    });
    expect(r).toEqual([{ indeks: 0, kode: 'ok' }]);
    expect(h.serah).toEqual([]);
  });

  it('klik `navigasi` = Page.navigate(href) setelah allowlist, jendela ai_klik ke href itu', async () => {
    const href = 'https://portal.contoh.go.id/layanan/kk#atas';
    const h = harness({
      aksi: () => ({ status: 'navigasi', aturan: 'K8_NAVIGASI', kelas: 'navigasi', href }),
    });
    await h.run.amati();
    const r = await h.run.aksi({
      rencanaHash: H1,
      aksi: [
        { jenis: 'klik', ref: 'e4' },
        { jenis: 'klik', ref: 'e3' },
      ],
    });
    expect(r).toEqual([
      { indeks: 0, kode: 'ok', kelas: 'navigasi' },
      { indeks: 1, kode: 'DILEWATI' },
    ]);
    expect(h.navigasi).toEqual(['https://portal.contoh.go.id/layanan/kk']);
    expect(h.jendelaSaatAksi.at(-1)).toEqual({
      jenis: 'ai_klik',
      navKe: 'https://portal.contoh.go.id/layanan/kk',
    });
  });

  it('tautan ke host di luar allowlist: tidak dinavigasi, host_kandidat + serah ke warga', async () => {
    const h = harness({
      aksi: () => ({
        status: 'navigasi',
        aturan: 'K8_NAVIGASI',
        kelas: 'navigasi',
        href: 'https://lain.example/x',
      }),
      urlBoleh: () => false,
    });
    await h.run.amati();
    const r = await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'klik', ref: 'e4' }] });
    expect(r).toEqual([{ indeks: 0, kode: 'GERBANG_MEMBLOKIR', kelas: 'navigasi' }]);
    expect(h.navigasi).toEqual([]);
    expect(h.jejak).toContainEqual({ jenis: 'host_kandidat', host: 'lain.example' });
    expect(h.serah[0]?.pesan).toBe(PESAN_GENERIK.hostLain);
  });

  it('probe 3208: amati 0 elemen (SPA lambat) = tunggu tenang lalu amati ulang sekali', async () => {
    let n = 0;
    const h = harness({ amati: () => (n++ === 0 ? pengamatan({ elemen: [] }) : pengamatan()) });
    const p = await h.run.amati();
    expect(n).toBe(2);
    expect(p?.elemen.length).toBeGreaterThan(0);
    // Halaman yang memang kosong: hanya satu ulangan, tidak berputar.
    let m = 0;
    const kosong = harness({ amati: () => (m++, pengamatan({ elemen: [] })) });
    expect((await kosong.run.amati())?.elemen).toEqual([]);
    expect(m).toBe(2);
  });

  it('serahkan dan tidak_bisa memakai pesan bertemplat', async () => {
    const h = harness();
    await h.run.amati();
    const r = await h.run.aksi({
      rencanaHash: H1,
      aksi: [{ jenis: 'serahkan', alasan: 'final', ref: 'e5' }],
    });
    expect(r).toEqual([{ indeks: 0, kode: 'ok' }]);
    expect(h.serah).toEqual([
      { alasan: 'final', pesan: PESAN_GENERIK.final, sorot: { x: 1, y: 2, lebar: 3, tinggi: 4 } },
    ]);
    expect(h.jejak).toContainEqual({ jenis: 'ambil_alih', fase: 'mulai', alasan: 'final' });
    await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'tidak_bisa', sebab: 'hanya_aplikasi' }] });
    expect(h.tidakBisa).toHaveLength(1);
  });

  const PEMBUKA = (akhir = false) =>
    pengamatan({
      sinyal: { ...pengamatan().sinyal, halamanAkhir: akhir },
      elemen: [
        ...pengamatan().elemen,
        { ref: 'e6', peran: 'tautan', nama: 'Ajukan Permohonan KK', kelas: 'kirim', tautanPembuka: true },
      ],
    });
  const PETA_PEMBUKA: PetaRef = { ...PETA, e6: { jalur: 'main > a', sidik: 's-pembuka' } };
  const HREF = 'https://portal.contoh.go.id/permohonan/kk?jenis=baru#atas';

  it('serahkan ketuk_tautan = giliran dengan sorot + tujuan; buka_tautan = navigasi GET sekali, AI lanjut', async () => {
    const h = harness({ amati: () => PEMBUKA(), peta: PETA_PEMBUKA, tautan: { e6: HREF } });
    await h.run.amati();
    const r = await h.run.aksi({
      rencanaHash: H1,
      aksi: [{ jenis: 'serahkan', alasan: 'ketuk_tautan', ref: 'e6' }],
    });
    expect(r).toEqual([{ indeks: 0, kode: 'ok' }]);
    expect(h.serah).toEqual([
      {
        alasan: 'ketuk_tautan',
        pesan: PESAN_GENERIK.ketuk_tautan,
        sorot: { x: 1, y: 2, lebar: 3, tinggi: 4 },
        tautan: {
          ref: 'e6',
          nama: 'Ajukan Permohonan KK',
          host: 'portal.contoh.go.id',
          jalur: '/permohonan/kk',
        },
      },
    ]);
    expect(PESAN_GENERIK.ketuk_tautan).not.toMatch(/formulir/);
    expect(h.jejak).toContainEqual({ jenis: 'ambil_alih', fase: 'mulai', alasan: 'ketuk_tautan' });

    let lanjut = 0;
    // Ref lain dari perangkat: ditolak tanpa menghabiskan giliran.
    expect(await h.run.bukaTautan('e5', () => void lanjut++)).toBe(false);
    expect(h.navigasi).toEqual([]);
    expect(await h.run.bukaTautan('e6', () => void lanjut++)).toBe(true);
    expect(lanjut).toBe(1);
    const tujuan = 'https://portal.contoh.go.id/permohonan/kk?jenis=baru';
    expect(h.navigasi).toEqual([tujuan]);
    expect(h.jendelaSaatAksi.at(-1)).toEqual({ jenis: 'ai_klik', navKe: tujuan });
    expect(h.gerbang.jendela()).toEqual({ jenis: 'ai_diam' });
    // Sekali per giliran.
    expect(await h.run.bukaTautan('e6', () => void lanjut++)).toBe(false);
    expect(h.navigasi).toHaveLength(1);
  });

  it('re-review LOW: hanya tulis warga dari kirim final yang dihitung kirim final; serah final menandai sorot', async () => {
    const h = harness({ amati: () => PEMBUKA(), peta: PETA_PEMBUKA });
    await h.run.amati();
    expect(h.run.sorotFinal).toBe(false);
    h.run.tulisWarga();
    expect(h.run.adaTulisWargaSejakAksiAi()).toBe(true);
    expect(h.run.adaKirimFinalWargaSejakAksiAi()).toBe(false);
    await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'serahkan', alasan: 'final', ref: 'e3' }] });
    expect(h.run.sorotFinal).toBe(true);
    h.run.tulisWarga(true);
    expect(h.run.adaKirimFinalWargaSejakAksiAi()).toBe(true);
    // Serah lain mengganti sorot final; dokumen baru juga.
    await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'serahkan', alasan: 'isi_sendiri', ref: 'e3' }] });
    expect(h.run.sorotFinal).toBe(false);
    await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'serahkan', alasan: 'final', ref: 'e3' }] });
    h.run.dokumenBaru();
    expect(h.run.sorotFinal).toBe(false);
    // Aksi AI berikutnya mereset keduanya.
    await h.run.amati();
    await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'klik', ref: 'e3' }] });
    expect(h.run.adaTulisWargaSejakAksiAi()).toBe(false);
    expect(h.run.adaKirimFinalWargaSejakAksiAi()).toBe(false);
  });

  it('berhenti: serah akhir tercatat; mode ketat = dokumen kotor atau halaman akhir dokumen ini', async () => {
    const h = harness({ amati: () => PEMBUKA(true), peta: PETA_PEMBUKA });
    expect(h.run.ketat).toBe(false);
    await h.run.amati();
    expect(h.run.ketat).toBe(true);
    h.run.dokumenBaru();
    expect(h.run.ketat).toBe(false);
    expect(h.run.berhenti).toBe(false);
    await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'serahkan', alasan: 'berhenti' }] });
    expect(h.run.berhenti).toBe(true);
    expect(h.serah.at(-1)).toMatchObject({ alasan: 'berhenti', pesan: PESAN_GENERIK.berhenti });
    expect(PESAN_GENERIK.berhenti).not.toMatch(/coba lagi/i);
    h.run.eksekusiBaru();
    expect(h.run.berhenti).toBe(false);
  });

  it('N1: serahkan ketuk_tautan ke ref bukan tautan pembuka, tanpa ref, atau di halaman akhir = KELAS_DITOLAK', async () => {
    const biasa = harness({ tautan: { e5: 'https://portal.contoh.go.id/kirim' } });
    await biasa.run.amati();
    for (const ref of ['e5', 'e3', undefined]) {
      const r = await biasa.run.aksi({
        rencanaHash: H1,
        aksi: [{ jenis: 'serahkan', alasan: 'ketuk_tautan', ...(ref ? { ref } : {}) }],
      });
      expect(r, String(ref)).toEqual([{ indeks: 0, kode: 'KELAS_DITOLAK' }]);
    }
    expect(biasa.serah).toEqual([]);

    const akhir = harness({ amati: () => PEMBUKA(true), peta: PETA_PEMBUKA, tautan: { e6: HREF } });
    await akhir.run.amati();
    expect(
      await akhir.run.aksi({
        rencanaHash: H1,
        aksi: [{ jenis: 'serahkan', alasan: 'ketuk_tautan', ref: 'e6' }],
      }),
    ).toEqual([{ indeks: 0, kode: 'KELAS_DITOLAK' }]);
    expect(akhir.serah).toEqual([]);
  });

  it('N5: tautan berubah di DOM atau ke host lain = KELAS_DITOLAK; buka_tautan tanpa giliran = tidak apa-apa', async () => {
    const berubah = harness({ amati: () => PEMBUKA(), peta: PETA_PEMBUKA });
    await berubah.run.amati();
    expect(
      await berubah.run.aksi({
        rencanaHash: H1,
        aksi: [{ jenis: 'serahkan', alasan: 'ketuk_tautan', ref: 'e6' }],
      }),
    ).toEqual([{ indeks: 0, kode: 'KELAS_DITOLAK' }]);
    expect(await berubah.run.bukaTautan('e6', () => {})).toBe(false);
    expect(berubah.navigasi).toEqual([]);

    const luar = harness({
      amati: () => PEMBUKA(),
      peta: PETA_PEMBUKA,
      tautan: { e6: 'https://jahat.contoh.com/permohonan' },
      urlBoleh: (u) => u.startsWith('https://portal.contoh.go.id/'),
    });
    await luar.run.amati();
    expect(
      await luar.run.aksi({
        rencanaHash: H1,
        aksi: [{ jenis: 'serahkan', alasan: 'ketuk_tautan', ref: 'e6' }],
      }),
    ).toEqual([{ indeks: 0, kode: 'KELAS_DITOLAK' }]);
  });

  it('TOCTOU (PoC E3): href ditukar setelah ditampilkan = tidak dibuka, giliran tetap di warga', async () => {
    for (const tukar of [
      'https://portal.contoh.go.id/p/12/x',
      'https://portal.contoh.go.id/permohonan/kk?jenis=ganti',
      undefined,
    ]) {
      const tautan: Record<string, string> = { e6: HREF };
      const h = harness({ amati: () => PEMBUKA(), peta: PETA_PEMBUKA, tautan });
      await h.run.amati();
      await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'serahkan', alasan: 'ketuk_tautan', ref: 'e6' }] });
      expect(h.serah[0]?.tautan).toMatchObject({ jalur: '/permohonan/kk' });
      if (tukar) tautan.e6 = tukar;
      else delete tautan.e6;
      let lanjut = 0;
      expect(await h.run.bukaTautan('e6', () => void lanjut++), String(tukar)).toBe(false);
      expect(lanjut).toBe(0);
      expect(h.navigasi).toEqual([]);
      expect(h.serah.at(-1)).toEqual({
        alasan: 'periksa',
        pesan: PESAN_GENERIK.tautan_berubah,
        sorot: undefined,
      });
      // Giliran itu habis: kembalikan href semula pun tidak dibuka tanpa giliran baru.
      tautan.e6 = HREF;
      expect(await h.run.bukaTautan('e6', () => void lanjut++)).toBe(false);
      expect(h.navigasi).toEqual([]);
    }
    // Hanya fragmen yang berubah = tujuan sama (fragmen tidak dikirim ke server).
    const tautan: Record<string, string> = { e6: HREF };
    const h = harness({ amati: () => PEMBUKA(), peta: PETA_PEMBUKA, tautan });
    await h.run.amati();
    await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'serahkan', alasan: 'ketuk_tautan', ref: 'e6' }] });
    tautan.e6 = 'https://portal.contoh.go.id/permohonan/kk?jenis=baru#bawah';
    expect(await h.run.bukaTautan('e6', () => {})).toBe(true);
    expect(h.navigasi).toEqual(['https://portal.contoh.go.id/permohonan/kk?jenis=baru']);
  });

  it('N5: jalur tujuan diredaksi dengan nilai vault (tujuan tampil ke warga)', async () => {
    const h = harness({
      amati: () => PEMBUKA(),
      peta: PETA_PEMBUKA,
      tautan: { e6: 'https://portal.contoh.go.id/warga/Budi%20Santoso/kk' },
    });
    h.vault.set(PH_NAMA, 'Budi Santoso');
    await h.run.amati();
    await h.run.aksi({ rencanaHash: H1, aksi: [{ jenis: 'serahkan', alasan: 'ketuk_tautan', ref: 'e6' }] });
    expect(h.serah[0]?.tautan).toMatchObject({ jalur: `/warga/${PH_NAMA}/kk` });
  });
});

describe('redaksi', () => {
  const acak = (n: number, abjad: string) =>
    Array.from({ length: n }, () => abjad[randomInt(abjad.length)]).join('');

  it('properti: respons amati tidak pernah memuat nilai vault mentah', async () => {
    for (let i = 0; i < 200; i++) {
      const nik = acak(16, '0123456789');
      const nama = `${acak(5, 'abcdefghij')} ${acak(7, 'klmnopqrst')}`;
      const kk = acak(16, '0123456789');
      const spasi = nik.replace(/(\d{4})(?=\d)/g, '$1 ');
      const h = harness({
        amati: () =>
          pengamatan({
            judul: `Data ${nama.toUpperCase()}`,
            jalur: `/cek/${nik}`,
            teks: `NIK Anda ${spasi}. Nama: ${nama}. KK ${kk}-${nik}.`,
            elemen: [
              { ref: 'e1', peran: 'teks', nama: `Halo ${nama}`, petunjuk: nik, galat: `${kk} salah` },
              { ref: 'e2', peran: 'pilihan', nama: 'Pilih', opsi: [nik, `x ${nama} y`] },
            ],
          }),
      });
      h.vault.set(PH_NIK, nik);
      h.vault.set(PH_NAMA, nama);
      h.vault.set('{{PEMOHON.NO_KK}}', kk);
      const p = await h.run.amati();
      expect(p).not.toBeNull();
      const json = JSON.stringify(p);
      for (const v of [nik, nama, kk, spasi, nama.toUpperCase()]) expect(json).not.toContain(v);
      expect(p!.teks).toContain(PH_NIK);
    }
    // 200 iterasi (~3 detik sendirian): batas longgar agar tidak gagal saat turbo paralel.
  }, 30_000);

  it('L2: pemisah bukan huruf/angka sampai 4 karakter tetap disamarkan', () => {
    const angka = acak(16, '0123456789');
    const g = angka.match(/.{4}/g)!;
    for (const pemisah of [' ** ', '_', '\u00a0', '|', ' - ', '.', ''])
      expect(redaksi(`NIK ${g.join(pemisah)} ok`, [[PH_NIK, angka]]), JSON.stringify(pemisah)).toBe(
        `NIK ${PH_NIK} ok`,
      );
    for (const nama of ['Budi_Santoso', 'budi - santoso', 'BUDI\u00a0SANTOSO', 'Budi.Santoso'])
      expect(redaksi(`Nama: ${nama}.`, [[PH_NAMA, 'Budi Santoso']]), nama).toBe(`Nama: ${PH_NAMA}.`);
    // Pemisah lebih dari 4 karakter atau huruf: bukan nilai yang sama.
    expect(redaksi(`${g[0]}-----${g.slice(1).join('')}`, [[PH_NIK, angka]])).not.toContain(PH_NIK);
  });

  it('nilai pendek tidak disamarkan; nilai terpanjang dulu', () => {
    expect(redaksi('L dan P', [['{{A.B}}', 'L']])).toBe('L dan P');
    expect(
      redaksi('Jl. Merdeka 10 Merdeka', [
        ['{{A.JALAN}}', 'Merdeka'],
        ['{{A.ALAMAT}}', 'Jl. Merdeka 10'],
      ]),
    ).toBe('{{A.ALAMAT}} {{A.JALAN}}');
  });

  it('tidakLazim: NIK ke kolom yang bukan kolom NIK ditandai', () => {
    expect(tidakLazim(PH_NIK, 'Nomor Induk Kependudukan')).toBe(false);
    expect(tidakLazim(PH_NIK, 'Catatan tambahan')).toBe(true);
    expect(tidakLazim(PH_NAMA, 'Catatan tambahan')).toBe(false);
  });
});

describe('GenerikRun: konten fade-in masih transparan (probe gel5 6171)', () => {
  it('sesudah batas tunggu masih transparan: tunggu sekali lagi lalu amati ulang (sekali saja)', async () => {
    let tampil = false;
    let ditanya = 0;
    const h = harness({
      amati: () =>
        pengamatan({
          elemen: tampil
            ? pengamatan().elemen
            : [{ ref: 'e4', peran: 'tautan', nama: 'Daftar Layanan', kelas: 'navigasi' }],
        }),
      belumTampil: async () => {
        ditanya++;
        tampil = true;
        return true;
      },
    });
    const p = await h.run.amati();
    expect(ditanya).toBe(1);
    expect(p?.elemen).toHaveLength(5);
    expect(h.diisiDikirim).toHaveLength(2);
  });

  it('pantau baca-saja dan konten yang sudah tampil: tanpa amati ulang', async () => {
    let ditanya = 0;
    const belumTampil = async () => (ditanya++, false);
    const h = harness({ belumTampil });
    await h.run.amati(true);
    expect(ditanya).toBe(0);
    await h.run.amati();
    expect(ditanya).toBe(1);
    expect(h.diisiDikirim).toHaveLength(2);
  });
});

describe('QA prod gel6: pesan giliran masuk akun dan petunjuk (templat + label akun)', () => {
  it('namaPortal: label host pertama (ejaan judul bila ada); kata umum/panjang = tanpa nama', () => {
    expect(namaPortal('sibisa.medan.go.id', 'SIBISA - Layanan Kependudukan Online')).toBe('SIBISA');
    expect(namaPortal('siapel.malangkota.go.id', 'Login - SIAPEL.')).toBe('SIAPEL');
    expect(namaPortal('telunjuksakti.wonogirikab.go.id', 'TelunjukSakti')).toBe('TelunjukSakti');
    expect(namaPortal('sirancak.disdukcapil.padang.go.id', 'beranda')).toBe('SIRANCAK');
    expect(namaPortal('disdukcapil.bandarlampungkota.go.id')).toBeUndefined();
    expect(namaPortal('wargaklampid-dispendukcapil.surabaya.go.id')).toBeUndefined();
  });

  it('beranda: Masuk didahulukan, Daftar sebagai pilihan bagi yang belum punya akun (Padang)', () => {
    expect(pesanMasukAkun({ portal: 'SIRANCAK', masuk: 'LOGIN', daftar: 'DAFTAR AKUN' })).toBe(
      'Ketuk "LOGIN" kalau sudah punya akun, lalu masuk dengan akun SIRANCAK Anda. Belum punya akun? Ketuk "DAFTAR AKUN". AI melanjutkan setelah Anda masuk.',
    );
  });

  it('formulir masuk: "Masuk dengan akun X Anda" (+ CAPTCHA bila ada), tanpa nama portal = situs ini', () => {
    expect(pesanMasukAkun({ portal: 'SIBISA', formulir: true, daftar: 'Daftar Akun Gratis' })).toBe(
      'Masuk dengan akun SIBISA Anda. Belum punya akun? Ketuk "Daftar Akun Gratis". AI melanjutkan setelah Anda masuk.',
    );
    expect(pesanMasukAkun({ formulir: true, captcha: true })).toBe(
      'Masuk dengan akun Anda di situs ini, termasuk kode keamanan (CAPTCHA). AI melanjutkan setelah Anda masuk.',
    );
  });

  it('petunjuk: label pendek dikutip; label mencurigakan (nomor, URL, panjang) tidak', () => {
    expect(pesanPetunjuk('Lihat Layanan')).toContain('"Lihat Layanan"');
    expect(labelAman('Kode antrean 98765')).toBeUndefined();
    expect(labelAman('buka https://evil.example')).toBeUndefined();
    expect(labelAman('satu dua tiga empat lima enam')).toBeUndefined();
    expect(pesanPetunjuk(undefined)).toBe(PESAN_GENERIK.tidak_yakin);
  });
});
