import { randomUUID } from 'node:crypto';
import { ADAPTERS } from '@urusin/adapters';
import type { EventPayload, UrusanState } from '@urusin/contracts';
import { findBundel, namaPendekWilayah, routeByKode, wilayahByKode } from '@urusin/registry';
import { ConflictError, HarnessError } from './errors.js';
import { ADAPTER_GENERIK, alasanDipandu, portalWebWilayah } from './generik.js';
import { canTransition } from './state.js';
import { paramsHash, type HarnessStore, type UrusanRow } from './store.js';
import { wilayahBelumSiap, wilayahUrusan } from './wilayah.js';

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
    publish({
      type: 'state',
      state: ke,
      tier: tierUrusan(cur),
      version: cur.version,
      dari,
    });
  }
  return cur;
}

/** Langkah tulis yang dikerjakan Browser Pendamping: adapter tulisan tangan atau Navigator generik. */
export type LangkahTulisPendamping = {
  jalur: 'adapter' | 'generik';
  adapterId: string;
  flowId: string;
  params: Record<string, string | number | boolean>;
  origin: string;
  nama: string;
};

export type RutePendamping = LangkahTulisPendamping | { jalur: 'dipandu'; alasan: string };

/** Adapter tulisan tangan (jalur cepat): langkah `online-adapter` bundel di portal `kirim-asli` kota ini. */
function langkahAdapter(u: Pick<UrusanRow, 'jenis' | 'kodeKabKota'>): LangkahTulisPendamping | undefined {
  if (!u.jenis || !u.kodeKabKota) return undefined;
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
    jalur: 'adapter',
    adapterId: entry.adapterId,
    flowId: langkah.pendamping.flowId,
    params: langkah.pendamping.params,
    origin: adapter.origin,
    nama: `${langkah.judul} di ${entry.portal.nama}`,
  };
}

/**
 * Routing Browser Pendamping (ADR 0030), berurutan: (1) adapter tulisan tangan, (2) adapter platform (belum
 * ada), (3) Navigator generik bila wilayah KTP punya portal `web` di registry wilayah, (4) dipandu dengan
 * alasan jujur. Wilayah harus SUDAH ditetapkan warga (`kodeKabKota`); tanpa itu selalu dipandu (gerbang
 * WILAYAH_BELUM_DITETAPKAN tetap berlaku di tool rencana).
 */
export function rutePendamping(u: Pick<UrusanRow, 'jenis' | 'kodeKabKota'>): RutePendamping {
  const kode = u.kodeKabKota && /^\d{4}$/.test(u.kodeKabKota) ? u.kodeKabKota : null;
  if (!kode) return { jalur: 'dipandu', alasan: alasanDipandu(null) };
  const adapter = langkahAdapter({ jenis: u.jenis, kodeKabKota: kode });
  if (adapter) return adapter;
  const w = wilayahByKode(kode);
  const nama = w ? namaPendekWilayah(w.nama) : undefined;
  const bundel = u.jenis ? findBundel(u.jenis) : undefined;
  const portal = portalWebWilayah(kode);
  if (bundel && portal)
    return {
      jalur: 'generik',
      adapterId: ADAPTER_GENERIK,
      flowId: bundel.slug,
      // Jalur masuk portal (mis. `/Siap_Om`, `/login`). Host sesi tidak dikirim: worker memakai bawaan wilayah
      // `kode` (host portal + platform + host tantangan sesuai proteksi portal), satu sumber dengan registry.
      params: { jenis: bundel.slug, kode, jalur: new URL(portal.url).pathname },
      origin: portal.origin,
      nama: `Ajukan ${bundel.judul.toLowerCase()} di portal resmi Disdukcapil ${nama ?? portal.nama}`,
    };
  return { jalur: 'dipandu', alasan: alasanDipandu(kode, nama) };
}

/** Kalimat templat untuk warga: apa yang dikerjakan AI di portal ini dan apa yang tetap dikerjakan warga. */
export function keteranganPendamping(r: LangkahTulisPendamping): string {
  const host = new URL(r.origin).host;
  return r.jalur === 'generik'
    ? `AI membantu mengisi formulir di ${host}; Anda sendiri yang masuk akun, lolos verifikasi, dan menekan Kirim.`
    : `AI mengisi formulir di ${host}; Anda sendiri yang masuk akun dan menekan Kirim.`;
}

/**
 * Tier urusan yang JUJUR: `semi` hanya bila Browser Pendamping benar-benar akan ditawarkan untuk urusan ini
 * (adapter atau Navigator generik, lihat `rutePendamping`). Jenis belum diketahui: tier registry kota.
 */
export function tierUrusan(u: Pick<UrusanRow, 'jenis' | 'kodeKabKota'>): 'semi' | 'dipandu' | null {
  const kode = u.kodeKabKota && /^\d{4}$/.test(u.kodeKabKota) ? u.kodeKabKota : null;
  if (!kode) return null;
  if (!u.jenis) return routeByKode(kode).entry.tier;
  return rutePendamping({ jenis: u.jenis, kodeKabKota: kode }).jalur === 'dipandu' ? 'dipandu' : 'semi';
}

/**
 * Langkah rencana yang bisa dikerjakan Browser Pendamping untuk urusan ini (adapter atau Navigator generik),
 * atau undefined bila dipandu.
 */
export function langkahPendamping(
  u: Pick<UrusanRow, 'jenis' | 'kodeKabKota'>,
): LangkahTulisPendamping | undefined {
  const r = rutePendamping(u);
  return r.jalur === 'dipandu' ? undefined : r;
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
  // Rencana hanya disetujui untuk wilayah yang dipastikan warga (urusan lama berkolom default tanpa konfirmasi).
  const belum = wilayahBelumSiap(u.jenis, wilayahUrusan(store, u));
  if (belum) throw new HarnessError('WILAYAH_BELUM_DITETAPKAN', belum, 409);
  let cur = majukan(store, u, ['RENCANA_DISETUJUI'], publish);
  const jalan = rutePendamping(cur);
  if (jalan.jalur === 'dipandu') {
    publish({ type: 'progress', label: jalan.alasan });
    return { urusan: cur, executionId: null };
  }
  cur = majukan(store, cur, ['MENYIAPKAN_BERKAS', 'BERKAS_SIAP', 'MENGISI', 'MENUNGGU_KONFIRMASI'], publish);
  const args = {
    kodeKabKota: cur.kodeKabKota,
    layananId: jalan.jalur === 'generik' ? jalan.params.jenis : jalan.params.layanan_id,
  };
  const hash = paramsHash(TOOL_AJUKAN, args);
  const executionId = `x_${randomUUID()}`;
  publish({
    type: 'execution_request',
    executionId,
    adapterId: jalan.adapterId,
    flowId: jalan.flowId,
    ringkasan:
      jalan.jalur === 'generik'
        ? `${jalan.nama}. AI mengisi formulir hanya dengan data yang Anda izinkan per halaman; Anda masuk akun (sandi, CAPTCHA) dan menekan Kirim sendiri.`
        : `${jalan.nama}. AI mengunggah Dokumen Anda; Anda masuk akun (sandi, CAPTCHA) dan menekan Selesai sendiri.`,
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
