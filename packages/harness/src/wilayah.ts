import { ADAPTERS } from '@urusin/adapters';
import type { EventPayload, PayloadOf, WilayahRef } from '@urusin/contracts';
import { cariPengetahuanTool } from '@urusin/rag';
import {
  KANAL_NASIONAL,
  kanalDisdukcapil,
  kanalProvinsi,
  kanalWilayah,
  kontakLayanan,
  namaPendekWilayah,
  rencanaLayanan,
  rencanaWilayah,
  ringkasKontak,
  temukanWilayah,
  wilayahByKode,
  type CityEntry,
  type Langkah,
  type RencanaWilayah,
} from '@urusin/registry';
import type { Db } from './db.js';
import { HarnessError } from './errors.js';
import { kalimatJaringanId, keteranganPendamping, majukan, rutePendamping } from './rencana.js';
import type { HarnessStore, UrusanRow } from './store.js';

type Publish = (e: EventPayload) => void;
type PayloadWilayah = PayloadOf<'wilayah'>;

/**
 * Jawaban "ya/betul" warga, boleh diawali seruan lisan ("Oh, iya betul", "Eh iya"). Dipakai tool wilayah__tetapkan
 * dan DemoProvider (satu definisi).
 */
export const AFIRMASI =
  /^\s*(?:(?:oh+|o|eh|ah|nah|wah|oalah|lho|loh|hmm+)[\s,.!]+)?(ya|iya+|iyo|y|yes|betul|benar|bener|ok|oke|okay|yup|tepat|sesuai|sudah benar|leres|nggih|inggih)\b/i;

/**
 * Potongan kalimat catatan state dan hasil tool wilayah. DemoProvider membacanya kembali, jadi didefinisikan di
 * satu tempat agar penulis (prompt/tool) dan pembaca (demo) tidak bergeser.
 */
export const TEKS_WILAYAH = {
  /** Awal baris catatan state tentang wilayah KTP. */
  baris: 'WILAYAH KTP:',
  belum: 'WILAYAH KTP: belum ditetapkan.',
  sudah: 'sudah dipastikan warga.',
  usulan: 'Usulan',
  butuhTujuan: 'urusan pindah butuh kab/kota tujuan',
  /** Awal hasil tool wilayah__tetapkan yang berhasil. */
  ditetapkan: 'Wilayah KTP ditetapkan:',
  /** Penanda daftar pilihan nama ganda di hasil tool. */
  pilihan: 'Pilihan:',
} as const;

/**
 * Keadaan wilayah satu urusan. `ktp` = wilayah KTP yang SUDAH dipastikan warga: kolom `kode_kabkota` hanya
 * dihitung bila event `wilayah` ditetapkan terakhir menyebut kode yang sama (urusan lama yang kolomnya terisi
 * default Wonogiri tanpa konfirmasi diperlakukan sebagai usulan). Domisili dan tujuan dari event itu juga;
 * `usulan` = kandidat dari Data Diri/pemilih perangkat yang belum dikonfirmasi. Tanpa konfirmasi, `ktp` null.
 */
export type WilayahUrusan = {
  ktp: WilayahRef | null;
  domisili: WilayahRef | null;
  tujuan: WilayahRef | null;
  /** warga = wilayah yang sudah ditanyakan agen di percakapan (lihat `selaraskanUsulan`); ingatan = ADR 0031. */
  usulan: { ktp: WilayahRef; sumber: 'data_diri' | 'pilihan' | 'warga' | 'ingatan' } | null;
};

export function refWilayah(kode: string): WilayahRef | null {
  const w = wilayahByKode(kode);
  return w ? { kodeKabKota: w.kodeKabKota, nama: w.nama } : null;
}

export function wilayahUrusan(store: HarnessStore, u: UrusanRow): WilayahUrusan {
  const events = store.eventsOfType(u.id, 'wilayah', 20).map((e) => e.payload as PayloadWilayah);
  const ditetapkan = events.find((e) => e.status === 'ditetapkan');
  const usulan = events.find((e) => e.status === 'usulan');
  const kolom = u.kodeKabKota ? refWilayah(u.kodeKabKota) : null;
  const ktp = ditetapkan && kolom && ditetapkan.ktp.kodeKabKota === kolom.kodeKabKota ? kolom : null;
  return {
    ktp,
    domisili: ktp ? (ditetapkan?.domisili ?? null) : null,
    tujuan: ktp ? (ditetapkan?.tujuan ?? null) : null,
    usulan: usulan
      ? { ktp: usulan.ktp, sumber: usulan.sumber }
      : kolom && !ktp
        ? { ktp: kolom, sumber: 'pilihan' }
        : null,
  };
}

/** Nama kab/kota tanpa "Kabupaten"/"Kota", mis. "Bekasi": warga jarang menyebut jenisnya. */
const intiNama = (nama: string) => nama.replace(/^(Kabupaten|Kota)\s+/i, '').toLowerCase();

const sebutInti = (teks: string, w: WilayahRef) =>
  new RegExp(`\\b${intiNama(w.nama).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(teks);

/** Kata yang jelas merujuk sisi tujuan pindah (lapor datang, KK/KTP-el alamat baru). */
const SISI_TUJUAN =
  /\b(tujuan|lapor datang|daerah baru|alamat baru|tempat baru|skdwni|surat (keterangan )?datang)\b/i;

/**
 * Yurisdiksi untuk hand-off: wilayah KTP, kecuali (1) di luar pindah, warga menyebut kab/kota DOMISILI-nya
 * (mis. KTP Surabaya, kuliah di Semarang, bertanya "Disdukcapil Semarang di mana?"): kanal domisili; KTP-el juga
 * kab/kota lain yang disebut warga walau domisili belum dicatat; (2) urusan pindah yang ditanyakan
 * tentang sisi TUJUAN: nama tujuan disebut (nama asal tidak), atau kata "tujuan/lapor datang/alamat baru" tanpa
 * menyebut SKPWNI. SKPWNI ke asal.
 */
export function kodeYurisdiksi(store: HarnessStore, u: UrusanRow, teks: string): string | null {
  const w = wilayahUrusan(store, u);
  const asal = w.ktp?.kodeKabKota ?? u.kodeKabKota;
  const disebut = temukanWilayah(teks);
  const kode = disebut.map((s) => s.wilayah.kodeKabKota);
  // Domisili disebut: warga bertanya tentang kantor tempat tinggalnya, juga bila sekaligus protes "kok Surabaya?".
  if (
    u.jenis !== 'pindah' &&
    w.domisili &&
    (kode.includes(w.domisili.kodeKabKota) || sebutInti(teks, w.domisili))
  )
    return w.domisili.kodeKabKota;
  // KTP-el bisa dicetak di Disdukcapil mana pun. Domisili belum dicatat (agen tidak memanggil wilayah__tetapkan),
  // tetapi warga menyebut tepat satu kab/kota selain kota KTP-nya (p03 ulang, juga saat protes "kok Surabaya?"):
  // kanal kab/kota itu.
  if (u.jenis === 'ktp' && w.ktp && !w.domisili) {
    // Nama polos ("semarang") cocok ke Kota dan Kabupaten; yang disebut lengkap ("kota semarang") didahulukan.
    const sebutan = disebut.filter((x) => x.wilayah.kodeKabKota !== w.ktp?.kodeKabKota);
    const lengkap = sebutan.filter((x) => x.jenisDisebut !== null);
    const lain = [...new Set((lengkap.length > 0 ? lengkap : sebutan).map((x) => x.wilayah.kodeKabKota))];
    if (lain.length === 1) return lain[0]!;
  }
  if (u.jenis !== 'pindah' || !w.ktp || !w.tujuan || w.tujuan.kodeKabKota === w.ktp.kodeKabKota) return asal;
  if (kode.includes(w.ktp.kodeKabKota) || sebutInti(teks, w.ktp)) return asal;
  // Nama tujuan menang, juga untuk minta bantuan SKPWNI di tujuan (Permendagri 108/2019 Ps. 31).
  if (kode.includes(w.tujuan.kodeKabKota) || sebutInti(teks, w.tujuan)) return w.tujuan.kodeKabKota;
  if (/\bskpwni\b|surat pindah/i.test(teks)) return asal;
  return SISI_TUJUAN.test(teks) ? w.tujuan.kodeKabKota : asal;
}

/** Kode wilayah KTP yang sudah dipastikan warga, atau null. */
export function kodeKtp(store: HarnessStore, u: UrusanRow): string | null {
  return wilayahUrusan(store, u).ktp?.kodeKabKota ?? null;
}

/** Kode yang dipakai pendeteksi PII (NIK terpecah): wilayah KTP, atau usulannya bila belum ditetapkan. */
export function kodeUntukPii(store: HarnessStore, u: UrusanRow | undefined): string | null {
  if (!u) return null;
  return u.kodeKabKota ?? wilayahUrusan(store, u).usulan?.ktp.kodeKabKota ?? null;
}

/**
 * Alasan rencana belum boleh diusulkan; undefined = siap. Pindah butuh asal (KTP) DAN tujuan. Kematian: yang
 * berwenang Disdukcapil domisili almarhum (UU 24/2013), jadi cukup domisili; KTP pelapor tidak ditanyakan.
 */
export function wilayahBelumSiap(jenis: string | null, w: WilayahUrusan): string | undefined {
  if (!w.ktp && jenis === 'kematian')
    return 'wilayah domisili almarhum belum ditetapkan: kematian dilaporkan ke Disdukcapil tempat tinggal almarhum (UU 24/2013); tanyakan kab/kota tempat tinggal almarhum (bukan KTP pelapor) lalu panggil wilayah__tetapkan dengan domisili';
  if (!w.ktp)
    return 'wilayah KTP warga belum ditetapkan: tanyakan kab/kota sesuai KTP lalu panggil wilayah__tetapkan';
  if (jenis === 'pindah' && !w.tujuan)
    return `${TEKS_WILAYAH.butuhTujuan}: tanyakan lalu panggil wilayah__tetapkan dengan tujuan`;
  return undefined;
}

/**
 * Catat usulan wilayah (Data Diri, pemilih perangkat, atau Ingatan warga). Tidak mengubah urusan: warga tetap harus
 * memastikan.
 */
export function usulkanWilayah(
  urusanId: string,
  kode: string,
  sumber: 'data_diri' | 'pilihan' | 'ingatan',
  publish: Publish,
): boolean {
  const ktp = refWilayah(kode);
  if (!ktp) return false;
  publish({ type: 'wilayah', status: 'usulan', ktp, sumber });
  return true;
}

/** Kab/kota KTP yang disebut dalam teks (tanpa tujuan "ke X"), tanpa duplikat. */
export function kodeDisebut(teks: string): string[] {
  const kode = temukanWilayah(teks)
    .filter((s) => s.sebelum !== 'ke')
    .map((s) => s.wilayah.kodeKabKota);
  return [...new Set(kode)];
}

// "Saya warga Kota Medan" = menyatakan diri penduduk (ber-KTP) di sana; "tinggal di" hanya domisili.
const KATA_KTP =
  /\b(ktp|e-?ktp|ktp-?el|kk|kartu keluarga|kartu tanda penduduk)\b|\b(saya|aku|kami)\s+warga\b/i;

/**
 * Wilayah dari pesan warga, tanpa LLM: `ktp` = warga sendiri menyebut KTP/KK-nya di kab/kota itu, atau "saya
 * warga X" (satu kalimat memuat kata itu dan nama tempatnya, dan seluruh pesan hanya menyebut satu kab/kota),
 * `disebut` = satu kab/kota disebut tanpa kata itu ("tinggal di Wonogiri"): cukup diusulkan sebagai kartu.
 * Nama ganda (Bekasi, Semarang) atau dua kab/kota: null, agen yang bertanya.
 */
export function wilayahDariPesan(teks: string): { kode: string; ktp: boolean } | null {
  const disebut = kodeDisebut(teks);
  if (disebut.length !== 1) return null;
  const kode = disebut[0]!;
  const ktp = teks.split(/[.?!\n]+/).some((k) => KATA_KTP.test(k) && kodeDisebut(k).includes(kode));
  return { kode, ktp };
}

/**
 * Tujuan pindah dari pesan warga, tanpa LLM: hanya pola tegas "pindah (domisili) (dari X) ke Y" tanpa kata ragu
 * (mungkin, belum tahu, rencana, ...), dan tepat satu kab/kota sesudah "ke". Selain itu null: tujuan tidak
 * ditetapkan, agen yang menanyakan/memastikannya (wilayah__tetapkan atas jawaban warga).
 */
export function tujuanDariPesan(teks: string): string | null {
  if (!/\bpindah\s+(domisili\s+)?(dari\s+[^.?!\n]{1,60}?\s+)?ke\s+\S/i.test(teks)) return null;
  if (
    /\b(mungkin|belum\s+(tahu|tau|pasti|yakin)|rencana\w*|kayaknya|sepertinya|antara|atau|bisa\s+jadi|masih\s+bingung)\b/i.test(
      teks,
    )
  )
    return null;
  const ke = [
    ...new Set(
      temukanWilayah(teks)
        .filter((s) => s.sebelum === 'ke')
        .map((s) => s.wilayah.kodeKabKota),
    ),
  ];
  return ke.length === 1 ? ke[0]! : null;
}

/**
 * Teks agen yang isinya hanya pertanyaan konfirmasi wilayah ("KTP Anda terdaftar di X, betul?"): kartu wilayah
 * sudah menanyakannya, jadi teks ini tidak ditampilkan lagi (pertanyaan ganda).
 */
export function hanyaTanyaWilayah(teks: string): boolean {
  const t = teks.trim();
  if (t.length > 220 || !t.endsWith('?')) return false;
  if (t.split(/[.?!]+\s/).filter(Boolean).length > 2) return false;
  return /\bterdaftar di\b|\b(betul|benar)\s*\?$/i.test(t);
}

/**
 * Satu kanal konfirmasi: bila balasan agen menyebut tepat satu kab/kota yang berbeda dari usulan yang sedang
 * tampil sebagai kartu (wilayah KTP belum ditetapkan), terbitkan usulan kab/kota itu (sumber `warga`: dari
 * percakapan). Kartu "Ya, betul" jadi selalu sama dengan wilayah yang terakhir ditanyakan agen; kartu lama tidak
 * aktif lagi karena bukan usulan terakhir. Tanpa kartu sama sekali, usulan hanya terbit bila agen memang
 * menanyakan konfirmasi ("..., betul?"), mis. Cikarang dipetakan ke Kabupaten Bekasi.
 */
export function selaraskanUsulan(
  store: HarnessStore,
  u: UrusanRow,
  teksAgen: string,
  publish: Publish,
): void {
  if (!teksAgen || wilayahUrusan(store, u).ktp) return;
  const usulan = store
    .eventsOfType(u.id, 'wilayah', 20)
    .map((e) => e.payload as PayloadWilayah)
    .find((e) => e.status === 'usulan');
  if (!usulan && !/\b(betul|benar)\s*\?/i.test(teksAgen)) return;
  const disebut = kodeDisebut(teksAgen);
  if (disebut.length !== 1 || disebut[0] === usulan?.ktp.kodeKabKota) return;
  const ktp = refWilayah(disebut[0]!);
  if (ktp) publish({ type: 'wilayah', status: 'usulan', ktp, sumber: 'warga' });
}

/** Masukan penetapan wilayah. domisili/tujuan: undefined = pertahankan nilai sekarang, null = hapus. */
export type InputWilayah = {
  ktp: string;
  domisili?: string | null | undefined;
  tujuan?: string | null | undefined;
};

/**
 * Tetapkan wilayah KTP (+ domisili/tujuan) urusan: CAS pada `kode_kabkota` dan event `wilayah` ditetapkan
 * (jejak audit) dalam satu transaksi. domisili/tujuan yang tidak disebut tetap seperti sekarang. Tanpa perubahan
 * apa pun: tidak ada event dan versi tidak naik. Bila rencana sudah diusulkan untuk wilayah lain, urusan kembali
 * ke MEMAHAMI agar rencana disusun ulang. KTP berganti: potongan korpus yang sudah diambil dibuang. Hanya sebelum
 * rencana disetujui.
 */
export function tetapkanWilayah(
  store: HarnessStore,
  u: UrusanRow,
  input: InputWilayah,
  publish: Publish,
): UrusanRow {
  const ktp = refWilayah(input.ktp);
  if (!ktp) throw new HarnessError('WILAYAH_TIDAK_DIKENAL', 'kode kab/kota tidak dikenal', 422);
  if (!['BARU', 'MEMAHAMI', 'RENCANA_DIUSULKAN'].includes(u.state))
    throw new HarnessError('WILAYAH_TERKUNCI', 'wilayah tidak bisa diubah setelah rencana disetujui', 409);
  const sebelum = wilayahUrusan(store, u);
  const gabung = (baru: string | null | undefined, lama: WilayahRef | null) =>
    baru === undefined ? lama : baru === null ? null : refWilayah(baru);
  const domisiliRaw = gabung(input.domisili, sebelum.domisili);
  const domisili = domisiliRaw && domisiliRaw.kodeKabKota !== ktp.kodeKabKota ? domisiliRaw : null;
  const tujuan = gabung(input.tujuan, sebelum.tujuan);
  const berubah =
    sebelum.ktp?.kodeKabKota !== ktp.kodeKabKota ||
    (sebelum.tujuan?.kodeKabKota ?? null) !== (tujuan?.kodeKabKota ?? null) ||
    (sebelum.domisili?.kodeKabKota ?? null) !== (domisili?.kodeKabKota ?? null);
  if (!berubah) return u;
  const tx = store.db.transaction(() => {
    let cur = store.setKodeKabKota(u.id, u.version, ktp.kodeKabKota);
    // Potongan yang diambil sebelum wilayah ini (wilayah lama/tebakan) tidak boleh lagi lolos verifikasi kutipan;
    // potongan nasional/provinsi diambil ulang lewat rag__cari_pengetahuan dengan wilayah baru.
    if (sebelum.ktp?.kodeKabKota !== ktp.kodeKabKota) store.clearChunks(u.id);
    publish({
      type: 'wilayah',
      status: 'ditetapkan',
      ktp,
      sumber: 'warga',
      ...(domisili ? { domisili } : {}),
      ...(tujuan ? { tujuan } : {}),
    });
    if (cur.state === 'RENCANA_DIUSULKAN') cur = majukan(store, cur, ['MEMAHAMI'], publish);
    return cur;
  });
  return tx.immediate();
}

/**
 * Urusan baru yang wilayah KTP-nya sudah dipastikan (kolom + event `wilayah` ditetapkan, sama seperti konfirmasi
 * warga). Untuk seed demo, eval, dan tes; alur warga selalu lewat usulan lalu konfirmasi.
 */
export function buatUrusanTerwilayah(
  store: HarnessStore,
  input: { kodeKabKota?: string | undefined; jenis?: string | undefined },
): UrusanRow {
  const u = store.createUrusan(input.jenis ? { jenis: input.jenis } : {});
  if (!input.kodeKabKota) return u;
  return tetapkanWilayah(store, u, { ktp: input.kodeKabKota }, (e) => {
    const { type, ...isi } = e;
    store.appendEvent(u.id, type, isi);
  });
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
  return denganRute(r, w.ktp);
}

/** Tier, catatan, dan bantuan Pendamping kartu rencana dari `rutePendamping` (satu keputusan rute). */
function denganRute<R extends { slug: string; tier: 'semi' | 'dipandu'; catatan: string }>(
  r: R,
  ktp: string,
): Omit<R, 'tier'> & { tier: 'semi' | 'dipandu'; pendamping?: BantuanPendamping } {
  const rute = rutePendamping({ jenis: r.slug, kodeKabKota: ktp });
  // Portal `id-only` tanpa worker berjaringan Indonesia: dipandu sejak kartu, dengan alasan yang jujur.
  if (rute.jalur === 'dipandu' && rute.sebab === 'jaringan_id') {
    const kab = wilayahByKode(ktp);
    const kalimat = kalimatJaringanId(kab ? namaPendekWilayah(kab.nama) : undefined);
    return { ...r, tier: 'dipandu', catatan: `${r.catatan} ${kalimat}` };
  }
  if (rute.jalur === 'dipandu') return r;
  const pendamping: BantuanPendamping = {
    jalur: rute.jalur,
    host: new URL(rute.origin).host,
    keterangan: keteranganPendamping(rute),
  };
  if (rute.jalur === 'adapter') return { ...r, pendamping };
  return { ...r, tier: 'semi', catatan: `${r.catatan} ${pendamping.keterangan}`, pendamping };
}

/** Rencana yang dipakai kartu dan potongan persyaratan: Peristiwa Hidup, atau rencana minimal KK/KTP-el. */
export type RencanaUrusan = Pick<
  RencanaWilayah,
  'judul' | 'tier' | 'catatan' | 'langkah' | 'khususWilayah'
> & {
  slug: string;
  pendamping?: BantuanPendamping;
};

/**
 * Rencana Peristiwa Hidup (lihat `rencanaPeristiwa`), atau untuk urusan KK/KTP-el rencana minimal bersumber Perpres
 * 96/2018 dengan kanal resmi wilayah (Disdukcapil, cadangan pemda/provinsi/nasional). undefined untuk jenis lain.
 */
export function rencanaUrusan(
  jenis: string,
  w: { ktp: string | null; domisili?: string | null; tujuan?: string | null },
): RencanaUrusan | undefined {
  const peristiwa = rencanaPeristiwa(jenis, w);
  if (peristiwa) return peristiwa;
  const layanan = rencanaLayanan(jenis, { ktp: w.ktp, domisili: w.domisili ?? null });
  // KK/KTP-el di portal web wilayah: Browser Pendamping ditawarkan sama seperti Peristiwa Hidup.
  return layanan && w.ktp ? denganRute(layanan, w.ktp) : layanan;
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

/** Kartu rencana (event plan_card) untuk urusan ini; undefined bila jenisnya tidak punya rencana (lihat `rencanaUrusan`). */
export function kartuRencana(
  jenis: string,
  w: WilayahUrusan,
  ragDb?: Db,
): PayloadOf<'plan_card'> | undefined {
  if (!w.ktp) return undefined;
  const r = rencanaUrusan(jenis, {
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
        ...(l.dokumen.length > 0 ? { dokumen: l.dokumen } : {}),
        ...(l.keterangan ? { keterangan: l.keterangan } : {}),
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

/** Kalimat kanal resmi wilayah untuk model/warga (tanpa kanal kota lain), beserta kontak layanan resmi bila tercatat. */
export function kalimatKanal(kode: string): string {
  const k = kanalWilayah(kode);
  const nama = wilayahByKode(kode)?.nama ?? kode;
  // Tanpa situs Disdukcapil: situs resmi pemda/provinsi sebagai sumber informasi, bukan tempat mengajukan.
  const prov = k.jenis === 'pemda' ? kanalProvinsi(kode) : undefined;
  const baris = kanalDisdukcapil(k)
    ? `${nama}: kanal resmi ${k.judul} (${k.url}).`
    : k.jenis === 'nasional'
      ? `${nama}: situs Disdukcapil belum terverifikasi; kanal nasional ${k.url}.`
      : `${nama}: situs Disdukcapil belum terverifikasi; informasi resmi daerah di ${k.judul} (${k.url})${prov ? ` dan ${prov.judul} (${prov.url})` : ''}; kanal nasional ${KANAL_NASIONAL.url}. Pengajuan di kantor Disdukcapil ${nama}.`;
  const kontak = kontakLayanan(kode, 'adminduk');
  const ringkas = kontak ? ringkasKontak(kontak) : '';
  const sumber = kontak?.sumber[0];
  return ringkas && sumber
    ? `${baris} Kontak resmi ${kontak.instansi}: ${ringkas} (sumber ${sumber.url}, dicek ${sumber.dicekPada}).`
    : baris;
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
