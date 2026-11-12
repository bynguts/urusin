/**
 * Daerah tempat Browser Pendamping (AI ikut mengisi formulir di portal resmi) dijamin aktif. Keputusan pemilik produk
 * 2026-11-12 (ADR 0032): daerah lain dipandu langkah demi langkah dan Pendamping-nya dikomunikasikan sebagai "sedang
 * dikembangkan". Satu sumber kebenaran untuk rute agen (harness), kartu rencana, dan halaman web.
 */
export const DAERAH_PENDAMPING_AKTIF: readonly { kode: string; nama: string }[] = Object.freeze([
  { kode: '3578', nama: 'Surabaya' },
  { kode: '3312', nama: 'Wonogiri' },
  { kode: '3374', nama: 'Semarang' },
  { kode: '1271', nama: 'Medan' },
  { kode: '3573', nama: 'Malang' },
  { kode: '3276', nama: 'Depok' },
  { kode: '3671', nama: 'Kota Tangerang' },
  { kode: '1371', nama: 'Padang' },
  { kode: '1871', nama: 'Bandar Lampung' },
  { kode: '6371', nama: 'Banjarmasin' },
]);

const AKTIF = new Set(DAERAH_PENDAMPING_AKTIF.map((d) => d.kode));

/** True bila Browser Pendamping aktif untuk kab/kota ini (kode 4 digit). */
export function pendampingAktif(kode: string | null | undefined): boolean {
  return typeof kode === 'string' && AKTIF.has(kode);
}

/** "Surabaya, Wonogiri, ..., dan Banjarmasin". */
export const DAFTAR_PENDAMPING_AKTIF: string = (() => {
  const n = DAERAH_PENDAMPING_AKTIF.map((d) => d.nama);
  return `${n.slice(0, -1).join(', ')}, dan ${n.at(-1)}`;
})();

/**
 * Kalimat positif untuk warga di daerah tanpa Browser Pendamping: Urusin memandu, Pendamping sedang dikembangkan.
 * `sisipan` (opsional) = kalimat kanal daerah, mis. "Disdukcapil X melayani pengajuan lewat WhatsApp."
 */
export function kalimatPendampingBerkembang(wilayah: string, sisipan?: string): string {
  return [
    `Untuk ${wilayah}, Urusin memandu Anda langkah demi langkah.`,
    sisipan,
    `Browser Pendamping (AI ikut mengisi formulir di situs resmi) untuk ${wilayah} sedang kami kembangkan; saat ini aktif di ${DAFTAR_PENDAMPING_AKTIF}.`,
  ]
    .filter(Boolean)
    .join(' ');
}
