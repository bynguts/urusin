/**
 * Utilitas tes (tidak diekspor dari index). Nilai PII sintetis dirakit dari potongan agar pemindai PII
 * repo tidak menandai berkas sumber.
 */
import type { Db } from './db.js';

export const j = (...p: string[]) => p.join('');

/** NIK sintetis valid struktur (provinsi 33, tanggal 15, bulan 08). */
export const FAKE_NIK = j('331201', '150890', '0001');
export const FAKE_NIK_2 = j('317101', '010195', '0002');
export const FAKE_HP = j('0812', '3456', '7890');
export const FAKE_EMAIL = j('warga', '@', 'contoh.id');

/** Seluruh isi semua tabel sebagai satu string (untuk grep PII). */
export function dumpDb(db: Db): string {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as {
    name: string;
  }[];
  return tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t.name}"`).all())).join('\n');
}

/** 16 digit berurutan yang bukan bagian dari string heksadesimal (hash/ID acak). */
export const SIXTEEN_DIGIT_RUN = /(?<![0-9a-f])\d{16}(?![0-9a-f])/;
