import { CatatanPendampingSchema, type CatatanPendamping, type Pengamatan } from '@urusin/contracts';
import { describe, expect, it } from 'vitest';
import { Anggaran, BATAS_ANGGARAN, PESAN_AMBIL_ALIH } from './anggaran.js';
import { PESAN_DIPANDU, jalankanNavigator, type OpsiLoop } from './loop.js';
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

    expect(h).toMatchObject({ akhir: 'ambil_alih', alasan: 'final', pesan: PESAN_AMBIL_ALIH.final });
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
    expect(jejak.map((c) => c.jenis)).toEqual([
      'amati',
      'rencana',
      'validasi',
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
    const { hasil } = jalankan(worker, provider);
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
    expect(provider.calls).toHaveLength(2);
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

  it('warga menolak baris persetujuan: aksi itu dilewati, tidak diulang tanpa henti', async () => {
    const worker = new WorkerPalsu([halamanForm(), halamanTinjau()]);
    worker.tolakPersetujuan = true;
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
    // Kirim ulang setelah putaran persetujuan masih tertahan → baris itu dilewati, tidak diminta lagi.
    expect(worker.diterima.map((d) => d.aksi.length)).toEqual([2, 2, 1, 1]);
    expect(worker.diterima[2]?.aksi).toEqual([{ jenis: 'klik', ref: 'e11' }]);
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
