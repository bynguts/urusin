import { AkunError, hashDaftarWrite } from '@urusin/akun';
import { hostsWilayah } from '@urusin/harness';
import { SEED_ENTRIES } from '@urusin/registry';
import { originFixtures } from '#lib/server/hosts.js';
import type { Runtime } from '#lib/server/runtime.js';

/**
 * PENYELESAI NILAI PII SATU-SATUNYA di server (ADR 0028, arsitek v13 #1). Satu-satunya pemanggil yang sah
 * adalah jalur isi Pendamping (`src/lib/server/pendamping/**`); tes impor (`resolver.test.ts`) menolak impor
 * dari tempat lain. Alurnya:
 * 1. Warga menekan "Izinkan isi" (pesan `pendamping.izinkan`) → `izinkanIsi` menerbitkan token sekali pakai
 *    (5 menit) yang terikat ke pemilik, hash daftar field yang akan ditulis, dan origin tujuan.
 * 2. Jalur isi memanggil `resolusiNilai` dengan token itu; daftar field + origin harus PERSIS sama.
 * Nilai tidak pernah dicatat, tidak pernah dikembalikan ke model, dan hanya field di daftar write yang keluar.
 * Tujuan harus ada di allowlist: portal registry berstatus `kirim-asli` (yang punya adapter Pendamping), portal
 * milik wilayah urusan ini (`hostsWilayah` dari kode wilayah KTP yang sudah ditetapkan warga; Navigator generik,
 * ADR 0030), atau situs latihan. Salinan demo (data sintetis) hanya boleh menuju situs latihan, tidak pernah ke
 * situs pemerintah sungguhan. Persetujuan Navigator generik juga terikat ke `rencanaHash` halaman yang
 * ditampilkan di lembar: hash itu ikut di hash daftar write, jadi token tidak bisa dipakai untuk rencana lain.
 */

const asalTujuan = (targetOrigin: string): string => {
  try {
    return new URL(targetOrigin).origin;
  } catch {
    throw new AkunError('IZIN_TIDAK_VALID');
  }
};

/** Origin portal registry yang diisi Pendamping (`kirim-asli`, sama dengan `dukcapil__ajukan_layanan`). */
const PORTAL_ISI: ReadonlySet<string> = new Set(
  SEED_ENTRIES.flatMap((e) => (e.validasi === 'kirim-asli' && e.portal ? [e.portal.origin] : [])),
);

/** Origin https yang host-nya persis milik wilayah `kode` di registry wilayah (tanpa wildcard). */
function portalMilikWilayah(origin: string, kode: string | null | undefined): boolean {
  if (!kode) return false;
  const u = new URL(origin);
  return u.protocol === 'https:' && hostsWilayah(kode).includes(u.host);
}

function pastikanTujuanBoleh(
  rt: Runtime,
  ownerId: string,
  origin: string,
  kodeWilayah: string | null | undefined,
): void {
  const latihan = originFixtures().has(origin);
  if (rt.akun.akun(ownerId)?.jenis === 'demo' && !latihan) throw new AkunError('NILAI_SINTETIS_DITOLAK');
  if (!latihan && !PORTAL_ISI.has(origin) && !portalMilikWilayah(origin, kodeWilayah))
    throw new AkunError('IZIN_TIDAK_VALID');
}

const RENCANA_RE = /^[0-9a-f]{64}$/;

/** Ikatan persetujuan: daftar write, ditambah `rencanaHash` bila persetujuan untuk rencana Navigator generik. */
function hashIkatan(writeList: readonly string[], rencanaHash: string | undefined): string {
  if (rencanaHash === undefined) return hashDaftarWrite(writeList);
  if (!RENCANA_RE.test(rencanaHash)) throw new AkunError('IZIN_TIDAK_VALID');
  return hashDaftarWrite([...writeList, `rencana:${rencanaHash}`]);
}

/** Konteks urusan untuk allowlist: wilayah KTP yang sudah ditetapkan dan hash rencana halaman (generik). */
export type KonteksIzin = { kodeWilayah?: string | null | undefined; rencanaHash?: string | undefined };

/** Terbitkan token persetujuan "Izinkan isi" untuk daftar field `writeList` menuju `targetOrigin`. */
export function izinkanIsi(
  rt: Runtime,
  ownerId: string,
  writeList: readonly string[],
  targetOrigin: string,
  ktx: KonteksIzin = {},
): string {
  const origin = asalTujuan(targetOrigin);
  pastikanTujuanBoleh(rt, ownerId, origin, ktx.kodeWilayah);
  return rt.akun.terbitkanIzin(ownerId, hashIkatan(writeList, ktx.rencanaHash), origin);
}

/** Entri daftar write untuk berkas dari dompet dokumen: `berkas:<JENIS>` (mis. `berkas:KTP`). */
export const AWALAN_BERKAS = 'berkas:';

export type BerkasIsi = { nama: string; judul: string; mime: string; bytes: Buffer };

/**
 * Pakai token persetujuan (sekali) lalu kembalikan nilai Data Diri HANYA untuk field di `writeList`, plus berkas
 * terbaru per jenis untuk entri `berkas:<JENIS>`. Field/berkas yang tidak ada tidak ikut. Token salah/
 * kedaluwarsa/terpakai, daftar berbeda, atau origin berbeda → AkunError IZIN_TIDAK_VALID.
 */
export function resolusiIsi(
  rt: Runtime,
  p: { ownerId: string; token: string; writeList: readonly string[]; targetOrigin: string } & KonteksIzin,
): { nilai: Record<string, string>; berkas: BerkasIsi[] } {
  const origin = asalTujuan(p.targetOrigin);
  pastikanTujuanBoleh(rt, p.ownerId, origin, p.kodeWilayah);
  rt.akun.pakaiIzin(p.token, {
    userId: p.ownerId,
    writeListHash: hashIkatan(p.writeList, p.rencanaHash),
    targetOrigin: origin,
  });
  const data = rt.akun.vault.getDataDiri(p.ownerId)?.data ?? {};
  const nilai: Record<string, string> = {};
  const berkas: BerkasIsi[] = [];
  const docs = rt.akun.vault.listDocuments(p.ownerId);
  for (const field of new Set(p.writeList)) {
    if (field.startsWith(AWALAN_BERKAS)) {
      const nama = field.slice(AWALAN_BERKAS.length);
      const meta = docs.find((d) => d.jenis === nama.toLowerCase());
      const d = meta && rt.akun.vault.getDocument(p.ownerId, meta.id);
      if (d) berkas.push({ nama, judul: d.meta.judul, mime: d.meta.mime, bytes: d.bytes });
      continue;
    }
    const v = data[field];
    if (typeof v === 'string' && v !== '') nilai[field] = v;
  }
  return { nilai, berkas };
}

/** Seperti `resolusiIsi`, hanya nilai Data Diri. */
export function resolusiNilai(
  rt: Runtime,
  p: { ownerId: string; token: string; writeList: readonly string[]; targetOrigin: string } & KonteksIzin,
): Record<string, string> {
  return resolusiIsi(rt, p).nilai;
}
