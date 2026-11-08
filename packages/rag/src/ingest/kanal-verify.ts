import { readFileSync, writeFileSync } from 'node:fs';
import { isAllowedUrl } from '../allowlist.js';
import { KanalFileSchema, type Kanal } from '../kanal.js';
import type { ProbeGet } from './kontak.js';

/**
 * Periksa satu tautan kanal: status 200, HTML, domain akhir tetap resmi setelah redirect, dan halaman memuat kata
 * kunci `cek`. Bila `verifikasiVia` ada, halaman itu yang diambil (isi mentah dicocokkan, termasuk tautan).
 */
export async function verifyKanal(k: Kanal, get: ProbeGet): Promise<{ ok: boolean; why: string }> {
  try {
    const r = await get(k.verifikasiVia ?? k.url);
    if (r.status !== 200) return { ok: false, why: `HTTP ${r.status}` };
    if (!/html/i.test(r.contentType)) return { ok: false, why: 'bukan HTML' };
    if (!isAllowedUrl(r.finalUrl)) {
      return { ok: false, why: `redirect ke domain tidak resmi (${new URL(r.finalUrl).hostname})` };
    }
    const text = k.verifikasiVia ? r.body : r.body.replace(/<[^>]+>/g, ' ');
    return new RegExp(k.cek, 'i').test(text)
      ? { ok: true, why: '' }
      : { ok: false, why: 'kata kunci tidak ditemukan' };
  } catch (e) {
    return { ok: false, why: (e as Error).name };
  }
}

/** Verifikasi semua entri di berkas kanal dan tulis balik `verifiedAt` (sekarang bila lolos, null bila gagal). */
export async function runKanal(o: {
  path: string;
  get: ProbeGet;
  now: () => Date;
  log: (line: string) => void;
}): Promise<void> {
  const file = KanalFileSchema.parse(JSON.parse(readFileSync(o.path, 'utf8')));
  for (const k of file.kanal) {
    const { ok, why } = await verifyKanal(k, o.get);
    k.verifiedAt = ok ? o.now().toISOString() : null;
    o.log(
      `${ok ? 'OK    ' : 'GAGAL '} ${k.id.padEnd(7)} ${k.verifikasiVia ?? k.url}${why ? ` (${why})` : ''}`,
    );
  }
  writeFileSync(o.path, JSON.stringify(file, null, 2) + '\n');
}
