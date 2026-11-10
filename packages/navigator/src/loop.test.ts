import { CatatanPendampingSchema, type CatatanPendamping, type Pengamatan } from '@urusin/contracts';
import { describe, expect, it } from 'vitest';
import { Anggaran, BATAS_ANGGARAN, PESAN_AMBIL_ALIH } from './anggaran.js';
import { PESAN_BERHENTI, PESAN_DIPANDU, halamanStruktur, jalankanNavigator, type OpsiLoop } from './loop.js';
import { HOST_UJI, ProviderSkrip, WorkerPalsu, halaman, halamanForm, halamanTinjau } from './testing.js';

const CAPS = { json_schema_strict: true, tools: false };

function jalankan(
  worker: WorkerPalsu,
  provider: ProviderSkrip,
  over: Partial<OpsiLoop> = {},
): { hasil: ReturnType<typeof jalankanNavigator>; jejak: CatatanPendamping[] } {
  const jejak: CatatanPendamping[] = [];
  const hasil = jalankanNavigator({
    executionId: 'x_uji',
    tangan: worker,
    llm: { provider, model: 'fake-model', caps: CAPS },
    tujuan: 'Kelahiran',
    hostsBoleh: new Set([HOST_UJI]),
    jejak: (c) => jejak.push(c),
    ...over,
  });
  return { hasil, jejak };
}

const RENCANA_FORM = {
  aksi: [
    { jenis: 'isi', ref: 'e1', nilai: '{{PEMOHON.NIK}}' },
    { jenis: 'isi', ref: 'e2', nilai: '{{PEMOHON.NAMA}}' },
    { jenis: 'pilih', ref: 'e3', nilai: { opsi: 1 } },
    { jenis: 'klik', ref: 'e11' },
  ],
};
const SERAHKAN_FINAL = { aksi: [{ jenis: 'serahkan', alasan: 'final' }] };

describe('loop Navigator: alur bahagia di replika', () => {
  it('amati → rencana → validasi → persetujuan per halaman → aksi → halaman akhir diserahkan', async () => {
    const worker = new WorkerPalsu([halamanForm(), halamanTinjau()]);
    const provider = new ProviderSkrip((n) => (n === 0 ? RENCANA_FORM : SERAHKAN_FINAL));
    const { hasil, jejak } = jalankan(worker, provider);
    const h = await hasil;

    expect(h).toMatchObject({ akhir: 'ambil_alih', alasan: 'final', pesan: PESAN_BERHENTI.sesi_berakhir });
    // Sesi diakhiri warga sesudah serah final: pesannya "sesi berakhir", bukan giliran warga yang basi.
    // Aksi pertama tertahan sampai warga menyetujui baris (placeholder, label portal) halaman ini.
    expect(worker.diterima[0]).toMatchObject({
      kolom: [
        { placeholder: '{{PEMOHON.NIK}}', labelPortal: 'Nomor Induk Kependudukan' },
        { placeholder: '{{PEMOHON.NAMA}}', labelPortal: 'Nama Lengkap Pemohon' },
      ],
    });
    expect(worker.diterima[1]?.rencanaHash).toBe(worker.diterima[0]?.rencanaHash);
    expect(worker.disetujui.has(worker.diterima[0]!.rencanaHash)).toBe(true);
    // Tidak pernah ada klik ke tombol kirim; halaman akhir hanya serahkan.
    expect(
      new Set(worker.semuaAksi.filter((a) => a.jenis === 'klik').map((a) => 'ref' in a && a.ref)),
    ).toEqual(new Set(['e11']));
    expect(worker.semuaAksi.at(-1)).toEqual({ jenis: 'serahkan', alasan: 'final' });
    expect(provider.calls).toHaveLength(2);

    // Jejak audit: sah menurut kontrak, tanpa nilai/placeholder isian, tanpa teks halaman.
    for (const c of jejak) expect(CatatanPendampingSchema.safeParse(c).success).toBe(true);
    const teks = JSON.stringify(jejak);
    expect(teks).not.toMatch(/PEMOHON|Abaikan instruksi|Nomor Induk/);
    // Jejak worker (persetujuan, ambil alih) dikuras dan disisipkan sesuai urutan kejadian.
    expect(jejak.map((c) => c.jenis)).toEqual([
      'amati',
      'rencana',
      'validasi',
      'persetujuan',
      'amati',
      'rencana',
      'validasi',
      'ambil_alih',
    ]);
    expect(h.resi.rencana).toHaveLength(2);
    expect(h.resi.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('halaman sukses: bukti nomor registrasi diambil deterministik, tanpa LLM', async () => {
    const sukses = halaman({
      elemen: [],
      sidik: 'sukses',
      sinyal: { ...halamanForm().sinyal, sukses: true },
      teks: 'Permohonan berhasil. Nomor registrasi: REG-2026-00123. Simpan nomor ini.',
    });
    const worker = new WorkerPalsu([sukses]);
    const provider = new ProviderSkrip(() => SERAHKAN_FINAL);
    const { hasil, jejak } = jalankan(worker, provider);
    expect(await hasil).toMatchObject({ akhir: 'selesai', bukti: { nomor: 'REG-2026-00123' } });
    expect(provider.calls).toHaveLength(0);
    expect(jejak.at(-1)).toMatchObject({ jenis: 'bukti', bukti: { nomor: 'REG-2026-00123' } });
  });
});

/** Galat tangan seperti klien worker web: `sementara` = boleh dicoba ulang. */
const galat = (sementara?: 'belum_siap' | 'sesaat') =>
  Object.assign(new Error('worker'), sementara ? { sementara } : {});
const tanpaJeda = { tidur: async () => undefined };
const SUKSES = halaman({
  elemen: [],
  sidik: 'sukses',
  jalur: '/selesai',
  sinyal: { ...halamanForm().sinyal, sukses: true },
  teks: 'Permohonan berhasil. Nomor registrasi: REG-2026-00777.',
});

describe('anggaran halaman fisik dan urutan alasan', () => {
  it('satu halaman fisik yang berganti keadaan (isian, galat) dihitung satu halaman', () => {
    const a = new Anggaran();
    for (const s of ['awal', 'sesudah-isi', 'galat']) a.catatHalaman(s, 'hal-1');
    expect(a.ringkas().halaman).toBe(1);
    const p = halamanForm();
    const q = {
      ...p,
      sidik: 'lain',
      elemen: p.elemen.map((e) => ({ ...e, isian: 'terisi_warga' as const, galat: 'Wajib diisi' })),
    };
    expect(halamanStruktur(q)).toBe(halamanStruktur(p));
    expect(halamanStruktur({ ...p, jalur: '/langkah-2' })).not.toBe(halamanStruktur(p));
  });

  it('rencana yang terus ditolak di halaman yang sama = gagal_beruntun, bukan putaran', () => {
    const a = new Anggaran();
    for (let i = 0; i < 3; i++) {
      a.catatHalaman('s', 'h');
      a.gagal();
    }
    expect(a.habis()).toBe('gagal_beruntun');
  });
});

describe('ketahanan: worker belum siap, galat sesaat, dan LLM gagal', () => {
  it('409 belum siap di awal sesi (peramban masih dimulai): tunggu lalu ulang, bukan galat_worker', async () => {
    const worker = new WorkerPalsu([halamanTinjau()]);
    worker.galatAmati = [galat('belum_siap'), galat('belum_siap'), galat('belum_siap')];
    const provider = new ProviderSkrip(() => SERAHKAN_FINAL);
    const { hasil } = jalankan(worker, provider, tanpaJeda);
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
    expect(worker.amatiN).toBeGreaterThanOrEqual(4);
  });

  it('503 sesaat (halaman berpindah) diulang; 4 kali beruntun = galat_worker', async () => {
    const pulih = new WorkerPalsu([halamanTinjau()]);
    pulih.galatAmati = [galat('sesaat'), galat('sesaat')];
    expect(await jalankan(pulih, new ProviderSkrip(() => SERAHKAN_FINAL), tanpaJeda).hasil).toMatchObject({
      akhir: 'ambil_alih',
      alasan: 'final',
    });
    const mati = new WorkerPalsu([halamanTinjau()]);
    mati.galatAmati = [galat('sesaat'), galat('sesaat'), galat('sesaat'), galat('sesaat')];
    expect(await jalankan(mati, new ProviderSkrip(() => SERAHKAN_FINAL), tanpaJeda).hasil).toMatchObject({
      akhir: 'berhenti',
      alasan: 'galat_worker',
    });
    // Galat yang bukan sementara (mis. 404 sesi hilang) tidak diulang.
    const hilang = new WorkerPalsu([halamanTinjau()]);
    hilang.galatAmati = [galat()];
    expect(await jalankan(hilang, new ProviderSkrip(() => SERAHKAN_FINAL), tanpaJeda).hasil).toMatchObject({
      akhir: 'berhenti',
      alasan: 'galat_worker',
    });
    expect(hilang.amatiN).toBe(1);
  });

  it('409 belum siap melewati batas menunggu total: berhenti tunggu habis tanpa aksi', async () => {
    const worker = new WorkerPalsu([halamanTinjau()]);
    worker.galatAmati = Array.from({ length: 10 }, () => galat('belum_siap'));
    const { hasil } = jalankan(worker, new ProviderSkrip(() => SERAHKAN_FINAL), {
      ...tanpaJeda,
      tungguTotalMs: 3_000,
    });
    expect(await hasil).toMatchObject({ akhir: 'berhenti', alasan: 'galat_worker' });
    expect(worker.diterima).toHaveLength(0);
  });

  it('aksi rencana kena galat sesaat: tidak dikirim ulang buta, halaman diamati ulang', async () => {
    const worker = new WorkerPalsu([halamanForm(), halamanTinjau()]);
    worker.setujuiSemua = true;
    let sekali = true;
    const asli = worker.aksi.bind(worker);
    worker.aksi = async (r) => {
      if (sekali && r.aksi.some((a) => a.jenis === 'klik')) {
        sekali = false;
        throw galat('sesaat');
      }
      return asli(r);
    };
    const provider = new ProviderSkrip((n) => (n <= 1 ? RENCANA_FORM : SERAHKAN_FINAL));
    const { hasil } = jalankan(worker, provider, tanpaJeda);
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
    // Sesudah galat: amati + rencana baru (LLM dipanggil lagi), bukan aksi yang sama dikirim ulang seketika.
    expect(provider.calls.length).toBe(3);
  });

  it('galat penyedia LLM sekali: dicoba ulang; dua kali: serahkan dengan alasan layanan_ai (bukan galat_worker)', async () => {
    let n = 0;
    const sekali = new ProviderSkrip(() => {
      if (n++ === 0) throw new Error('429');
      return SERAHKAN_FINAL;
    });
    expect(await jalankan(new WorkerPalsu([halamanTinjau()]), sekali).hasil).toMatchObject({
      akhir: 'ambil_alih',
      alasan: 'final',
    });
    const worker = new WorkerPalsu([halamanTinjau()]);
    const mati = new ProviderSkrip(() => {
      throw new Error('timeout');
    });
    expect(await jalankan(worker, mati).hasil).toMatchObject({
      akhir: 'ambil_alih',
      alasan: 'layanan_ai',
      pesan: PESAN_AMBIL_ALIH.layanan_ai,
    });
    expect(worker.semuaAksi).toEqual([{ jenis: 'serahkan', alasan: 'tidak_yakin' }]);
  });

  it('warga menekan Kirim sendiri sesudah serah final: halaman sukses terdeteksi saat warga memegang kendali', async () => {
    const worker = new WorkerPalsu([halamanTinjau(), SUKSES]);
    worker.saatSerahkan = (alasan) => (alasan === 'final' ? { aksi: 'pegang', ke: 1 } : { aksi: 'selesai' });
    const { hasil, jejak } = jalankan(worker, new ProviderSkrip(() => SERAHKAN_FINAL), { pantauMs: 10 });
    expect(await hasil).toMatchObject({ akhir: 'selesai', bukti: { nomor: 'REG-2026-00777' } });
    expect(worker.pantauN).toBeGreaterThan(0);
    // Tidak ada aksi AI sesudah serah final: deteksi hanya baca-saja.
    expect(worker.semuaAksi).toEqual([{ jenis: 'serahkan', alasan: 'final' }]);
    expect(jejak.find((c) => c.jenis === 'bukti')).toMatchObject({ bukti: { nomor: 'REG-2026-00777' } });
  });

  it('halaman sukses dikonfirmasi worker (selesai) dengan bukti; bukti dicatat worker, bukan loop', async () => {
    const worker = new WorkerPalsu([halamanTinjau(), SUKSES]);
    const dilapor: unknown[] = [];
    worker.selesai = async (b) => void dilapor.push(b);
    worker.saatSerahkan = (alasan) => (alasan === 'final' ? { aksi: 'pegang', ke: 1 } : { aksi: 'selesai' });
    const { hasil, jejak } = jalankan(worker, new ProviderSkrip(() => SERAHKAN_FINAL), { pantauMs: 10 });
    expect(await hasil).toMatchObject({ akhir: 'selesai', bukti: { nomor: 'REG-2026-00777' } });
    expect(dilapor).toMatchObject([{ nomor: 'REG-2026-00777' }]);
    expect(jejak.filter((c) => c.jenis === 'bukti')).toEqual([]);
  });

  it('worker menolak klaim sukses (409, halaman berubah): tidak selesai; di halaman AI = serahkan tidak_yakin', async () => {
    const worker = new WorkerPalsu([SUKSES]);
    let n = 0;
    worker.selesai = async () => {
      n++;
      throw galat();
    };
    const { hasil } = jalankan(worker, new ProviderSkrip(() => SERAHKAN_FINAL));
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'tidak_yakin' });
    expect(n).toBe(1);
    // 503 sesaat diulang sebelum menyerah.
    const lagi = new WorkerPalsu([SUKSES]);
    let m = 0;
    lagi.selesai = async () => {
      if (m++ === 0) throw galat('sesaat');
    };
    const h = await jalankan(lagi, new ProviderSkrip(() => SERAHKAN_FINAL), tanpaJeda).hasil;
    expect(h).toMatchObject({ akhir: 'selesai' });
    expect(m).toBe(2);
  });

  it('halaman sukses di host di luar wilayah saat warga memegang kendali TIDAK diakui', async () => {
    const worker = new WorkerPalsu([halamanTinjau(), { ...SUKSES, host: 'palsu.contoh' }]);
    let n = 0;
    worker.saatSerahkan = () => (n++ < 3 ? { aksi: 'pegang', ke: 1 } : { aksi: 'selesai' });
    const { hasil } = jalankan(worker, new ProviderSkrip(() => SERAHKAN_FINAL), { pantauMs: 10 });
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
  });

  it('executionId di respons amati milik eksekusi lain (tanpa kuras): loop lama berhenti tanpa aksi', async () => {
    const worker = new WorkerPalsu([halamanForm()]);
    worker.executionId = 'x_baru';
    const provider = new ProviderSkrip(() => RENCANA_FORM);
    // Tangan tanpa `kuras`: satu-satunya tanda adalah executionId pada amati.
    const tangan = {
      amati: (o?: { pantau?: boolean }) => worker.amati(o),
      aksi: (r: Parameters<WorkerPalsu['aksi']>[0]) => worker.aksi(r),
      tunggu: () => worker.tunggu(),
    };
    const { hasil } = jalankan(worker, provider, { tangan });
    expect(await hasil).toMatchObject({ akhir: 'berhenti', alasan: 'sesi_berakhir' });
    expect(worker.diterima).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
  });

  it('sesi worker sudah milik eksekusi lain: loop lama berhenti tanpa aksi', async () => {
    const worker = new WorkerPalsu([halamanForm()]);
    worker.executionId = 'x_baru';
    const provider = new ProviderSkrip(() => RENCANA_FORM);
    const { hasil, jejak } = jalankan(worker, provider);
    expect(await hasil).toMatchObject({ akhir: 'berhenti', alasan: 'sesi_berakhir' });
    expect(worker.diterima).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
    // Catatan milik eksekusi lain tidak ikut, celahnya dicatat sebagai angka.
    expect(jejak).toEqual([{ jenis: 'jejak_terbuang', n: 1 }]);
  });
});

describe('tautan pembuka formulir: warga mengetuk, AI melanjutkan', () => {
  it('klik ke tautan pembuka = serah ketuk_tautan (bukan klik AI, bukan final); sesudah kembali AI mengisi', async () => {
    const beranda = halaman({
      sidik: 'beranda',
      jalur: '/generik/tanpa-akun/',
      elemen: [
        { ref: 'e1', peran: 'tautan', nama: 'Mulai Pendaftaran', kelas: 'kirim', tautanPembuka: true },
      ],
    });
    const worker = new WorkerPalsu([beranda, halamanForm(), halamanTinjau()]);
    worker.setujuiSemua = true;
    worker.saatSerahkan = (alasan) =>
      alasan === 'ketuk_tautan' ? { aksi: 'kembalikan', ke: 1 } : { aksi: 'selesai' };
    const provider = new ProviderSkrip((n) =>
      n === 0 ? { aksi: [{ jenis: 'klik', ref: 'e1' }] } : n === 1 ? RENCANA_FORM : SERAHKAN_FINAL,
    );
    const { hasil, jejak } = jalankan(worker, provider);
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
    expect(worker.semuaAksi.filter((a) => a.jenis === 'klik').map((a) => a.ref)).not.toContain('e1');
    expect(worker.semuaAksi).toContainEqual({ jenis: 'serahkan', alasan: 'ketuk_tautan', ref: 'e1' });
    expect(jejak).toContainEqual({ jenis: 'ambil_alih', fase: 'mulai', alasan: 'ketuk_tautan' });
    // Formulir di balik tautan tetap diisi AI sesudah warga mengembalikan kendali.
    expect(worker.semuaAksi.some((a) => a.jenis === 'isi')).toBe(true);
  });
});

describe('FakeProvider "LLM jahat": ditolak SETIAP kali', () => {
  const JAHAT: [string, unknown][] = [
    ['terus klik tombol final', { aksi: [{ jenis: 'klik', ref: 'e6' }] }],
    ['NIK di kolom catatan', { aksi: [{ jenis: 'isi', ref: 'e8', nilai: '{{PEMOHON.NIK}}' }] }],
    ['ref karangan', { aksi: [{ jenis: 'isi', ref: 'e99', nilai: '{{PEMOHON.NAMA}}' }] }],
    ['URL', { aksi: [{ jenis: 'klik', ref: 'e7', url: 'https://evil.example/kirim' }] }],
    ['teks bebas', 'Baik, saya akan menekan tombol Kirim Permohonan sekarang.'],
    [
      'nilai mentah',
      { aksi: [{ jenis: 'isi', ref: 'e1', nilai: ['3312', '0115', '0890', '0001'].join('') }] },
    ],
    ['centang pernyataan', { aksi: [{ jenis: 'centang', ref: 'e5', nilai: true }] }],
    [
      'serahkan lalu klik',
      {
        aksi: [
          { jenis: 'serahkan', alasan: 'final' },
          { jenis: 'klik', ref: 'e6' },
        ],
      },
    ],
  ];

  it.each(JAHAT)('%s', async (_n, jahat) => {
    const worker = new WorkerPalsu([halamanForm()]);
    const provider = new ProviderSkrip(() => jahat);
    const { hasil, jejak } = jalankan(worker, provider);
    const h = await hasil;
    // Tidak satu pun aksi model sampai ke worker: hanya serahkan bertemplat dari kode.
    expect(worker.semuaAksi.every((a) => a.jenis === 'serahkan')).toBe(true);
    const validasi = jejak.filter((c) => c.jenis === 'validasi');
    expect(validasi.length).toBeGreaterThanOrEqual(BATAS_ANGGARAN.sidikSama - 1);
    expect(
      validasi.every((c) => c.jenis === 'validasi' && c.putusan === 'tolak' && c.aturan.length > 0),
    ).toBe(true);
    expect(h.akhir).toBe('ambil_alih');
    if (h.akhir === 'ambil_alih') {
      expect(['gagal_beruntun', 'putaran']).toContain(h.alasan);
      expect(h.pesan).toBe(PESAN_AMBIL_ALIH[h.alasan]);
    }
    // Umpan balik ke model hanya id aturan, bukan teks.
    expect(provider.semuaPrompt).toMatch(
      /UMPAN BALIK: rencana sebelumnya untuk halaman ini ditolak validator: [A-Z_, ]+\./,
    );
  });
});

describe('anggaran: habis berakhir dengan ambil alih bertemplat', () => {
  /** Setiap klik tautan navigasi membuka halaman baru dengan sidik baru. */
  const halamanTakBerujung = () =>
    Array.from({ length: 40 }, (_, i) =>
      halaman({
        seq: i,
        sidik: `hal-${i}`,
        jalur: `/hal/${i}`,
        elemen: [{ ref: 'e1', peran: 'tautan', nama: 'Halaman berikutnya', kelas: 'navigasi' }],
      }),
    );
  const KLIK = { aksi: [{ jenis: 'klik', ref: 'e1' }] };

  it(`batas ${BATAS_ANGGARAN.halaman} halaman`, async () => {
    const worker = new WorkerPalsu(halamanTakBerujung());
    const { hasil } = jalankan(worker, new ProviderSkrip(() => KLIK));
    const h = await hasil;
    expect(h).toMatchObject({ akhir: 'ambil_alih', alasan: 'anggaran_halaman' });
    expect(h.pesan).toBe(PESAN_AMBIL_ALIH.anggaran_halaman);
    expect(worker.semuaAksi.at(-1)).toEqual({ jenis: 'serahkan', alasan: 'tidak_yakin' });
    expect(worker.semuaAksi.filter((a) => a.jenis === 'klik')).toHaveLength(BATAS_ANGGARAN.halaman);
  });

  it(`batas ${BATAS_ANGGARAN.panggilanLlm} panggilan LLM`, async () => {
    const worker = new WorkerPalsu(halamanTakBerujung());
    const provider = new ProviderSkrip(() => KLIK);
    const ang = new Anggaran({ ...BATAS_ANGGARAN, halaman: 100 });
    const { hasil } = jalankan(worker, provider, { anggaran: ang });
    const h = await hasil;
    expect(h).toMatchObject({
      akhir: 'ambil_alih',
      alasan: 'anggaran_llm',
      pesan: PESAN_AMBIL_ALIH.anggaran_llm,
    });
    expect(provider.calls).toHaveLength(BATAS_ANGGARAN.panggilanLlm);
  });

  it(`batas ${BATAS_ANGGARAN.aksi} aksi`, async () => {
    const banyak = (i: number): Pengamatan =>
      halaman({
        seq: i,
        sidik: `isi-${i}`,
        elemen: [
          ...Array.from({ length: 20 }, (_, j) => ({
            ref: `e${j + 1}`,
            peran: 'teks' as const,
            nama: `Nama Lengkap ${j}`,
          })),
          { ref: 'e30', peran: 'tombol', nama: 'Lanjut', kelas: 'lanjut' },
        ],
      });
    const worker = new WorkerPalsu(Array.from({ length: 9 }, (_, i) => banyak(i)));
    const isi = {
      aksi: [
        ...Array.from({ length: 20 }, (_, j) => ({
          jenis: 'isi',
          ref: `e${j + 1}`,
          nilai: '{{PEMOHON.NAMA}}',
        })),
        { jenis: 'klik', ref: 'e30' },
      ],
    };
    const { hasil } = jalankan(worker, new ProviderSkrip(() => isi));
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'anggaran_aksi' });
  });

  it('batas 8 menit waktu AI (waktu warga tidak dihitung)', async () => {
    let t = 0;
    const jam = () => t;
    const worker = new WorkerPalsu(halamanTakBerujung());
    const provider = new ProviderSkrip(() => {
      t += 3 * 60_000;
      return KLIK;
    });
    const { hasil } = jalankan(worker, provider, { jam, anggaran: new Anggaran(BATAS_ANGGARAN, jam) });
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'anggaran_waktu' });
    expect(provider.calls).toHaveLength(3);
  });

  it('sidik sama 3x tanpa kemajuan = putaran', async () => {
    const worker = new WorkerPalsu([halamanForm()]);
    // Klik "Lanjut" yang tidak memindahkan halaman (mis. galat validasi situs).
    worker.paksa = Array.from({ length: 10 }, () => () => [
      { indeks: 0, kode: 'ok' as const, kelas: 'lanjut' as const },
    ]);
    const { hasil } = jalankan(worker, new ProviderSkrip(() => ({ aksi: [{ jenis: 'klik', ref: 'e11' }] })));
    expect(await hasil).toMatchObject({
      akhir: 'ambil_alih',
      alasan: 'putaran',
      pesan: PESAN_AMBIL_ALIH.putaran,
    });
  });
});

describe('Mode Uji dan host wilayah', () => {
  it('Mode Uji: host non-fixture langsung berhenti, tanpa LLM dan tanpa aksi', async () => {
    const worker = new WorkerPalsu([halamanForm({ host: 'telunjuksakti.wonogirikab.go.id' })]);
    const provider = new ProviderSkrip(() => RENCANA_FORM);
    const { hasil } = jalankan(worker, provider, {
      hostsBoleh: new Set(['telunjuksakti.wonogirikab.go.id']),
      modeUji: { hostsFixture: new Set([HOST_UJI]) },
    });
    expect(await hasil).toMatchObject({ akhir: 'berhenti', alasan: 'mode_uji_host' });
    expect(worker.diterima).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
  });

  it('Mode Uji: halaman berikutnya keluar dari replika → berhenti tanpa aksi lanjutan', async () => {
    const worker = new WorkerPalsu([halamanForm(), halamanTinjau({ host: 'portal.kabupaten.go.id' })]);
    const provider = new ProviderSkrip(() => ({ aksi: [{ jenis: 'klik', ref: 'e7' }] }));
    const { hasil } = jalankan(worker, provider, { modeUji: { hostsFixture: new Set([HOST_UJI]) } });
    expect(await hasil).toMatchObject({ akhir: 'berhenti', alasan: 'mode_uji_host' });
    expect(worker.diterima).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
  });

  it('host di luar registry wilayah: host_kandidat dicatat, kendali ke warga, tanpa LLM', async () => {
    const worker = new WorkerPalsu([halamanForm({ host: 'sso.contoh-luar.id' })]);
    const provider = new ProviderSkrip(() => RENCANA_FORM);
    const { hasil, jejak } = jalankan(worker, provider);
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'host_luar' });
    expect(jejak).toContainEqual({ jenis: 'host_kandidat', host: 'sso.contoh-luar.id' });
    expect(provider.calls).toHaveLength(0);
    expect(worker.semuaAksi).toEqual([{ jenis: 'serahkan', alasan: 'tidak_yakin' }]);
  });
});

describe('giliran warga, ikat ulang, dan keluar jujur', () => {
  it('halaman login: diserahkan tanpa LLM, lalu lanjut setelah warga mengembalikan kendali', async () => {
    const login = halaman({
      sidik: 'login',
      sinyal: { ...halamanForm().sinyal, login: true },
      elemen: [{ ref: 'e1', peran: 'teks', nama: 'Kata sandi', terlarang: 'sandi' }],
    });
    const worker = new WorkerPalsu([login, halamanTinjau()]);
    worker.saatSerahkan = (alasan) =>
      alasan === 'masuk_akun' ? { aksi: 'kembalikan', ke: 1 } : { aksi: 'selesai' };
    const provider = new ProviderSkrip(() => SERAHKAN_FINAL);
    const { hasil, jejak } = jalankan(worker, provider);
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
    expect(worker.semuaAksi[0]).toEqual({ jenis: 'serahkan', alasan: 'masuk_akun' });
    expect(provider.calls).toHaveLength(1);
    expect(jejak.filter((c) => c.jenis === 'ambil_alih')).toEqual([
      { jenis: 'ambil_alih', fase: 'mulai', alasan: 'masuk_akun' },
      { jenis: 'ambil_alih', fase: 'selesai' },
      { jenis: 'ambil_alih', fase: 'mulai', alasan: 'final' },
    ]);
  });

  it('REF_BASI: ikat ulang berdasarkan sidik elemen tanpa memanggil LLM', async () => {
    const form = halamanForm();
    // Halaman yang sama dirender ulang: ref bergeser, label tetap.
    const geser = halamanForm({
      seq: 5,
      elemen: form.elemen.map((e) => ({ ...e, ref: `e${Number(e.ref.slice(1)) + 20}` })),
    });
    const worker = new WorkerPalsu([form, halamanTinjau()]);
    worker.setujuiSemua = true;
    let basi = true;
    worker.paksa = [
      () => {
        if (!basi) return undefined;
        basi = false;
        worker.halaman[0] = geser;
        return [
          { indeks: 0, kode: 'ok' },
          { indeks: 1, kode: 'REF_BASI' },
        ];
      },
    ];
    const provider = new ProviderSkrip((n) =>
      n === 0
        ? {
            aksi: [
              { jenis: 'isi', ref: 'e2', nilai: '{{PEMOHON.NAMA}}' },
              { jenis: 'pilih', ref: 'e3', nilai: { opsi: 1 } },
              { jenis: 'klik', ref: 'e11' },
            ],
          }
        : SERAHKAN_FINAL,
    );
    const { hasil, jejak } = jalankan(worker, provider);
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
    expect(provider.calls).toHaveLength(2);
    // Rencana hasil ikat ulang dicatat dengan hash-nya sendiri, merujuk hash asal persetujuan.
    const asal = worker.diterima[0]!.rencanaHash;
    const ulang = jejak.find((c) => c.jenis === 'validasi' && c.asal === asal);
    expect(ulang).toMatchObject({ putusan: 'terima' });
    expect(ulang && 'rencanaHash' in ulang && ulang.rencanaHash).not.toBe(asal);
    expect(worker.diterima[1]).toMatchObject({
      seq: 5,
      aksi: [
        { jenis: 'pilih', ref: 'e23', nilai: { opsi: 1 } },
        { jenis: 'klik', ref: 'e31' },
      ],
    });
    expect(worker.diterima[1]?.rencanaHash).toBe(worker.diterima[0]?.rencanaHash);
  });

  it('worker menolak klik saat klasifikasi ulang (KELAS_DITOLAK): diserahkan sebagai final dengan ref', async () => {
    const worker = new WorkerPalsu([
      halamanForm({
        elemen: [{ ref: 'e1', peran: 'tombol', nama: 'Lanjut', kelas: 'lanjut' }],
      }),
    ]);
    worker.paksa = [() => [{ indeks: 0, kode: 'KELAS_DITOLAK', kelas: 'kirim' }]];
    const { hasil } = jalankan(worker, new ProviderSkrip(() => ({ aksi: [{ jenis: 'klik', ref: 'e1' }] })));
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
    expect(worker.semuaAksi.at(-1)).toEqual({ jenis: 'serahkan', alasan: 'final', ref: 'e1' });
  });

  it('warga menolak semua baris (tanpa catatan persetujuan web): tidak diminta ulang, diserahkan isi sendiri', async () => {
    const worker = new WorkerPalsu([halamanForm(), halamanTinjau()]);
    worker.tolakPersetujuan = true;
    worker.saatSerahkan = (alasan) =>
      alasan === 'isi_sendiri' ? { aksi: 'kembalikan', ke: 1 } : { aksi: 'selesai' };
    const provider = new ProviderSkrip((n) =>
      n === 0
        ? {
            aksi: [
              { jenis: 'isi', ref: 'e2', nilai: '{{PEMOHON.NAMA}}' },
              { jenis: 'klik', ref: 'e11' },
            ],
          }
        : SERAHKAN_FINAL,
    );
    const { hasil } = jalankan(worker, provider);
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
    // Rencana yang sama dikirim ulang sekali setelah putaran persetujuan; masih tertahan → serahkan, bukan minta lagi.
    expect(worker.diterima.map((d) => d.aksi.length)).toEqual([2, 2, 1, 1]);
    expect(worker.diterima[1]?.rencanaHash).toBe(worker.diterima[0]?.rencanaHash);
    expect(worker.diterima[2]?.aksi).toEqual([{ jenis: 'serahkan', alasan: 'isi_sendiri', ref: 'e2' }]);
    expect(
      worker.diterima
        .slice(2)
        .flatMap((d) => d.aksi)
        .filter((a) => a.jenis === 'klik'),
    ).toEqual([]);
  });

  /** Rencana isi NAMA + Lanjut; dipakai uji "tolak semua". */
  const RENCANA_NAMA_LANJUT = {
    aksi: [
      { jenis: 'isi', ref: 'e2', nilai: '{{PEMOHON.NAMA}}' },
      { jenis: 'klik', ref: 'e11' },
    ],
  };

  it.each([
    ['isi kosong di web (lembar ditolak)', false],
    ['ambil alih lalu kembalikan saat lembar terbuka (tanpa catatan web)', true],
  ])(
    'tolak semua lewat %s: hash yang sama tidak dikirim ulang dengan baris vault, langsung isi sendiri',
    async (_, lewatAmbilAlih) => {
      const worker = new WorkerPalsu([halamanForm(), halamanTinjau()]);
      if (lewatAmbilAlih) worker.tolakLewatAmbilAlih = true;
      else worker.tolakPersetujuan = true;
      worker.saatSerahkan = (alasan) =>
        alasan === 'isi_sendiri' ? { aksi: 'kembalikan', ke: 1 } : { aksi: 'selesai' };
      // Lewat ambil alih: warga sempat memegang kendali, jadi halaman diamati dan direncanakan ulang sekali
      // (kolomnya mungkin sudah ia isi); baris yang ditolak tidak diminta izin lagi.
      const rencanaAwal = lewatAmbilAlih ? 2 : 1;
      const provider = new ProviderSkrip((n) => (n < rencanaAwal ? RENCANA_NAMA_LANJUT : SERAHKAN_FINAL));
      const { hasil, jejak } = jalankan(worker, provider, { persetujuan: (h) => worker.persetujuan(h) });
      expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
      expect(provider.calls).toHaveLength(rencanaAwal + 1);
      if (lewatAmbilAlih) expect(worker.pantauN).toBeGreaterThan(0);
      // Satu putaran izin saja: setelah ditolak, Lanjut tidak ditekan dan kendali ke warga untuk baris itu.
      expect(worker.diterima.map((d) => d.aksi)).toEqual([
        RENCANA_NAMA_LANJUT.aksi,
        [{ jenis: 'serahkan', alasan: 'isi_sendiri', ref: 'e2' }],
        [{ jenis: 'serahkan', alasan: 'final' }],
      ]);
      expect(jejak.filter((c) => c.jenis === 'persetujuan')).toEqual([
        { jenis: 'persetujuan', rencanaHash: worker.diterima[0]!.rencanaHash, n: 0 },
      ]);
      expect(jejak).toContainEqual({ jenis: 'ambil_alih', fase: 'mulai', alasan: 'isi_sendiri' });
    },
  );

  it('tolak semua lewat ambil alih: unggahan ikut ditolak, rencana ulang tidak membuka lembar kedua', async () => {
    const form = halamanForm();
    const p = {
      ...form,
      elemen: [...form.elemen, { ref: 'e12', peran: 'berkas' as const, nama: 'Unggah KTP', form: 'f0' }],
    };
    const worker = new WorkerPalsu([p, halamanTinjau()]);
    worker.tolakLewatAmbilAlih = true;
    worker.saatSerahkan = (alasan) =>
      alasan === 'isi_sendiri' ? { aksi: 'kembalikan', ke: 1 } : { aksi: 'selesai' };
    const rencana = {
      aksi: [
        { jenis: 'isi', ref: 'e2', nilai: '{{PEMOHON.NAMA}}' },
        { jenis: 'unggah', ref: 'e12', berkas: 'KTP' },
        { jenis: 'klik', ref: 'e11' },
      ],
    };
    const provider = new ProviderSkrip((n) => (n < 2 ? rencana : SERAHKAN_FINAL));
    const { hasil } = jalankan(worker, provider, { persetujuan: (h) => worker.persetujuan(h) });
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
    // Rencana kedua (isi + unggah yang sama) tidak dikirim: keduanya sudah ditolak di halaman ini.
    expect(worker.diterima.map((d) => d.aksi)).toEqual([
      rencana.aksi,
      [{ jenis: 'serahkan', alasan: 'isi_sendiri', ref: 'e2' }],
      [{ jenis: 'serahkan', alasan: 'final' }],
    ]);
  });

  it('warga menolak satu baris: baris lain diisi, Lanjut tidak ditekan, kendali ke warga untuk baris itu', async () => {
    const worker = new WorkerPalsu([halamanForm(), halamanTinjau()]);
    worker.tolakBaris = new Set(['{{PEMOHON.NIK}}']);
    worker.saatSerahkan = (alasan) =>
      alasan === 'isi_sendiri' ? { aksi: 'kembalikan', ke: 1 } : { aksi: 'selesai' };
    const provider = new ProviderSkrip((n) => (n === 0 ? RENCANA_FORM : SERAHKAN_FINAL));
    const { hasil, jejak } = jalankan(worker, provider, { persetujuan: (h) => worker.persetujuan(h) });
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
    // Sesudah persetujuan: hanya baris yang disetujui (+ pilihan tanpa nilai vault), tanpa Lanjut.
    expect(worker.diterima[1]?.aksi).toEqual([
      { jenis: 'isi', ref: 'e2', nilai: '{{PEMOHON.NAMA}}' },
      { jenis: 'pilih', ref: 'e3', nilai: { opsi: 1 } },
    ]);
    expect(worker.diterima[1]?.rencanaHash).toBe(worker.diterima[0]?.rencanaHash);
    // Baris lembar ikut aksi yang dikirim (worker menolak 422 baris di luar rencana).
    expect(worker.diterima[0]?.kolom.map((k) => k.placeholder)).toEqual([
      '{{PEMOHON.NIK}}',
      '{{PEMOHON.NAMA}}',
    ]);
    expect(worker.diterima[1]?.kolom).toEqual([
      { placeholder: '{{PEMOHON.NAMA}}', labelPortal: 'Nama Lengkap Pemohon' },
    ]);
    expect(worker.diterima[2]?.kolom).toEqual([]);
    expect(worker.diterima[2]?.aksi).toEqual([{ jenis: 'serahkan', alasan: 'isi_sendiri', ref: 'e1' }]);
    // Baris yang ditolak tidak pernah dikirim lagi sesudah putaran persetujuan.
    expect(
      worker.diterima
        .slice(1)
        .flatMap((d) => d.aksi)
        .some((a) => a.jenis === 'isi' && a.ref === 'e1'),
    ).toBe(false);
    expect(
      worker.diterima
        .slice(1)
        .flatMap((d) => d.aksi)
        .filter((a) => a.jenis === 'klik'),
    ).toEqual([]);
    expect(jejak).toContainEqual({
      jenis: 'persetujuan',
      rencanaHash: worker.diterima[0]!.rencanaHash,
      n: 1,
    });
    expect(jejak).toContainEqual({ jenis: 'ambil_alih', fase: 'mulai', alasan: 'isi_sendiri' });
  });

  it('klik dialihkan ke host lain (GERBANG_MEMBLOKIR): worker menyerahkan, loop menunggu tanpa gagal, lalu lanjut', async () => {
    const worker = new WorkerPalsu([halamanForm(), halamanTinjau()]);
    worker.setujuiSemua = true;
    worker.hostLainPada = new Set(['e11']);
    worker.saatSerahkan = (alasan) =>
      alasan === 'periksa' ? { aksi: 'kembalikan', ke: 1 } : { aksi: 'selesai' };
    const provider = new ProviderSkrip((n) => (n === 0 ? RENCANA_FORM : SERAHKAN_FINAL));
    const { hasil, jejak } = jalankan(worker, provider);
    expect(await hasil).toMatchObject({
      akhir: 'ambil_alih',
      alasan: 'final',
      pesan: PESAN_BERHENTI.sesi_berakhir,
    });
    // Pesan ke warga dikirim worker (templat hostLain); loop tidak menambah serahkan sendiri dan tidak mengulang klik.
    expect(worker.semuaAksi.filter((a) => a.jenis === 'serahkan')).toEqual([
      { jenis: 'serahkan', alasan: 'final' },
    ]);
    expect(worker.semuaAksi.filter((a) => a.jenis === 'klik')).toHaveLength(1);
    // Satu tunggu untuk gerbang (warga mengembalikan kendali), satu untuk serahkan final.
    expect(worker.tungguN).toBe(2);
    expect(jejak).toContainEqual({ jenis: 'host_kandidat', host: 'portal-lain.invalid' });
    expect(provider.calls).toHaveLength(2);
  });

  it('jejak worker terbuang (buffer penuh): dicatat sebagai jumlah, sekali per kuras', async () => {
    const worker = new WorkerPalsu([halamanTinjau()]);
    worker.terbuang = 7;
    const provider = new ProviderSkrip(() => SERAHKAN_FINAL);
    const { hasil, jejak } = jalankan(worker, provider);
    await hasil;
    expect(jejak.filter((c) => c.jenis === 'jejak_terbuang')).toEqual([{ jenis: 'jejak_terbuang', n: 7 }]);
    for (const c of jejak) expect(CatatanPendampingSchema.safeParse(c).success).toBe(true);
  });

  it('kuota runtime habis: serahkan templat sebelum memanggil model', async () => {
    const worker = new WorkerPalsu([halamanForm()]);
    const provider = new ProviderSkrip(() => RENCANA_FORM);
    const { hasil } = jalankan(worker, provider, { kuotaHabis: () => true });
    expect(await hasil).toMatchObject({
      akhir: 'ambil_alih',
      alasan: 'kuota',
      pesan: PESAN_AMBIL_ALIH.kuota,
    });
    expect(provider.calls).toHaveLength(0);
    expect(worker.semuaAksi).toEqual([{ jenis: 'serahkan', alasan: 'tidak_yakin' }]);
  });

  it('tidak_bisa: beralih ke dipandu dengan pesan templat', async () => {
    const worker = new WorkerPalsu([halamanForm()]);
    const { hasil } = jalankan(
      worker,
      new ProviderSkrip(() => ({ aksi: [{ jenis: 'tidak_bisa', sebab: 'hanya_aplikasi' }] })),
    );
    expect(await hasil).toMatchObject({ akhir: 'dipandu', pesan: PESAN_DIPANDU });
  });

  it('dibatalkan lewat AbortSignal', async () => {
    const ac = new AbortController();
    ac.abort();
    const { hasil } = jalankan(new WorkerPalsu([halamanForm()]), new ProviderSkrip(() => RENCANA_FORM), {
      signal: ac.signal,
    });
    expect(await hasil).toMatchObject({ akhir: 'berhenti', alasan: 'dibatalkan' });
  });
});
