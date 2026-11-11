/**
 * Log siklus sesi Browser Pendamping: satu baris JSON per peristiwa di stdout (`docker logs`), supaya sesi
 * produksi bisa dilacak (mulai, navigasi awal, izin, galat, akhir). HANYA id acak sesi, host, kode,
 * hitungan, dan durasi: tidak pernah nilai isian, path/query URL, teks halaman, atau data warga.
 */
export type IsiLog = Readonly<Record<string, string | number | boolean | undefined>>;

export function logSesi(ev: string, isi: IsiLog = {}): void {
  const bersih: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(isi)) if (v !== undefined) bersih[k] = v;
  console.log(JSON.stringify({ t: new Date().toISOString(), src: 'pendamping', ev, ...bersih }));
}

/** Host dari URL/origin (tanpa path, query, atau kredensial); '-' bila tak terbaca. */
export function hostDari(url: string): string {
  return URL.parse(url)?.host ?? '-';
}
