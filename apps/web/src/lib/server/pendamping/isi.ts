import { AkunError, type Akun } from '@urusin/akun';
import { entriAnak, kolomDari, labelPlaceholder } from '#lib/pendamping/isi-data.js';
import type { Runtime } from '#lib/server/runtime.js';
import {
  AWALAN_BERKAS,
  dataIsian,
  izinkanIsi,
  resolusiIsi,
  type BerkasIsi,
} from '#lib/server/vault/resolver.js';

/**
 * Jalur isi Pendamping (A-M1): SATU-SATUNYA pemanggil penyelesai nilai PII. Peramban hanya mengirim
 * `{writeList, targetOrigin}` (POST /api/urusan/[id]/izinkan-isi); nilai vault tidak pernah lewat peramban.
 *
 * 1. "Izinkan isi" → `izinkanIsiUrusan`: peminta harus pemilik urusan; daftar write = placeholder adapter
 *    (`{{PEMOHON.NIK}}`) dan `berkas:<JENIS>`. Token persetujuan (sekali pakai, 5 menit) DISIMPAN DI SERVER
 *    per urusan, tidak dikirim ke peramban.
 * 2. Pendamping, saat halaman tujuan terbuka → `ambilIsianUntukIsi(urusanId, liveOrigin)`: origin halaman hidup
 *    harus persis `targetOrigin`; persetujuan dipakai sekali; nilai + berkas diketik lewat kanal internal saja
 *    (tidak dicatat, tidak ke model, tidak ke peramban). Disambungkan ke controller saat merge pendamping.
 */

export type Peminta = { akun?: Akun | undefined; sid?: string | undefined };

type Persetujuan = {
  ownerId: string;
  token: string;
  writeList: readonly string[];
  fields: string[];
  targetOrigin: string;
  /** Wilayah KTP urusan (sudah ditetapkan warga): portal wilayah ini boleh menjadi tujuan. */
  kodeWilayah: string | null;
  /** Navigator generik: persetujuan untuk rencana halaman ini saja. */
  rencanaHash?: string | undefined;
};

/** Persetujuan tertunda per urusan (proses tunggal; hilang saat restart = warga menekan "Izinkan isi" lagi). */
const tertunda = new Map<string, Persetujuan>();

const MAKS_ENTRI = 60;

const asal = (u: string): string => {
  try {
    return new URL(u).origin;
  } catch {
    throw new AkunError('IZIN_TIDAK_VALID');
  }
};

/** Placeholder → field Data Diri; `berkas:<JENIS>` apa adanya. Entri tak dikenal ditolak. */
function fieldDari(writeList: readonly string[]): string[] {
  if (writeList.length === 0 || writeList.length > MAKS_ENTRI) throw new AkunError('IZIN_TIDAK_VALID');
  const fields = new Set<string>();
  for (const w of writeList) {
    if (/^berkas:[A-Z][A-Z0-9_]{0,39}$/.test(w) || entriAnak(w)) fields.add(w);
    else {
      const k = kolomDari(w);
      if (!k) throw new AkunError('IZIN_TIDAK_VALID');
      fields.add(k);
    }
  }
  return [...fields];
}

/**
 * Persetujuan "Izinkan isi" untuk urusan `urusanId`. Mengembalikan label data yang tidak ada di Data Diri
 * (warga mengisinya sendiri di layar); TIDAK mengembalikan nilai.
 */
export function izinkanIsiUrusan(
  rt: Runtime,
  p: {
    urusanId: string;
    peminta: Peminta;
    writeList: readonly string[];
    targetOrigin: string;
    rencanaHash?: string | undefined;
  },
): { kurang: string[] } {
  const ownerId = rt.akun.pemilikVaultUrusan(p.urusanId, p.peminta);
  if (!ownerId) throw new AkunError('IZIN_TIDAK_VALID');
  const fields = fieldDari(p.writeList);
  const targetOrigin = asal(p.targetOrigin);
  const kodeWilayah = rt.store.getUrusan(p.urusanId)?.kodeKabKota ?? null;
  const token = izinkanIsi(rt, ownerId, fields, targetOrigin, { kodeWilayah, rencanaHash: p.rencanaHash });
  tertunda.set(p.urusanId, {
    ownerId,
    token,
    writeList: p.writeList,
    fields,
    targetOrigin,
    kodeWilayah,
    rencanaHash: p.rencanaHash,
  });
  const data = dataIsian(rt, ownerId, p.writeList, kodeWilayah);
  const jenisAda = new Set(rt.akun.vault.listDocuments(ownerId).map((d) => d.jenis));
  const kurang: string[] = [];
  for (const w of p.writeList) {
    if (w.startsWith(AWALAN_BERKAS)) {
      if (!jenisAda.has(w.slice(AWALAN_BERKAS.length).toLowerCase()))
        kurang.push(w.slice(AWALAN_BERKAS.length));
    } else if (!entriAnak(w)) {
      const v = data[kolomDari(w)!];
      if (typeof v !== 'string' || v === '') kurang.push(labelPlaceholder(w));
    }
  }
  return { kurang };
}

/**
 * Dipanggil controller Pendamping saat halaman tujuan terbuka. `liveOrigin` = URL/origin halaman yang sedang
 * dimuat Chromium; `rencanaHash` = rencana halaman yang sedang menunggu persetujuan di worker (Navigator
 * generik), harus sama dengan yang disetujui warga. Persetujuan dipakai sekali (juga bila origin/hash salah).
 */
export function ambilIsianUntukIsi(
  rt: Runtime,
  p: { urusanId: string; liveOrigin: string; rencanaHash?: string | undefined },
): { isian: Record<string, string>; berkas: BerkasIsi[] } {
  const s = tertunda.get(p.urusanId);
  tertunda.delete(p.urusanId);
  if (!s || asal(p.liveOrigin) !== s.targetOrigin || p.rencanaHash !== s.rencanaHash)
    throw new AkunError('IZIN_TIDAK_VALID');
  const { nilai, berkas } = resolusiIsi(rt, {
    ownerId: s.ownerId,
    token: s.token,
    writeList: s.fields,
    targetOrigin: s.targetOrigin,
    kodeWilayah: s.kodeWilayah,
    rencanaHash: s.rencanaHash,
  });
  const isian: Record<string, string> = {};
  for (const w of s.writeList) {
    const k = w.startsWith(AWALAN_BERKAS) ? undefined : kolomDari(w);
    if (k && nilai[k]) isian[w] = nilai[k];
  }
  return { isian, berkas };
}
