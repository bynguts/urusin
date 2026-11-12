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

/** Data anggota keluarga di brankas: `{{AYAH|IBU|ANAK|PASANGAN.<KUNCI>}}` (dan `{{PEMOHON.AYAH|IBU.<KUNCI>}}`). */
const PERAN: Record<string, string> = { AYAH: 'ayah', IBU: 'ibu', ANAK: 'anak', PASANGAN: 'pasangan' };
const ANGGOTA: Record<string, string> = {
  NAMA: 'Nama lengkap',
  NAMA_LENGKAP: 'Nama lengkap',
  NIK: 'NIK',
  TGL_LAHIR: 'Tanggal lahir',
  TANGGAL_LAHIR: 'Tanggal lahir',
  JK: 'Jenis kelamin',
  JENIS_KELAMIN: 'Jenis kelamin',
  TEMPAT_LAHIR: 'Tempat lahir',
};
const ALIAS: Record<string, string> = {
  NAMA_IBU: 'Nama lengkap ibu',
  NAMA_AYAH: 'Nama lengkap ayah',
};

/**
 * Label data brankas untuk placeholder, atau undefined: `{{PEMOHON.<KUNCI>}}` (Data Diri "Saya", plus
 * `NAMA_IBU`/`NAMA_AYAH`) dan data anggota keluarga. `{{ORANG2.NIK}}`, `{{ANAK.AYAH.NAMA}}` bukan data brankas,
 * jadi diketik warga sendiri (`isi_sendiri`). Cermin `fieldDataDiri` di apps/web/src/lib/pendamping/isi-data.ts.
 */
function labelDataDiri(placeholder: string): string | undefined {
  const m = /^\{\{([A-Z][A-Z0-9_]*)\.([A-Z0-9_]+)(?:\.([A-Z0-9_]+))?\}\}$/.exec(placeholder);
  if (!m) return undefined;
  const [, ns = '', a = '', b] = m;
  const anggota = (p: string, k: string) =>
    Object.hasOwn(PERAN, p) && Object.hasOwn(ANGGOTA, k) ? `${ANGGOTA[k]} ${PERAN[p]}` : undefined;
  if (b !== undefined) return ns === 'PEMOHON' && (a === 'AYAH' || a === 'IBU') ? anggota(a, b) : undefined;
  if (ns !== 'PEMOHON') return anggota(ns, a);
  return Object.hasOwn(DATA_DIRI, a) ? DATA_DIRI[a] : Object.hasOwn(ALIAS, a) ? ALIAS[a] : undefined;
}

/** Placeholder yang dipenuhi Data Diri (boleh menahan AI sampai "Izinkan isi"). */
export function dariDataDiri(placeholder: string): boolean {
  return labelDataDiri(placeholder) !== undefined;
}

/** Pesan giliran warga untuk nilai isian (bisa memuat beberapa placeholder); tanpa nilai apa pun. */
export function pesanIsiSendiri(value: string): string {
  const label = [...value.matchAll(/\{\{[^{}]+\}\}/g)]
    .map((m) => {
      const d = labelDataDiri(m[0]);
      const a = akhiran(m[0]);
      return d ?? (a && Object.hasOwn(LAIN, a) ? LAIN[a] : undefined);
    })
    .find((l) => l !== undefined);
  return `Ketik ${label ?? 'isian yang diminta'} di kolom yang disorot, lalu tekan Lanjutkan.`;
}

/** Pesan giliran `berkas_kurang`: Dokumen untuk langkah unggah belum ada di akun warga. */
export function pesanBerkasKurang(nama: string): string {
  return `Dokumen ${nama.toUpperCase()} belum ada. Tambahkan di Dokumen, lalu tekan Lanjutkan.`;
}
