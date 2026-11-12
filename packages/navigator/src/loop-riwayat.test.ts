import type { CatatanPendamping, Pengamatan } from '@urusin/contracts';
import { isSpotlighted } from '@urusin/harness';
import type { ChatMessage, ChatParams } from '@urusin/llm';
import { describe, expect, it } from 'vitest';
import { jalankanNavigator } from './loop.js';
import { BATAS_KOREKSI } from './periksa-isian.js';
import { HOST_UJI, ProviderSkrip, WorkerPalsu, halaman, halamanForm, halamanTinjau } from './testing.js';

const CAPS = { json_schema_strict: true, tools: false };
/** NIK sintetis dirakit saat runtime (pii-scan menolak deret 16 digit di sumber). */
const NIK = ['3312', '0115', '0890', '0001'].join('');
const PIKIR = 'RAHASIA-PIKIR: formulir KK, isi identitas lalu Lanjut.';
const RENCANA_FORM = {
  aksi: [
    { jenis: 'isi', ref: 'e1', nilai: '{{PEMOHON.NIK}}' },
    { jenis: 'isi', ref: 'e2', nilai: '{{PEMOHON.NAMA}}' },
    { jenis: 'pilih', ref: 'e3', nilai: { opsi: 1 } },
    { jenis: 'klik', ref: 'e11' },
  ],
};
const SERAHKAN_FINAL = { aksi: [{ jenis: 'serahkan', alasan: 'final' }] };

function jalankan(worker: WorkerPalsu, provider: ProviderSkrip) {
  const jejak: CatatanPendamping[] = [];
  const hasil = jalankanNavigator({
    executionId: 'x_uji',
    tangan: worker,
    llm: { provider, model: 'fake-model', caps: CAPS },
    tujuan: 'Kartu Keluarga',
    hostsBoleh: new Set([HOST_UJI]),
    kodeKabKota: '3312',
    jejak: (c) => jejak.push(c),
  });
  return { hasil, jejak };
}

const user = (params: ChatParams | undefined): string =>
  String((params?.messages as ChatMessage[] | undefined)?.find((m) => m.role === 'user')?.content ?? '');
const blok = (u: string, kepala: string): string => (u.includes(kepala) ? u.slice(u.indexOf(kepala)) : '');

/** Halaman formulir yang sama, dirender ulang situs sesudah Lanjut dengan galat di "Jenis Permohonan". */
function formGalat(sidik: string, galat: string): Pengamatan {
  const p = halamanForm({ sidik, seq: 2 });
  return {
    ...p,
    sinyal: { ...p.sinyal, galatForm: true },
    elemen: p.elemen.map((e) =>
      e.ref === 'e1'
        ? { ...e, isian: '{{PEMOHON.NIK}}' }
        : e.ref === 'e2'
          ? { ...e, isian: '{{PEMOHON.NAMA}}' }
          : e.ref === 'e3'
            ? { ...e, isian: 'terisi_situs', galat }
            : e,
    ),
  };
}

describe('riwayat lintasan di loop', () => {
  it('prompt berikutnya memuat RIWAYAT: giliran warga, tolakan validator, aksi + kode worker; tanpa PII/pikir', async () => {
    const masuk = halaman({
      sidik: 'masuk',
      jalur: '/masuk',
      judul: 'Masuk Akun',
      sinyal: { ...halamanForm().sinyal, login: true },
      elemen: [{ ref: 'e1', peran: 'teks', nama: 'Kata sandi', terlarang: 'sandi' }],
    });
    const form = halamanForm({ judul: `Permohonan KK atas NIK ${NIK}` });
    const worker = new WorkerPalsu([masuk, form, halamanTinjau()]);
    worker.setujuiSemua = true;
    worker.saatSerahkan = (alasan) =>
      alasan === 'masuk_akun' ? { aksi: 'kembalikan', ke: 1 } : { aksi: 'selesai' };
    const provider = new ProviderSkrip((n) =>
      n === 0
        ? { pikir: PIKIR, aksi: [{ jenis: 'klik', ref: 'e99' }] }
        : n === 1
          ? { pikir: PIKIR, ...RENCANA_FORM }
          : { pikir: PIKIR, ...SERAHKAN_FINAL },
    );
    const { hasil, jejak } = jalankan(worker, provider);
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
    expect(provider.calls).toHaveLength(3);

    // Prompt pertama di formulir: warga sudah masuk akun (giliran selesai) — fakta polos dari loop.
    const r0 = blok(user(provider.calls[0]), 'RIWAYAT');
    expect(r0).toContain(
      'giliran warga (masuk_akun: masuk akun): warga menyelesaikannya, kendali kembali ke AI',
    );
    expect(r0).not.toContain('PERIKSA HASIL');
    // Rencana ulang di halaman yang sama: tolakan validator tercatat.
    expect(blok(user(provider.calls[1]), 'RIWAYAT')).toContain(
      'validator menolak rencana AI: REF_TIDAK_DIAMATI',
    );
    // Halaman tinjau: isian halaman sebelumnya (label terbungkus, placeholder, kode worker), tanpa ref lama.
    const r2 = blok(user(provider.calls[2]), 'RIWAYAT');
    expect(r2).toMatch(
      /AI menjalankan: isi <<DATA_TAK_TEPERCAYA[^>]*>>NomorˆIndukˆKependudukan<<[^>]*>> <- \{\{PEMOHON\.NIK\}\} \[ok\]/,
    );
    expect(r2).toContain('<- opsi 1 [ok]');
    expect(r2).toMatch(/klik <<DATA_TAK_TEPERCAYA[^>]*>>Lanjut<<[^>]*>> \[ok\]/);
    expect(r2).toMatch(/halaman: jalur <<DATA_TAK_TEPERCAYA[^>]*>>\/generik\/tanpa-akun\/formulir/);
    // Halaman saat ini (tinjau) hanya di baris HALAMAN, tidak diulang di riwayat.
    expect(r2).not.toContain('tinjau');
    expect(r2).not.toMatch(/\be(1|2|3|11)\b/);
    expect(isSpotlighted(r2, /nonce="([^"]+)"/.exec(r2)![1]!)).toBe(true);

    // Tidak ada NIK (judul halaman di riwayat diredaksi) di prompt mana pun.
    expect(provider.semuaPrompt).not.toContain(NIK);
    expect(provider.semuaPrompt.replace(/\D/g, '')).not.toContain(NIK);
    // pikir tidak pernah dijalankan, dikirim ke worker, atau masuk jejak audit.
    expect(JSON.stringify(worker.diterima)).not.toMatch(/pikir|RAHASIA/);
    expect(JSON.stringify(jejak)).not.toMatch(/pikir|RAHASIA|NomorˆInduk|Nomor Induk/);
  });
});

describe('periksa-sesudah-aksi di loop', () => {
  it('galat situs sesudah isi: model mengoreksi kolomnya (opsi lain), tanpa serah ke warga', async () => {
    const galat = 'Kuota KK Baru hari ini habis; pilih jenis lain.';
    const worker = new WorkerPalsu([halamanForm(), formGalat('sidik-galat', galat), halamanTinjau()]);
    worker.setujuiSemua = true;
    const provider = new ProviderSkrip((_, params) => {
      const u = user(params);
      if (u.includes('halamanAkhir')) return SERAHKAN_FINAL;
      if (u.includes('PERIKSA HASIL'))
        return {
          pikir: 'Situs menolak opsi 1, pilih opsi 2.',
          aksi: [
            { jenis: 'pilih', ref: 'e3', nilai: { opsi: 2 } },
            { jenis: 'klik', ref: 'e11' },
          ],
        };
      return RENCANA_FORM;
    });
    const { hasil } = jalankan(worker, provider);
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
    expect(provider.calls).toHaveLength(3);

    const periksa = blok(user(provider.calls[1]), 'PERIKSA HASIL');
    expect(periksa).toContain('halaman yang sama muncul lagi dengan galat');
    expect(periksa).toMatch(
      /- e3 \(nama=<<DATA_TAK_TEPERCAYA[^\n]*JenisˆPermohonan[^\n]*\) tadi diisi opsi 1: situs menolak: galat=/,
    );
    expect(periksa).toContain('KuotaˆKKˆBaru');
    expect(periksa).not.toContain(galat);
    expect(periksa).toContain(`Koreksi ke-1 dari ${BATAS_KOREKSI}`);
    // Kolom yang menempel (NIK, nama) tidak dilaporkan.
    expect(periksa).not.toMatch(/- e[12] \(/);
    // Koreksi berhasil: pindah ke tinjau tanpa giliran warga di antaranya; riwayat mencatat penolakan situs.
    expect(worker.semuaAksi.filter((a) => a.jenis === 'serahkan')).toEqual([
      { jenis: 'serahkan', alasan: 'final' },
    ]);
    expect(worker.semuaAksi).toContainEqual({ jenis: 'pilih', ref: 'e3', nilai: { opsi: 2 } });
    const r2 = blok(user(provider.calls[2]), 'RIWAYAT');
    expect(r2).toMatch(
      /situs menolak isian AI: <<DATA_TAK_TEPERCAYA[^>]*>>JenisˆPermohonan<<[^>]*>> <- opsi 1 \(galat validasi\)/,
    );
    expect(r2).toContain('<- opsi 2 [ok]');
    expect(blok(user(provider.calls[2]), 'PERIKSA HASIL')).toBe('');
  });

  it(`kolom yang tetap ditolak sesudah ${BATAS_KOREKSI} koreksi diserahkan ke warga (isi_sendiri, ref kolom)`, async () => {
    const worker = new WorkerPalsu([
      halamanForm(),
      ...Array.from({ length: BATAS_KOREKSI + 1 }, (_, i) =>
        formGalat(`galat-${i}`, `Jenis ditolak (${i}).`),
      ),
    ]);
    worker.setujuiSemua = true;
    let opsi = 0;
    const provider = new ProviderSkrip((n, params) => {
      // Rencana koreksi pertama ditolak validator: temuan tetap berlaku untuk rencana ulang, tanpa menambah hitungan.
      if (n === 1) return { aksi: [{ jenis: 'klik', ref: 'e99' }] };
      return user(params).includes('PERIKSA HASIL')
        ? {
            aksi: [
              { jenis: 'pilih', ref: 'e3', nilai: { opsi: 1 + (++opsi % 2) } },
              { jenis: 'klik', ref: 'e11' },
            ],
          }
        : RENCANA_FORM;
    });
    const { hasil } = jalankan(worker, provider);
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'isi_sendiri' });
    // 1 rencana formulir + 1 ditolak + BATAS_KOREKSI koreksi; sesudah itu tanpa LLM.
    expect(provider.calls).toHaveLength(2 + BATAS_KOREKSI);
    expect(user(provider.calls[1])).toContain(`Koreksi ke-1 dari ${BATAS_KOREKSI}`);
    expect(user(provider.calls[2])).toContain(`Koreksi ke-1 dari ${BATAS_KOREKSI}`);
    expect(user(provider.calls[3])).toContain(`Koreksi ke-2 dari ${BATAS_KOREKSI}`);
    expect(worker.semuaAksi.at(-1)).toEqual({ jenis: 'serahkan', alasan: 'isi_sendiri', ref: 'e3' });
  });

  it('isian yang menempel di halaman berikutnya tidak memicu PERIKSA HASIL', async () => {
    const worker = new WorkerPalsu([halamanForm(), halamanTinjau()]);
    worker.setujuiSemua = true;
    const provider = new ProviderSkrip((n) => (n === 0 ? RENCANA_FORM : SERAHKAN_FINAL));
    const { hasil } = jalankan(worker, provider);
    expect(await hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
    expect(provider.calls.map(user).join('\n')).not.toContain('PERIKSA HASIL');
    // Prompt pertama tanpa riwayat: halaman saat ini hanya di baris HALAMAN.
    expect(user(provider.calls[0])).not.toContain('RIWAYAT');
  });
});
