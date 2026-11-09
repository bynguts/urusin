/**
 * Placeholder adapter dari sisi Pendamping. Hanya placeholder Data Diri yang masuk daftar write "Izinkan isi"
 * (cermin `KOLOM` di apps/web/src/lib/pendamping/isi-data.ts); hanya itu yang boleh menahan AI di
 * `menunggu_data`. Placeholder lain (kitir, kode pelayanan, nomor polisi, NIB) dan Data Diri yang kosong
 * diketik warga sendiri di layar saat AI sampai di kolomnya (takeover `isi_sendiri`). Nilainya tidak pernah
 * lewat server Urusin, log, atau model.
 */

const DATA_DIRI: Record<string, string> = {
  NAMA: 'Nama lengkap',
  NAMA_LENGKAP: 'Nama lengkap',
  NIK: 'NIK',
  KK: 'Nomor KK',
  NO_KK: 'Nomor KK',
  NOMOR_KK: 'Nomor KK',
  TEMPAT_LAHIR: 'Tempat lahir',
  TANGGAL_LAHIR: 'Tanggal lahir',
  JENIS_KELAMIN: 'Jenis kelamin',
  AGAMA: 'Agama',
  PEKERJAAN: 'Pekerjaan',
  ALAMAT: 'Alamat',
  RT: 'RT',
  RW: 'RW',
  KELURAHAN: 'Kelurahan/desa',
  DESA: 'Kelurahan/desa',
  KECAMATAN: 'Kecamatan',
  KODE_POS: 'Kode pos',
  HP: 'Nomor HP',
  TELEPON: 'Nomor HP',
  EMAIL: 'Email',
};

const LAIN: Record<string, string> = {
  KITIR: 'Nomor kitir',
  KODE_PELAYANAN: 'Kode pelayanan',
  NOPOL_ANGKA: 'Angka nomor polisi',
  NOPOL_HURUF: 'Huruf akhir nomor polisi',
  NIB: 'NIB',
};

function akhiran(placeholder: string): string | undefined {
  const m = /^\{\{[A-Z][A-Z0-9_]*\.([A-Z0-9_.]+)\}\}$/.exec(placeholder);
  return m?.[1]?.split('.').at(-1);
}

/**
 * Kunci Data Diri: HANYA `{{PEMOHON.<KUNCI>}}` (satu segmen). `{{ANAK.NIK}}`, `{{ORANG2.NIK}}`, atau
 * `{{PEMOHON.AYAH.NAMA}}` bukan data pemohon, jadi diketik warga sendiri (`isi_sendiri`).
 */
function kunciDataDiri(placeholder: string): string | undefined {
  const a = /^\{\{PEMOHON\.([A-Z0-9_]+)\}\}$/.exec(placeholder)?.[1];
  return a !== undefined && Object.hasOwn(DATA_DIRI, a) ? a : undefined;
}

/** Placeholder yang dipenuhi Data Diri (boleh menahan AI sampai "Izinkan isi"). */
export function dariDataDiri(placeholder: string): boolean {
  return kunciDataDiri(placeholder) !== undefined;
}

/** Pesan giliran warga untuk nilai isian (bisa memuat beberapa placeholder); tanpa nilai apa pun. */
export function pesanIsiSendiri(value: string): string {
  const label = [...value.matchAll(/\{\{[^{}]+\}\}/g)]
    .map((m) => {
      const d = kunciDataDiri(m[0]);
      const a = akhiran(m[0]);
      return d !== undefined ? DATA_DIRI[d] : a && Object.hasOwn(LAIN, a) ? LAIN[a] : undefined;
    })
    .find((l) => l !== undefined);
  return `Ketik ${label ?? 'isian yang diminta'} di kolom yang disorot, lalu tekan Lanjutkan.`;
}

/** Pesan giliran `berkas_kurang`: Dokumen untuk langkah unggah belum ada di akun warga. */
export function pesanBerkasKurang(nama: string): string {
  return `Dokumen ${nama.toUpperCase()} belum ada. Tambahkan di Dokumen, lalu tekan Lanjutkan.`;
}
