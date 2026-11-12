import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Basis data NSS Chromium berisi intermediate CA publik (temuan QA prod, siapel.malangkota.go.id: server hanya
 * mengirim sertifikat leaf). Chromium desktop warga melengkapi rantai lewat AIA fetching; Chromium di worker
 * tidak bisa, karena egress hanya mengizinkan CONNECT :443 ke host resmi (unduhan http AIA ke host CA ditolak).
 *
 * Basis data dibangun saat build image (Dockerfile tahap `nss`, `certutil -A -t ",,"`): HANYA intermediate tanpa
 * trust (bukan trust anchor), sidik SHA-256 diperiksa terhadap `certs/intermediate.json`. Intermediate hanya
 * membantu membangun rantai: validasi rantai sampai root Chrome Root Store, nama host, dan masa berlaku tetap penuh.
 *
 * Chromium Linux membuka `$HOME/.pki/nssdb` dan butuh berkas yang BISA DITULIS (salinan read-only diabaikan,
 * diukur). Root filesystem produksi read-only, jadi basis data disalin sekali per proses ke tmpfs (`/tmp`) dan
 * HOME Chromium diarahkan ke sana.
 */
export const BERKAS_NSS = ['cert9.db', 'key4.db', 'pkcs11.txt'] as const;

const salinan = new Map<string, string>();

/**
 * Env Chromium untuk basis data NSS (`{ HOME }`), atau `{}` bila tidak dikonfigurasi (dev di luar Linux).
 * Sumber dikonfigurasi tetapi tidak lengkap = galat (gagal tertutup, bukan diam-diam tanpa intermediate).
 */
export function envNss(sumber: string | undefined, dasar = tmpdir()): { HOME?: string } {
  if (!sumber) return {};
  const ada = salinan.get(sumber);
  if (ada) return { HOME: ada };
  for (const b of BERKAS_NSS)
    if (!existsSync(join(sumber, b))) throw new Error(`basis data NSS tidak lengkap: ${join(sumber, b)}`);
  const home = join(dasar, `urusin-nss-${process.pid}-${salinan.size}`);
  const db = join(home, '.pki', 'nssdb');
  mkdirSync(db, { recursive: true, mode: 0o700 });
  for (const b of BERKAS_NSS) {
    copyFileSync(join(sumber, b), join(db, b));
    // Sumber di image milik root dan read-only; NSS mengabaikan basis data yang tidak bisa ditulis.
    chmodSync(join(db, b), 0o600);
  }
  salinan.set(sumber, home);
  return { HOME: home };
}
