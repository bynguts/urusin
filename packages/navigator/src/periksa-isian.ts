import type { Aksi, ElemenAmatan, Pengamatan } from '@urusin/contracts';
import { dataAksi, type Bungkus, type MasalahIsian } from './riwayat.js';
import { normalLabel } from './validasi.js';

/**
 * Periksa-sesudah-aksi (verify-after-act): isian AI langkah lalu dibandingkan dengan pengamatan berikutnya. Kolom
 * yang kini bergalat validasi situs, atau kosong lagi (nilai tidak menempel, halaman yang sama dirender ulang
 * dengan galat), dilaporkan ke rencana berikutnya sebagai PERIKSA HASIL agar model mengoreksi (opsi lain, kolom
 * yang benar) alih-alih langsung menyerahkan. Koreksi dibatasi per kolom (`BATAS_KOREKSI`): sesudah itu kolom
 * diserahkan ke warga (`isi_sendiri`) secara deterministik.
 */

/** Koreksi paling banyak per kolom (per halaman fisik) sebelum kolom itu diserahkan ke warga. */
export const BATAS_KOREKSI = 2;

/** Identitas kolom lintas render (ref bisa berganti): peran + label ternormalisasi + formulir. */
export const kunciKolom = (e: Pick<ElemenAmatan, 'peran' | 'nama' | 'form'>): string =>
  `${e.peran}\n${normalLabel(e.nama)}\n${e.form ?? ''}`;

/** Satu isian yang benar-benar dijalankan worker (kode ok), tanpa nilai. */
export type IsianAi = {
  kunci: string;
  label: string;
  jenis: Extract<Aksi['jenis'], 'isi' | 'pilih' | 'centang' | 'unggah'>;
  data?: string | undefined;
};

/** Isian AI satu langkah: halaman fisik tempat diisi dan apakah sesudahnya ada klik yang dijalankan. */
export type JejakIsi = { halaman: string; isian: IsianAi[]; klik: boolean };

/** Isian AI dari aksi yang dijalankan di pengamatan `p` (aksi non-isian dan ref tak teramati dibuang). */
export function isianDari(p: Pengamatan, aksi: Aksi): IsianAi | undefined {
  if (aksi.jenis !== 'isi' && aksi.jenis !== 'pilih' && aksi.jenis !== 'centang' && aksi.jenis !== 'unggah')
    return undefined;
  const e = p.elemen.find((x) => x.ref === aksi.ref);
  return e ? { kunci: kunciKolom(e), label: e.nama, jenis: aksi.jenis, data: dataAksi(aksi) } : undefined;
}

export type TemuanIsian = {
  /** Ref kolom di pengamatan BARU. */
  ref: string;
  isian: IsianAi;
  masalah: MasalahIsian;
  /** Teks galat situs (tak tepercaya, dibungkus saat dirender). */
  galat?: string | undefined;
};

/**
 * Temuan per kolom yang diisi AI langkah lalu. Kolom dicari lewat `kunciKolom` dan harus unik; kolom yang tidak
 * ada lagi = halaman sudah berganti (bukan masalah). `kosong` hanya dihitung untuk isi/pilih ber-placeholder dan
 * hanya bila tidak ada klik sesudahnya (nilai tidak menempel) atau halaman menandai galat formulir (dirender ulang
 * dengan galat): wizard yang pindah langkah dengan label kolom sama tidak dianggap gagal.
 */
export function periksaIsian(lalu: JejakIsi, p: Pengamatan): TemuanIsian[] {
  const temuan: TemuanIsian[] = [];
  for (const isian of lalu.isian) {
    const cocok = p.elemen.filter((e) => kunciKolom(e) === isian.kunci);
    if (cocok.length !== 1) continue;
    const e = cocok[0]!;
    if (e.galat) temuan.push({ ref: e.ref, isian, masalah: 'galat', galat: e.galat });
    else if (
      (isian.jenis === 'isi' || (isian.jenis === 'pilih' && isian.data?.startsWith('{{'))) &&
      e.isian === 'kosong' &&
      (!lalu.klik || p.sinyal.galatForm)
    )
      temuan.push({ ref: e.ref, isian, masalah: 'kosong' });
  }
  return temuan;
}

/** Temuan yang masih boleh dikoreksi model, dengan nomor percobaannya. */
export type Koreksi = TemuanIsian & { ke: number };

/** Masukan PERIKSA HASIL untuk prompt berikutnya. */
export type HasilPeriksa = {
  /** Sesudah klik, halaman fisik yang sama muncul lagi dengan galat formulir. */
  ulang: boolean;
  koreksi: Koreksi[];
};

/**
 * Blok PERIKSA HASIL untuk pesan pengguna, atau undefined bila tidak ada yang perlu dikoreksi. Ref = ref di
 * halaman SAAT INI; label dan galat halaman lewat `b` (redaksi + spotlight).
 */
export function blokPeriksa(h: HasilPeriksa | undefined, b: Bungkus): string | undefined {
  if (!h || (!h.ulang && h.koreksi.length === 0)) return undefined;
  const baris = ['PERIKSA HASIL (sistem membandingkan halaman ini dengan isian AI di langkah sebelumnya):'];
  if (h.ulang) baris.push('- Sesudah klik, halaman yang sama muncul lagi dengan galat validasi situs.');
  for (const k of h.koreksi) {
    const apa = k.isian.data ?? k.isian.jenis;
    const masalah =
      k.masalah === 'galat'
        ? `situs menolak: galat=${b(k.galat ?? '', `${k.ref}.periksa`, 120)}`
        : 'kolom kosong lagi (situs tidak menerima nilainya)';
    baris.push(
      `- ${k.ref} (nama=${b(k.isian.label, `${k.ref}.periksa.nama`, 80)}) tadi diisi ${apa}: ${masalah}. Koreksi ke-${k.ke} dari ${BATAS_KOREKSI}.`,
    );
  }
  baris.push(
    'Koreksi kolom di atas dengan cara LAIN (opsi lain yang sesuai galat, placeholder lain yang lebih cocok, atau kolom yang benar); jangan mengulang isian yang sama. Bila data yang diminta tidak ada di katalog, serahkan isi_sendiri dengan ref kolom itu.',
  );
  return baris.join('\n');
}
