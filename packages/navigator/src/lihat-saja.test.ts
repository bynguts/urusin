import { PESAN_LIHAT_SAJA, type CatatanPendamping, type Pengamatan } from '@urusin/contracts';
import { describe, expect, it } from 'vitest';
import { PESAN_AMBIL_ALIH } from './anggaran.js';
import { jalankanNavigator, type OpsiLoop } from './loop.js';
import { pesanRencana } from './prompt.js';
import { HOST_UJI, ProviderSkrip, WorkerPalsu, halaman, halamanForm } from './testing.js';
import { halamanFormulir, klikLihatSaja, validasiRencana } from './validasi.js';

/**
 * Mode demo "lihat saja" (akun juri di situs resmi asli): AI hanya menavigasi. Ditegakkan deterministik di
 * validator (id aturan LIHAT_SAJA_*) dan loop (berhenti di halaman masuk/formulir tanpa LLM), bukan di prompt saja.
 */

/** Beranda portal: menu, tab, tautan pembuka GET, tombol Lanjut, tombol Kirim, satu kotak cari. */
const beranda = (over: Partial<Pengamatan> = {}): Pengamatan =>
  halaman({
    jalur: '/',
    judul: 'Beranda Layanan Kependudukan',
    sidik: 'sidik-beranda',
    elemen: [
      { ref: 'e1', peran: 'tautan', nama: 'Layanan Akta Kelahiran', kelas: 'navigasi' },
      { ref: 'e2', peran: 'tombol', nama: 'Menu', kelas: 'ui_lokal' },
      { ref: 'e3', peran: 'tab', nama: 'Persyaratan', kelas: 'ui_lokal' },
      { ref: 'e4', peran: 'tautan', nama: 'Mulai Pendaftaran', kelas: 'kirim', tautanPembuka: true },
      { ref: 'e5', peran: 'tombol', nama: 'Lanjut', kelas: 'lanjut' },
      { ref: 'e6', peran: 'tombol', nama: 'Kirim', kelas: 'kirim' },
      { ref: 'e7', peran: 'teks', nama: 'Cari layanan' },
    ],
    ...over,
  });

const rencana = (...aksi: unknown[]) => ({ aksi });
const LIHAT = { lihatSaja: true } as const;

describe('validator lihat saja: tulisan dan langkah menyimpan ditolak, navigasi murni lolos', () => {
  it.each([
    ['isi', rencana({ jenis: 'isi', ref: 'e7', nilai: '{{PEMOHON.NAMA}}' })],
    ['pilih', rencana({ jenis: 'pilih', ref: 'e3', nilai: { opsi: 1 } })],
    ['centang', rencana({ jenis: 'centang', ref: 'e5', nilai: true })],
    ['unggah', rencana({ jenis: 'unggah', ref: 'e1', berkas: 'KTP' })],
  ])('%s -> LIHAT_SAJA_TULIS', (_n, r) => {
    const p = _n === 'isi' ? beranda() : halamanForm();
    const v = validasiRencana(r, p, LIHAT);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.aturan).toContain('LIHAT_SAJA_TULIS');
  });

  it('klik kelas lanjut dan kirim -> LIHAT_SAJA_KLIK (lanjut tetap boleh untuk akun biasa)', () => {
    for (const ref of ['e5', 'e6']) {
      const v = validasiRencana(rencana({ jenis: 'klik', ref }), beranda(), LIHAT);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.aturan).toContain('LIHAT_SAJA_KLIK');
    }
    expect(validasiRencana(rencana({ jenis: 'klik', ref: 'e5' }), beranda()).ok).toBe(true);
  });

  it('klik navigasi, ui_lokal (menu/tab), dan tautan pembuka GET lolos', () => {
    for (const ref of ['e1', 'e2', 'e3', 'e4'])
      expect(validasiRencana(rencana({ jenis: 'klik', ref }), beranda(), LIHAT).ok, ref).toBe(true);
  });

  it('halaman akhir: tidak ada klik sama sekali', () => {
    const p = beranda({ sinyal: { ...beranda().sinyal, halamanAkhir: true } });
    expect(klikLihatSaja(p.elemen[0], p)).toBe(false);
    const v = validasiRencana(rencana({ jenis: 'klik', ref: 'e1' }), p, LIHAT);
    expect(v.ok).toBe(false);
  });

  it('akun warga biasa (tanpa opsi): rencana isi + Lanjut tetap sah seperti sebelumnya', () => {
    const v = validasiRencana(
      rencana(
        { jenis: 'isi', ref: 'e1', nilai: '{{PEMOHON.NIK}}' },
        { jenis: 'isi', ref: 'e2', nilai: '{{PEMOHON.NAMA}}' },
        { jenis: 'klik', ref: 'e11' },
      ),
      halamanForm(),
    );
    expect(v.ok).toBe(true);
  });

  it('halamanFormulir: formulir/masuk = ya; beranda dengan satu kotak cari = tidak', () => {
    expect(halamanFormulir(halamanForm())).toBe(true);
    expect(halamanFormulir(beranda())).toBe(false);
    expect(halamanFormulir(beranda({ sinyal: { ...beranda().sinyal, login: true } }))).toBe(true);
  });
});

const CAPS = { json_schema_strict: true, tools: false };
function jalankan(worker: WorkerPalsu, provider: ProviderSkrip, over: Partial<OpsiLoop> = {}) {
  const jejak: CatatanPendamping[] = [];
  const hasil = jalankanNavigator({
    executionId: 'x_demo',
    tangan: worker,
    llm: { provider, model: 'fake-model', caps: CAPS },
    tujuan: 'Kelahiran',
    hostsBoleh: new Set([HOST_UJI]),
    jejak: (c) => jejak.push(c),
    lihatSaja: true,
    ...over,
  });
  return { hasil, jejak };
}

describe('loop lihat saja', () => {
  it('menavigasi lewat menu lalu berhenti di formulir tanpa LLM: tidak ada isian, tidak ada Lanjut', async () => {
    const worker = new WorkerPalsu([beranda(), halamanForm({ seq: 2, sidik: 'sidik-form-2' })]);
    const provider = new ProviderSkrip(() => rencana({ jenis: 'klik', ref: 'e1' }));
    const h = await jalankan(worker, provider).hasil;
    expect(h).toMatchObject({ akhir: 'ambil_alih', alasan: 'lihat_saja', pesan: PESAN_LIHAT_SAJA });
    expect(PESAN_AMBIL_ALIH.lihat_saja).toBe(PESAN_LIHAT_SAJA);
    // Satu panggilan LLM (beranda); formulir tidak pernah ditanyakan ke model.
    expect(provider.calls).toHaveLength(1);
    const aksi = worker.diterima.flatMap((d) => d.aksi);
    expect(aksi).toEqual([
      { jenis: 'klik', ref: 'e1' },
      { jenis: 'serahkan', alasan: 'berhenti' },
    ]);
    // Tidak pernah ada lembar izin isi.
    expect(worker.diterima.every((d) => d.kolom.length === 0)).toBe(true);
  });

  it('model ingin mengisi atau menekan Lanjut = berhenti jujur, tidak dicoba ulang', async () => {
    for (const r of [
      rencana({ jenis: 'isi', ref: 'e7', nilai: '{{PEMOHON.NAMA}}' }),
      rencana({ jenis: 'klik', ref: 'e5' }),
    ]) {
      const worker = new WorkerPalsu([beranda()]);
      const provider = new ProviderSkrip(() => r);
      const h = await jalankan(worker, provider).hasil;
      expect(h).toMatchObject({ akhir: 'ambil_alih', alasan: 'lihat_saja' });
      expect(provider.calls).toHaveLength(1);
      expect(worker.diterima.flatMap((d) => d.aksi)).toEqual([{ jenis: 'serahkan', alasan: 'berhenti' }]);
    }
  });

  it('halaman masuk akun = berhenti lihat saja (bukan giliran masuk lalu AI lanjut)', async () => {
    const masuk = halaman({
      jalur: '/login',
      sidik: 'sidik-login',
      sinyal: { ...beranda().sinyal, login: true },
      elemen: [
        { ref: 'e1', peran: 'teks', nama: 'Username' },
        { ref: 'e2', peran: 'teks', nama: 'Password', terlarang: 'sandi' },
        { ref: 'e3', peran: 'tombol', nama: 'Masuk', kelas: 'masuk' },
      ],
    });
    const worker = new WorkerPalsu([masuk]);
    const provider = new ProviderSkrip(() => rencana({ jenis: 'serahkan', alasan: 'masuk_akun' }));
    const h = await jalankan(worker, provider).hasil;
    expect(h).toMatchObject({ akhir: 'ambil_alih', alasan: 'lihat_saja' });
    expect(provider.calls).toHaveLength(0);
  });

  it('worker menolak klik (KELAS_DITOLAK) = berhenti lihat saja, bukan giliran Kirim', async () => {
    const worker = new WorkerPalsu([beranda()]);
    worker.paksa = [(aksi) => aksi.map((_, indeks) => ({ indeks, kode: 'KELAS_DITOLAK' as const }))];
    const h = await jalankan(worker, new ProviderSkrip(() => rencana({ jenis: 'klik', ref: 'e1' }))).hasil;
    expect(h).toMatchObject({ akhir: 'ambil_alih', alasan: 'lihat_saja' });
  });

  it('prompt menyertakan aturan lihat saja hanya bila diminta', () => {
    const p = beranda();
    expect(pesanRencana({ pengamatan: p, tujuan: 'Kelahiran', lihatSaja: true })[0]!.content).toContain(
      'MODE LIHAT SAJA',
    );
    expect(pesanRencana({ pengamatan: p, tujuan: 'Kelahiran' })[0]!.content).not.toContain('MODE LIHAT SAJA');
  });
});
