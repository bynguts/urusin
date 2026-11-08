/**
 * Jumlah turn agen yang sedang berjalan di proses ini, untuk /api/health. deploy.sh memakainya
 * agar warna lama tidak dihentikan saat masih ada turn (menunggu sampai 0 atau batas turn 120 dtk).
 * Sumber didaftarkan runtime saat dibuat; sebelum itu (belum ada turn) nilainya 0.
 */
let source: (() => number) | undefined;

export function setRunningTurnsSource(fn: (() => number) | undefined): void {
  source = fn;
}

export function runningTurns(): number {
  return source?.() ?? 0;
}
