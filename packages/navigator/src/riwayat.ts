import type { Aksi, KodeHasilAksi, Pengamatan } from '@urusin/contracts';
import type { AlasanAmbilAlih } from './anggaran.js';
import type { IdAturan } from './validasi.js';

/**
 * Riwayat lintasan Navigator (memori antarhalaman): beberapa langkah terakhir eksekusi ini, agar model tahu apa
 * yang sudah diisi, apa yang ditolak worker/validator/warga, dan kapan warga memegang kendali.
 *
 * Fakta buatan loop sendiri (jenis aksi, placeholder katalog, indeks opsi, kode hasil worker, id aturan, alasan
 * serah) tepercaya dan ditulis polos. Teks yang berasal dari halaman (jalur, judul, label elemen) hanya disimpan
 * di memori proses dan baru diredaksi + dibungkus spotlight saat prompt dirakit (`blokRiwayat`), sama dengan teks
 * halaman lain. Riwayat TIDAK PERNAH memuat nilai isian: hanya nama placeholder (`{{PEMOHON.NAMA}}`).
 */

export const BATAS_RIWAYAT = {
  /** Langkah terakhir yang diingat. */
  langkah: 8,
  /** Batas karakter blok RIWAYAT di prompt (langkah terlama dibuang lebih dulu). */
  karakter: 3_000,
  /** Batas karakter satu label/jalur/judul halaman di riwayat. */
  label: 80,
  /** Aksi per baris riwayat yang ditampilkan; sisanya dihitung saja. */
  aksiPerBaris: 6,
} as const;

/** Satu aksi yang dikirim ke worker: label kolom dari halaman (tak tepercaya), data tanpa nilai, kode hasil. */
export type AksiRiwayat = { jenis: Aksi['jenis']; label?: string; data?: string; kode: KodeHasilAksi };

/** Masalah isian AI yang terlihat di pengamatan berikutnya (lihat periksa-isian.ts). */
export type MasalahIsian = 'galat' | 'kosong';

export type LangkahRiwayat =
  | { jenis: 'halaman'; jalur: string; judul: string }
  | { jenis: 'aksi'; aksi: AksiRiwayat[] }
  | { jenis: 'tolak'; aturan: readonly IdAturan[] }
  /** Baris lembar izin yang ditolak warga (placeholder atau `berkas:<NAMA>`): diisi warga sendiri. */
  | { jenis: 'izin'; ditolak: readonly string[] }
  /** Giliran warga: `kembali` = warga selesai dan kendali kembali ke AI; false = serah tidak dijalankan worker. */
  | { jenis: 'serah'; alasan: AlasanAmbilAlih; kembali: boolean }
  | { jenis: 'koreksi'; label: string; data?: string | undefined; masalah: MasalahIsian };

/**
 * Data aksi TANPA nilai: placeholder katalog (sudah lolos validator), indeks opsi, boolean centang, atau nama
 * berkas katalog. Klik/serah tidak punya data.
 */
export function dataAksi(a: Aksi): string | undefined {
  switch (a.jenis) {
    case 'isi':
      return a.nilai;
    case 'pilih':
      return typeof a.nilai === 'string' ? a.nilai : `opsi ${a.nilai.opsi}`;
    case 'centang':
      return a.nilai ? 'centang' : 'lepas centang';
    case 'unggah':
      return `berkas ${a.berkas}`;
    default:
      return undefined;
  }
}

/** Label elemen ber-ref di pengamatan (teks halaman mentah; dibungkus saat dirender). */
export function labelRef(p: Pengamatan, a: Aksi): string | undefined {
  if (!('ref' in a) || a.ref === undefined) return undefined;
  return p.elemen.find((e) => e.ref === a.ref)?.nama;
}

/** Penyimpan langkah terakhir (paling banyak `maks`), urut kronologis. */
export class Riwayat {
  private readonly langkah: LangkahRiwayat[] = [];

  constructor(private readonly maks: number = BATAS_RIWAYAT.langkah) {}

  catat(l: LangkahRiwayat): void {
    if (l.jenis === 'halaman') {
      // Halaman yang sama dengan halaman terakhir yang tercatat tidak diulang (sesudah isi, galat, giliran warga).
      const lalu = this.langkah.findLast((x) => x.jenis === 'halaman');
      if (lalu?.jenis === 'halaman' && lalu.jalur === l.jalur && lalu.judul === l.judul) return;
    }
    this.langkah.push(l);
    if (this.langkah.length > this.maks) this.langkah.splice(0, this.langkah.length - this.maks);
  }

  get daftar(): readonly LangkahRiwayat[] {
    return [...this.langkah];
  }
}

/** Pembungkus teks halaman di prompt: redaksi PII lalu spotlight ber-nonce (lihat `pesanRencana`). */
export type Bungkus = (teks: string, id: string, maxChars: number) => string;

const PESAN_SERAH: Readonly<Partial<Record<AlasanAmbilAlih, string>>> = {
  masuk_akun: 'masuk akun',
  otp: 'kode OTP',
  captcha: 'verifikasi CAPTCHA',
  final: 'kirim akhir',
  isi_sendiri: 'mengisi kolom sendiri',
  ketuk_tautan: 'mengetuk tautan pembuka',
  tidak_yakin: 'langkah yang AI tidak yakin',
};

function barisLangkah(l: LangkahRiwayat, n: number, b: Bungkus): string {
  const L = BATAS_RIWAYAT.label;
  switch (l.jenis) {
    case 'halaman':
      return `${n}. halaman: jalur ${b(l.jalur, `r${n}.jalur`, L)} | judul ${b(l.judul, `r${n}.judul`, L)}`;
    case 'aksi': {
      const tampil = l.aksi.slice(0, BATAS_RIWAYAT.aksiPerBaris).map((a, i) => {
        const label = a.label !== undefined ? ` ${b(a.label, `r${n}.${i}`, L)}` : '';
        const data = a.data !== undefined ? ` <- ${a.data}` : '';
        return `${a.jenis}${label}${data} [${a.kode}]`;
      });
      const lebih = l.aksi.length - tampil.length;
      return `${n}. AI menjalankan: ${tampil.join('; ')}${lebih > 0 ? `; (+${lebih} aksi lain)` : ''}`;
    }
    case 'tolak':
      return `${n}. validator menolak rencana AI: ${l.aturan.join(', ')}`;
    case 'izin':
      return `${n}. warga tidak mengizinkan AI mengisi ${l.ditolak.join(', ')}; kolom itu diisi warga sendiri`;
    case 'serah': {
      const apa = PESAN_SERAH[l.alasan] ?? l.alasan;
      return l.kembali
        ? `${n}. giliran warga (${l.alasan}: ${apa}): warga menyelesaikannya, kendali kembali ke AI`
        : `${n}. serah ke warga (${l.alasan}) tidak dijalankan Browser Pendamping`;
    }
    case 'koreksi':
      return `${n}. situs menolak isian AI: ${b(l.label, `r${n}.kolom`, L)}${
        l.data !== undefined ? ` <- ${l.data}` : ''
      } (${l.masalah === 'galat' ? 'galat validasi' : 'kolom kosong lagi'})`;
  }
}

/**
 * Blok RIWAYAT untuk pesan pengguna, atau undefined bila kosong. Ref dari halaman lama tidak ditulis (sudah tidak
 * berlaku); label halaman selalu lewat `b`. Panjang total dibatasi `maks` karakter: langkah terlama dibuang dulu.
 */
export function blokRiwayat(
  langkah: readonly LangkahRiwayat[],
  b: Bungkus,
  maks: number = BATAS_RIWAYAT.karakter,
): string | undefined {
  const kepala =
    'RIWAYAT (fakta sistem tentang langkah sebelumnya, terlama dulu; ref halaman lama tidak berlaku lagi):';
  const baris = langkah.map((l, i) => barisLangkah(l, i + 1, b));
  let mulai = 0;
  let panjang = kepala.length + baris.reduce((a, x) => a + x.length + 1, 0);
  while (mulai < baris.length && panjang > maks) panjang -= baris[mulai++]!.length + 1;
  return mulai < baris.length ? [kepala, ...baris.slice(mulai)].join('\n') : undefined;
}
