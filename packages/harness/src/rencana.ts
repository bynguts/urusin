import { randomUUID } from 'node:crypto';
import { ADAPTERS } from '@urusin/adapters';
import type { EventPayload, UrusanState } from '@urusin/contracts';
import { getOfficialDomain, ketersediaanLayanan, type AlternatifOffline } from '@urusin/core';
import {
  bundelPendamping,
  findBundel,
  namaPendekWilayah,
  routeByKode,
  varianDisebut,
  wilayahByKode,
} from '@urusin/registry';
import { ConflictError, HarnessError } from './errors.js';
import { ADAPTER_GENERIK, alasanDipandu, portalWebWilayah } from './generik.js';
import { ADMINDUK } from './grounding.js';
import { canTransition } from './state.js';
import { pendampingAktif } from '@urusin/registry';
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
  /** Tier yang sudah dibekukan (satu keputusan rute); tanpa ini dihitung dari urusan saat ini. */
  tier?: 'semi' | 'dipandu' | null,
): UrusanRow {
  let cur = u;
  for (const ke of jalur) {
    const dari = cur.state;
    cur = store.transition(cur.id, cur.version, ke);
    publish({
      type: 'state',
      state: ke,
      tier: tier !== undefined ? tier : tierUrusan(urusanRute(store, cur)),
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

/**
 * `sebab: 'jaringan_id'`: portal hanya menerima IP Indonesia (registry `aksesWilayah: 'id-only'`) dan tidak ada
 * worker berjaringan Indonesia yang sehat; kartu rencana menyebut alasan itu sejak awal. `sebab: 'pengembangan'`:
 * wilayah di luar `DAERAH_PENDAMPING_AKTIF` (ADR 0033), Browser Pendamping-nya sedang dikembangkan.
 */
export type RutePendamping =
  | LangkahTulisPendamping
  | { jalur: 'dipandu'; alasan: string; sebab?: 'jaringan_id' | 'pengembangan' }
  | {
      jalur: 'dipandu';
      alasan: string;
      /**
       * Peta portal (ADR 0034): layanan/varian ini tidak bisa diajukan online di portal daerah aktif. `alternatif`
       * = jalur resmi yang benar (loket/TPDK, aplikasi lain), bukan Browser Pendamping.
       */
      sebab: 'offline_portal';
      offline: { alasan: string; alternatif: AlternatifOffline };
    };

/** Urusan untuk keputusan rute: jenis, wilayah KTP, dan varian layanan yang disebut warga (bila ada). */
export type UrusanRute = Pick<UrusanRow, 'jenis' | 'kodeKabKota'> & { varian?: string | undefined };

/** Varian layanan yang disebut warga di urusan ini (pesan warga terbaru yang menyebut varian menentukan). */
export function varianUrusan(store: HarnessStore, u: Pick<UrusanRow, 'id' | 'jenis'>): string | undefined {
  return u.jenis ? varianDisebut(u.jenis, store.pesanWarga(u.id)) : undefined;
}

/** Urusan + varian dari pesan warga: masukan `rutePendamping` yang sama di kartu, catatan state, dan persetujuan. */
export function urusanRute(store: HarnessStore, u: UrusanRow): UrusanRute {
  const varian = varianUrusan(store, u);
  return { jenis: u.jenis, kodeKabKota: u.kodeKabKota, ...(varian ? { varian } : {}) };
}

/** Kalimat jujur untuk warga: layanan ini tidak online di portal daerah, lalu jalur resmi yang benar. */
export function kalimatOfflinePortal(o: { alasan: string; alternatif: AlternatifOffline }): string {
  return `${o.alasan} ${o.alternatif.teks} Browser Pendamping tidak dibuka untuk urusan ini; Urusin memandu langkahnya bersama Anda.`;
}

/**
 * Ada worker Browser Pendamping berjaringan Indonesia (`region: 'id'`) yang sehat? Dipasang web (hooks.server) dengan
 * pool dan cache singkat yang sama dengan pemilihan worker sesi. Bawaan `false`: tanpa worker Indonesia yang
 * terbukti sehat, portal `id-only` tidak dijanjikan (dipandu sejak kartu, bukan gagal saat mulai).
 */
let jaringanIdSiap: () => boolean = () => false;

/** Pasang pemeriksa worker berjaringan Indonesia (web: hooks.server); uji memasang nilai tetap. */
export function aturJaringanId(cek: () => boolean): void {
  jaringanIdSiap = cek;
}

/** Kalimat jujur untuk warga: portal `id-only` tanpa Browser Pendamping berjaringan Indonesia. */
export function kalimatJaringanId(wilayah?: string): string {
  const di = wilayah ? ` ${wilayah}` : '';
  return `Situs Disdukcapil${di} hanya bisa dibuka dari jaringan Indonesia, dan Browser Pendamping berjaringan Indonesia sedang tidak aktif, jadi AI belum bisa mengisinya. Anda membuka situsnya sendiri dan kami pandu langkahnya.`;
}

function hanyaJaringanId(origin: string): boolean {
  try {
    return getOfficialDomain(new URL(origin).hostname)?.aksesWilayah === 'id-only';
  } catch {
    return false;
  }
}

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
 * WILAYAH_BELUM_DITETAPKAN tetap berlaku di tool rencana). Portal `id-only` hanya ditawarkan bila ada worker
 * berjaringan Indonesia yang sehat (`aturJaringanId`); selain itu dipandu dengan `sebab: 'jaringan_id'`.
 */
export function rutePendamping(u: UrusanRute): RutePendamping {
  const kode = u.kodeKabKota && /^\d{4}$/.test(u.kodeKabKota) ? u.kodeKabKota : null;
  // Layanan non-adminduk (Samsat, bansos, LAPOR!) tidak lewat Disdukcapil: alasan portal Dukcapil tidak berlaku.
  if (!kode || (u.jenis && !ADMINDUK.has(u.jenis))) return { jalur: 'dipandu', alasan: alasanDipandu(null) };
  const w = wilayahByKode(kode);
  const nama = w ? namaPendekWilayah(w.nama) : undefined;
  // Pendamping hanya di daerah yang dijamin (ADR 0033); daerah lain dipandu, Pendamping-nya "sedang dikembangkan".
  if (!pendampingAktif(kode))
    return { jalur: 'dipandu', alasan: alasanDipandu(kode, nama), sebab: 'pengembangan' };
  // Peta portal (ADR 0034): layanan/varian yang tidak ada online di portal daerah ini tidak membuka Pendamping.
  const peta = ketersediaanLayanan(kode, u.jenis, u.varian);
  if (peta.dipetakan && !peta.online) {
    const offline = { alasan: peta.alasan, alternatif: peta.alternatif };
    return {
      jalur: 'dipandu',
      alasan: `Rencana disetujui. ${kalimatOfflinePortal(offline)}`,
      sebab: 'offline_portal',
      offline,
    };
  }
  const r = ruteDasar(u.jenis, kode, nama, peta.dipetakan ? peta.jalurMasuk : undefined);
  if (r.jalur !== 'dipandu' && hanyaJaringanId(r.origin) && !jaringanIdSiap())
    return {
      jalur: 'dipandu',
      alasan: `Rencana disetujui. ${kalimatJaringanId(nama)}`,
      sebab: 'jaringan_id',
    };
  return r;
}

function ruteDasar(
  jenis: UrusanRow['jenis'],
  kode: string,
  nama: string | undefined,
  /** Jalur awal sesi dari peta portal (langsung ke halaman masuk/formulir layanan), bila dipetakan. */
  jalurPeta?: string,
): RutePendamping {
  const adapter = langkahAdapter({ jenis, kodeKabKota: kode });
  if (adapter) return adapter;
  // Peristiwa Hidup atau layanan adminduk umum (KTP-el, KK, KIA, akta): semuanya punya bundel tujuan Navigator.
  const bundel = jenis ? bundelPendamping(jenis) : undefined;
  const portal = portalWebWilayah(kode);
  if (bundel && portal)
    return {
      jalur: 'generik',
      adapterId: ADAPTER_GENERIK,
      flowId: bundel.slug,
      // Jalur masuk portal (mis. `/Siap_Om`, `/login`). Host sesi tidak dikirim: worker memakai bawaan wilayah
      // `kode` (host portal + platform + host tantangan sesuai proteksi portal), satu sumber dengan registry.
      params: { jenis: bundel.slug, kode, jalur: jalurPeta ?? new URL(portal.url).pathname },
      origin: portal.origin,
      nama: `Ajukan ${bundel.frasa} di portal resmi Disdukcapil ${nama ?? portal.nama}`,
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
export function tierUrusan(
  u: UrusanRute,
  /** Rute yang sudah diputuskan untuk urusan ini (supaya tier dan tindakan dari satu keputusan yang sama). */
  rute?: RutePendamping,
): 'semi' | 'dipandu' | null {
  const kode = u.kodeKabKota && /^\d{4}$/.test(u.kodeKabKota) ? u.kodeKabKota : null;
  if (!kode) return null;
  if (!u.jenis) return routeByKode(kode).entry.tier;
  return (rute ?? rutePendamping({ jenis: u.jenis, kodeKabKota: kode, varian: u.varian })).jalur === 'dipandu'
    ? 'dipandu'
    : 'semi';
}

/**
 * Tier yang dibekukan untuk eksekusi yang sedang berjalan: tier event `state` terakhir (diterbitkan saat
 * eksekusi ditawarkan), bukan kesehatan worker berjaringan Indonesia saat ini. Tanpa event = dihitung ulang.
 */
export function tierEksekusi(store: HarnessStore, u: UrusanRow): 'semi' | 'dipandu' | null {
  const p = store.eventsOfType(u.id, 'state', 1)[0]?.payload;
  const t = p !== null && typeof p === 'object' && 'tier' in p ? p.tier : undefined;
  return t === 'semi' || t === 'dipandu' || t === null ? t : tierUrusan(urusanRute(store, u));
}

/**
 * Langkah rencana yang bisa dikerjakan Browser Pendamping untuk urusan ini (adapter atau Navigator generik),
 * atau undefined bila dipandu.
 */
export function langkahPendamping(u: UrusanRute): LangkahTulisPendamping | undefined {
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
  // Satu keputusan rute untuk seluruh persetujuan: tier di event state dan tindakan tidak bisa berbeda walau
  // kesehatan worker berjaringan Indonesia berubah di tengah jalan.
  const jalan = rutePendamping(urusanRute(store, u));
  const tier = tierUrusan(u, jalan);
  let cur = majukan(store, u, ['RENCANA_DISETUJUI'], publish, tier);
  if (jalan.jalur === 'dipandu') {
    // Pesan tetap untuk warga, bukan progres: klik ini bukan turn agen, jadi tidak ada `done` yang menutup progres
    // (dulu `sedangBerjalan` di web tertahan sampai turn chat berikutnya).
    publish({ type: 'assistant_text', delta: jalan.alasan, utuh: true });
    return { urusan: cur, executionId: null };
  }
  // Pembukuan tabel state: MENYIAPKAN_BERKAS/BERKAS_SIAP/MENGISI dilewati dalam satu langkah sinkron sebelum berkas
  // diperiksa dan sebelum situs dibuka. Bukan kejadian nyata: linimasa web tidak menurunkan kalimat dari ketiganya.
  cur = majukan(
    store,
    cur,
    ['MENYIAPKAN_BERKAS', 'BERKAS_SIAP', 'MENGISI', 'MENUNGGU_KONFIRMASI'],
    publish,
    tier,
  );
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
  return majukan(store, u, ['MENGUNGGAH', 'MENUNGGU_SUBMIT_WARGA'], publish, tierEksekusi(store, u));
}
