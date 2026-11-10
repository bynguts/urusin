import { ADAPTERS } from '@urusin/adapters';
import type { EventPayload, PayloadOf, WilayahRef } from '@urusin/contracts';
import { cariPengetahuanTool } from '@urusin/rag';
import {
  kanalWilayah,
  namaPendekWilayah,
  rencanaWilayah,
  wilayahByKode,
  type CityEntry,
  type Langkah,
  type RencanaWilayah,
} from '@urusin/registry';
import type { Db } from './db.js';
import { HarnessError } from './errors.js';
import { keteranganPendamping, majukan, rutePendamping } from './rencana.js';
import type { HarnessStore, UrusanRow } from './store.js';

type Publish = (e: EventPayload) => void;
type PayloadWilayah = PayloadOf<'wilayah'>;

/**
 * Keadaan wilayah satu urusan. `ktp` = wilayah KTP yang SUDAH dipastikan warga (kolom `kode_kabkota`); domisili
 * dan tujuan diambil dari event `wilayah` ditetapkan terakhir; `usulan` = kandidat dari Data Diri/pemilih
 * perangkat yang belum dikonfirmasi. Tidak ada default diam-diam: tanpa konfirmasi, `ktp` null.
 */
export type WilayahUrusan = {
  ktp: WilayahRef | null;
  domisili: WilayahRef | null;
  tujuan: WilayahRef | null;
  usulan: { ktp: WilayahRef; sumber: 'data_diri' | 'pilihan' } | null;
};

export function refWilayah(kode: string): WilayahRef | null {
  const w = wilayahByKode(kode);
  return w ? { kodeKabKota: w.kodeKabKota, nama: w.nama } : null;
}

export function wilayahUrusan(store: HarnessStore, u: UrusanRow): WilayahUrusan {
  const events = store.eventsOfType(u.id, 'wilayah', 20).map((e) => e.payload as PayloadWilayah);
  const ditetapkan = events.find((e) => e.status === 'ditetapkan');
  const usulan = events.find((e) => e.status === 'usulan');
  const ktp = u.kodeKabKota ? refWilayah(u.kodeKabKota) : null;
  const cocok = ditetapkan && ktp && ditetapkan.ktp.kodeKabKota === ktp.kodeKabKota;
  return {
    ktp,
    domisili: cocok ? (ditetapkan.domisili ?? null) : null,
    tujuan: cocok ? (ditetapkan.tujuan ?? null) : null,
    usulan: usulan && usulan.sumber !== 'warga' ? { ktp: usulan.ktp, sumber: usulan.sumber } : null,
  };
}

/** Kode yang dipakai pendeteksi PII (NIK terpecah): wilayah KTP, atau usulannya bila belum ditetapkan. */
export function kodeUntukPii(store: HarnessStore, u: UrusanRow | undefined): string | null {
  if (!u) return null;
  return u.kodeKabKota ?? wilayahUrusan(store, u).usulan?.ktp.kodeKabKota ?? null;
}

/** Alasan rencana belum boleh diusulkan; undefined = siap. Pindah butuh asal (KTP) DAN tujuan. */
export function wilayahBelumSiap(jenis: string | null, w: WilayahUrusan): string | undefined {
  if (!w.ktp)
    return 'wilayah KTP warga belum ditetapkan: tanyakan kab/kota sesuai KTP lalu panggil wilayah__tetapkan';
  if (jenis === 'pindah' && !w.tujuan)
    return 'urusan pindah butuh kab/kota tujuan: tanyakan lalu panggil wilayah__tetapkan dengan tujuan';
  return undefined;
}

/** Catat usulan wilayah (Data Diri atau pemilih perangkat). Tidak mengubah urusan: warga tetap harus memastikan. */
export function usulkanWilayah(
  urusanId: string,
  kode: string,
  sumber: 'data_diri' | 'pilihan',
  publish: Publish,
): boolean {
  const ktp = refWilayah(kode);
  if (!ktp) return false;
  publish({ type: 'wilayah', status: 'usulan', ktp, sumber });
  return true;
}

export type InputWilayah = {
  ktp: string;
  domisili?: string | null | undefined;
  tujuan?: string | null | undefined;
};

/**
 * Tetapkan wilayah KTP (+ domisili/tujuan) urusan: CAS pada `kode_kabkota`, lalu event `wilayah` ditetapkan
 * (jejak audit). Bila rencana sudah diusulkan untuk wilayah lain, urusan kembali ke MEMAHAMI agar rencana
 * disusun ulang. Hanya sebelum rencana disetujui.
 */
export function tetapkanWilayah(
  store: HarnessStore,
  u: UrusanRow,
  input: InputWilayah,
  publish: Publish,
): UrusanRow {
  const ktp = refWilayah(input.ktp);
  if (!ktp) throw new HarnessError('WILAYAH_TIDAK_DIKENAL', 'kode kab/kota tidak dikenal', 422);
  const ref = (k: string | null | undefined) => (k ? refWilayah(k) : null);
  const domisili = ref(input.domisili);
  const tujuan = ref(input.tujuan);
  if (!['BARU', 'MEMAHAMI', 'RENCANA_DIUSULKAN'].includes(u.state))
    throw new HarnessError('WILAYAH_TERKUNCI', 'wilayah tidak bisa diubah setelah rencana disetujui', 409);
  const sebelum = wilayahUrusan(store, u);
  let cur = store.setKodeKabKota(u.id, u.version, ktp.kodeKabKota);
  publish({
    type: 'wilayah',
    status: 'ditetapkan',
    ktp,
    sumber: 'warga',
    ...(domisili && domisili.kodeKabKota !== ktp.kodeKabKota ? { domisili } : {}),
    ...(tujuan ? { tujuan } : {}),
  });
  const berubah =
    sebelum.ktp?.kodeKabKota !== ktp.kodeKabKota ||
    (sebelum.tujuan?.kodeKabKota ?? null) !== (tujuan?.kodeKabKota ?? null) ||
    (sebelum.domisili?.kodeKabKota ?? null) !== (domisili?.kodeKabKota ?? null);
  if (cur.state === 'RENCANA_DIUSULKAN' && berubah) cur = majukan(store, cur, ['MEMAHAMI'], publish);
  return cur;
}

/** Browser Pendamping sanggup mengerjakan langkah ini di portal kota: adapter ada, alur TULIS (bukan baca-saja). */
export function pendampingTersedia(entry: CityEntry, langkah: Langkah): boolean {
  if (!langkah.pendamping || entry.validasi !== 'kirim-asli' || !entry.adapterId || !entry.portal)
    return false;
  const adapter = Object.hasOwn(ADAPTERS, entry.adapterId) ? ADAPTERS[entry.adapterId] : undefined;
  const flow =
    adapter && Object.hasOwn(adapter.flows, langkah.pendamping.flowId)
      ? adapter.flows[langkah.pendamping.flowId]
      : undefined;
  return Boolean(adapter && flow && !flow.bacaSaja && adapter.origin === entry.portal.origin);
}

export type BantuanPendamping = { jalur: 'adapter' | 'generik'; host: string; keterangan: string };

/**
 * Rencana peristiwa yang benar untuk wilayah ini, dengan cek adapter sungguhan (dipakai harness dan web). Tier
 * mengikuti rute Browser Pendamping yang SAMA dengan yang ditawarkan saat rencana disetujui (`rutePendamping`):
 * wilayah web tanpa adapter yang dikerjakan Navigator generik = `semi` + keterangan templat, bukan `dipandu`.
 */
export function rencanaPeristiwa(
  slug: string,
  w: { ktp: string | null; domisili?: string | null; tujuan?: string | null },
): (RencanaWilayah & { pendamping?: BantuanPendamping }) | undefined {
  const r = rencanaWilayah(slug, { ...w, pendampingTersedia });
  if (!r || !w.ktp) return r;
  const rute = rutePendamping({ jenis: r.slug, kodeKabKota: w.ktp });
  if (rute.jalur === 'dipandu') return r;
  const pendamping: BantuanPendamping = {
    jalur: rute.jalur,
    host: new URL(rute.origin).host,
    keterangan: keteranganPendamping(rute),
  };
  if (rute.jalur === 'adapter') return { ...r, pendamping };
  return { ...r, tier: 'semi', catatan: `${r.catatan} ${pendamping.keterangan}`, pendamping };
}

/**
 * Sumber nasional/provinsi/wilayah dari korpus RAG (BM25 sinkron) untuk langkah pertama rencana. Filter wilayah
 * korpus hanya meloloskan chunk nasional, provinsi, atau kab/kota ini, jadi tidak ada sumber kota lain.
 */
function sumberKorpus(ragDb: Db | undefined, judul: string, kode: string) {
  if (!ragDb) return [];
  try {
    const out = cariPengetahuanTool.execute(ragDb, {
      query: `persyaratan ${judul.toLowerCase()}`,
      kodeKabKota: kode,
      layanan: 'adminduk',
      k: 3,
    });
    return out.hasil
      .filter((h) => h.kodeWilayah === null || kode.startsWith(h.kodeWilayah))
      .map((h) => ({ url: h.kutipan.url, judul: h.kutipan.judul, instansi: h.kutipan.instansi }));
  } catch {
    return [];
  }
}

/** Kartu rencana (event plan_card) untuk urusan ini; undefined bila jenisnya bukan Peristiwa Hidup. */
export function kartuRencana(
  jenis: string,
  w: WilayahUrusan,
  ragDb?: Db,
): PayloadOf<'plan_card'> | undefined {
  if (!w.ktp) return undefined;
  const r = rencanaPeristiwa(jenis, {
    ktp: w.ktp.kodeKabKota,
    domisili: w.domisili?.kodeKabKota ?? null,
    tujuan: w.tujuan?.kodeKabKota ?? null,
  });
  if (!r) return undefined;
  const korpus = r.khususWilayah ? [] : sumberKorpus(ragDb, r.judul, w.ktp.kodeKabKota);
  const ringkasan =
    r.slug === 'pindah' && w.tujuan
      ? `${r.judul} · ${namaPendekWilayah(w.ktp.nama)} → ${namaPendekWilayah(w.tujuan.nama)}`
      : `${r.judul} · ${namaPendekWilayah(w.ktp.nama)}`;
  return {
    ringkasan,
    langkah: r.langkah.map((l, i) => {
      const sumber = i === 0 ? [...l.sourceRef, ...korpus] : l.sourceRef;
      return {
        id: l.id,
        judul: l.judul,
        jenis: l.jenis,
        ...(l.lokasi ? { lokasi: l.lokasi } : {}),
        bawa: l.bawa,
        sumber: sumber.filter((s, j) => sumber.findIndex((x) => x.url === s.url) === j),
      };
    }),
    wilayah: {
      ktp: w.ktp,
      ...(w.domisili ? { domisili: w.domisili } : {}),
      ...(w.tujuan ? { tujuan: w.tujuan } : {}),
    },
    tier: r.tier,
    catatan: r.catatan,
    ...(r.pendamping ? { pendamping: r.pendamping } : {}),
  };
}

/** Kalimat kanal resmi wilayah untuk model/warga (tanpa kanal kota lain). */
export function kalimatKanal(kode: string): string {
  const k = kanalWilayah(kode);
  const nama = wilayahByKode(kode)?.nama ?? kode;
  return k.jenis === 'nasional'
    ? `${nama}: situs Disdukcapil belum terverifikasi; kanal nasional ${k.url}.`
    : `${nama}: kanal resmi ${k.judul} (${k.url}).`;
}

/**
 * Harness sendiri yang memajukan MEMAHAMI → RENCANA_DIUSULKAN begitu jenis peristiwa diketahui DAN wilayah siap
 * (KTP dipastikan warga; pindah juga tujuan). Tanpa wilayah: tidak ada rencana (gerbang di kode, bukan di prompt).
 */
export function usulkanRencanaOtomatis(
  store: HarnessStore,
  u: UrusanRow,
  publish: Publish,
  ragDb?: Db,
): UrusanRow {
  if (u.state !== 'MEMAHAMI' || !u.jenis) return u;
  const w = wilayahUrusan(store, u);
  if (wilayahBelumSiap(u.jenis, w)) return u;
  const kartu = kartuRencana(u.jenis, w, ragDb);
  if (!kartu) return u;
  publish({ type: 'plan_card', ...kartu });
  return majukan(store, u, ['RENCANA_DIUSULKAN'], publish);
}
