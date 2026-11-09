import { randomUUID } from 'node:crypto';
import { ADAPTERS } from '@urusin/adapters';
import type { EventPayload, UrusanState } from '@urusin/contracts';
import { findBundel, routeByKode } from '@urusin/registry';
import { ConflictError } from './errors.js';
import { canTransition } from './state.js';
import { paramsHash, type HarnessStore, type UrusanRow } from './store.js';

type Publish = (e: EventPayload) => void;

/** Tool yang tercatat pada permintaan eksekusi pengajuan (sama dengan tool tulis agen). */
export const TOOL_AJUKAN = 'dukcapil__ajukan_layanan';

/**
 * Majukan urusan melewati `jalur` (urutan state maju yang sah) dan terbitkan event `state` per langkah.
 * Setiap transisi dicek versi oleh store (turn lain yang sedang menulis → ConflictError).
 */
export function majukan(
  store: HarnessStore,
  u: UrusanRow,
  jalur: readonly UrusanState[],
  publish: Publish,
): UrusanRow {
  let cur = u;
  for (const ke of jalur) {
    const dari = cur.state;
    cur = store.transition(cur.id, cur.version, ke);
    const kode = cur.kodeKabKota;
    publish({
      type: 'state',
      state: ke,
      tier: kode && /^\d{4}$/.test(kode) ? routeByKode(kode).entry.tier : null,
      version: cur.version,
      dari,
    });
  }
  return cur;
}

/**
 * Langkah rencana yang bisa dikerjakan Browser Pendamping di portal kota ini: langkah `online-adapter` bundel,
 * kota berstatus `kirim-asli` dengan adapter yang punya alur tersebut (bukan baca-saja). Selain itu undefined.
 */
export function langkahPendamping(u: Pick<UrusanRow, 'jenis' | 'kodeKabKota'>):
  | {
      adapterId: string;
      flowId: string;
      params: Record<string, string | number | boolean>;
      origin: string;
      nama: string;
    }
  | undefined {
  if (!u.jenis || !u.kodeKabKota || !/^\d{4}$/.test(u.kodeKabKota)) return undefined;
  const bundel = findBundel(u.jenis);
  const langkah = bundel?.langkah.find((l) => l.jenis === 'online-adapter' && l.pendamping);
  if (!bundel || !langkah?.pendamping) return undefined;
  if (bundel.kodeWilayah !== null && bundel.kodeWilayah !== u.kodeKabKota) return undefined;
  const { entry } = routeByKode(u.kodeKabKota);
  if (entry.tier === 'dipandu' || entry.validasi !== 'kirim-asli' || !entry.adapterId || !entry.portal)
    return undefined;
  const adapter = Object.hasOwn(ADAPTERS, entry.adapterId) ? ADAPTERS[entry.adapterId] : undefined;
  const flow =
    adapter && Object.hasOwn(adapter.flows, langkah.pendamping.flowId)
      ? adapter.flows[langkah.pendamping.flowId]
      : undefined;
  if (!adapter || !flow || flow.bacaSaja || adapter.origin !== entry.portal.origin) return undefined;
  return {
    adapterId: entry.adapterId,
    flowId: langkah.pendamping.flowId,
    params: langkah.pendamping.params,
    origin: adapter.origin,
    nama: `${langkah.judul} di ${entry.portal.nama}`,
  };
}

/**
 * Warga menekan "Setujui rencana" (aksi terstruktur, bukan teks bebas yang ditafsirkan model). Deterministik:
 * RENCANA_DIUSULKAN → RENCANA_DISETUJUI. Bila langkah rencana bisa dikerjakan Browser Pendamping di portal kota
 * ini, urusan maju sampai MENUNGGU_KONFIRMASI dan permintaan eksekusi + gerbang konfirmasi ditawarkan (warga
 * masih harus menekan "Setujui dan buka situs"; login, CAPTCHA, dan Selesai tetap di tangan warga). Selain itu
 * urusan berhenti di RENCANA_DISETUJUI dan warga mengikuti langkah sendiri.
 */
export function setujuiRencana(
  store: HarnessStore,
  urusanId: string,
  publish: Publish,
  expectedVersion?: number,
): { urusan: UrusanRow; executionId: string | null } {
  const u = store.getUrusanOrThrow(urusanId);
  if (u.state !== 'RENCANA_DIUSULKAN' || (expectedVersion !== undefined && expectedVersion !== u.version))
    throw new ConflictError();
  let cur = majukan(store, u, ['RENCANA_DISETUJUI'], publish);
  const jalan = langkahPendamping(cur);
  if (!jalan) {
    publish({
      type: 'progress',
      label:
        'Rencana disetujui. Situs ini belum bisa dibantu Browser Pendamping; ikuti langkahnya bersama saya.',
    });
    return { urusan: cur, executionId: null };
  }
  cur = majukan(store, cur, ['MENYIAPKAN_BERKAS', 'BERKAS_SIAP', 'MENGISI', 'MENUNGGU_KONFIRMASI'], publish);
  const args = { kodeKabKota: cur.kodeKabKota, layananId: jalan.params.layanan_id };
  const hash = paramsHash(TOOL_AJUKAN, args);
  const executionId = `x_${randomUUID()}`;
  publish({
    type: 'execution_request',
    executionId,
    adapterId: jalan.adapterId,
    flowId: jalan.flowId,
    ringkasan: `${jalan.nama}. AI mengunggah Dokumen Anda; Anda masuk akun (sandi, CAPTCHA) dan menekan Selesai sendiri.`,
    params: jalan.params,
    tool: TOOL_AJUKAN,
    paramsHash: hash,
    origin: jalan.origin,
  });
  // Gerbang SESUDAH permintaan: kartu konfirmasi menemukannya lewat paramsHash.
  publish({
    type: 'gate',
    jenis: 'konfirmasi',
    pesan: 'Izinkan Browser Pendamping membuka situs resmi dan mengisi pengajuan ini?',
    tool: TOOL_AJUKAN,
    paramsHash: hash,
  });
  return { urusan: cur, executionId };
}

/**
 * Browser Pendamping mulai mengerjakan pengajuan (bukan baca-saja): MENUNGGU_KONFIRMASI → MENGUNGGAH →
 * MENUNGGU_SUBMIT_WARGA, supaya laporan `berhasil` (warga menekan Selesai) sah menjadi TERKIRIM.
 */
export function mulaiPengajuan(store: HarnessStore, urusanId: string, publish: Publish): UrusanRow {
  const u = store.getUrusanOrThrow(urusanId);
  if (u.state !== 'MENUNGGU_KONFIRMASI' || !canTransition(u.state, 'MENGUNGGAH')) return u;
  return majukan(store, u, ['MENGUNGGAH', 'MENUNGGU_SUBMIT_WARGA'], publish);
}
