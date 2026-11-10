import {
  REF_KK,
  REF_KTP,
  REF_PERPRES,
  REF_SKDWNI,
  REF_SKPWNI,
  findBundel,
  type Bundel,
  type Langkah,
} from './peristiwa.js';
import { routeByKode } from './router.js';
import type { CityEntry, SourceRef } from './schema.js';
import { kontakDukcapil, namaPendekWilayah, wilayahByKode, type Wilayah } from './wilayah.js';

/** Kanal resmi satu kab/kota untuk rencana: dari mana warga mengajukan. */
export type KanalWilayah = SourceRef & {
  /** portal = portal layanan di registry; disdukcapil = situs Disdukcapil terverifikasi; nasional = cadangan. */
  jenis: 'portal' | 'disdukcapil' | 'nasional';
};

export const KANAL_NASIONAL: SourceRef = {
  url: 'https://dukcapil.kemendagri.go.id/',
  judul: 'Direktorat Jenderal Kependudukan dan Pencatatan Sipil',
  instansi: 'Kementerian Dalam Negeri',
};

const dinas = (nama: string) => `Dinas Kependudukan dan Pencatatan Sipil ${nama}`;

/**
 * Kanal resmi kab/kota, berurutan: portal layanan di registry, lalu situs Disdukcapil yang terverifikasi
 * (data/wilayah/kontak-dukcapil.json), lalu situs Ditjen Dukcapil. Tidak pernah memakai kanal kota lain.
 */
export function kanalWilayah(kode: string): KanalWilayah {
  const { entry } = routeByKode(kode);
  if (entry.portal)
    return {
      url: `${entry.portal.origin}/`,
      judul: entry.portal.nama,
      instansi: entry.sourceRef[0]?.instansi ?? dinas(entry.nama),
      jenis: 'portal',
    };
  const k = kontakDukcapil(kode);
  if (k)
    return {
      url: k.website.endsWith('/') ? k.website : `${k.website}/`,
      judul: `Situs Disdukcapil ${entry.nama}`,
      instansi: dinas(entry.nama),
      jenis: 'disdukcapil',
    };
  return { ...KANAL_NASIONAL, jenis: 'nasional' };
}

const sumber = (k: KanalWilayah): SourceRef => ({ url: k.url, judul: k.judul, instansi: k.instansi });

export type RencanaWilayah = Omit<Bundel, 'kodeWilayah'> & {
  /** Wilayah KTP (yurisdiksi adminduk); null = belum diketahui (rencana umum nasional). */
  ktp: Wilayah | null;
  /** Hanya pindah: kab/kota tujuan. */
  tujuan: Wilayah | null;
  /** Tempat tinggal sekarang bila berbeda dari KTP. */
  domisili: Wilayah | null;
  /** Kanal resmi yang dirujuk rencana (KTP dulu, lalu tujuan). */
  kanal: KanalWilayah[];
  /** true = langkah diambil dari bundel khusus kab/kota ini; false = persyaratan nasional + kanal wilayah. */
  khususWilayah: boolean;
};

export type OpsiRencana = {
  ktp: string | null;
  tujuan?: string | null | undefined;
  domisili?: string | null | undefined;
  /**
   * true bila Browser Pendamping benar-benar punya alur TULIS untuk langkah ini di portal kota ini (adapter ada,
   * alurnya bukan baca-saja). Tanpa fungsi ini tidak ada langkah `online-adapter`: tier selalu dipandu.
   */
  pendampingTersedia?: ((entry: CityEntry, langkah: Langkah) => boolean) | undefined;
};

const L = (l: Omit<Langkah, 'verifiedAt'>): Langkah => ({ ...l, verifiedAt: null });

const disebut = (w: Wilayah | null, cadangan: string) =>
  w ? `Disdukcapil ${namaPendekWilayah(w.nama)}` : cadangan;

const lewatKanal = (k: KanalWilayah, w: Wilayah | null) =>
  k.jenis === 'nasional'
    ? w
      ? `Situs resmi Disdukcapil ${w.nama} belum terverifikasi di Urusin: tanyakan cara pengajuan ke kantor Disdukcapil ${w.nama} atau lewat kanal nasional.`
      : 'Pilih kab/kota sesuai KTP agar Urusin menunjukkan situs resmi yang tepat.'
    : `Cara mengajukan (online atau loket) dan formulir mengikuti ${k.judul}; periksa di sana sebelum berangkat.`;

/** Langkah dari persyaratan nasional (Perpres 96/2018) + kanal resmi wilayah KTP. Tanpa isi kota lain. */
function langkahNasional(slug: Bundel['slug'], ktp: Wilayah | null, kanal: KanalWilayah): Langkah[] {
  const ref = [sumber(kanal), REF_PERPRES];
  const dinasKtp = disebut(ktp, 'Disdukcapil kab/kota sesuai KTP Anda');
  const cara = lewatKanal(kanal, ktp);
  switch (slug) {
    case 'kelahiran':
      return [
        L({
          id: 'ajukan',
          judul: `Ajukan akta kelahiran ke ${dinasKtp}`,
          jenis: 'online-manual',
          dependsOn: [],
          dokumen: [
            'Surat keterangan kelahiran dari rumah sakit/puskesmas/dokter/bidan, atau dari kepala desa/lurah',
            'Buku nikah/kutipan akta perkawinan atau bukti lain yang sah',
            'Kartu Keluarga',
            'KTP-el orang tua',
          ],
          bawa: [],
          keterangan: `Persyaratan nasional (Perpres 96/2018). ${cara}`,
          sourceRef: ref,
        }),
        L({
          id: 'siapkan-sptjm',
          judul: 'Bila surat kurang: siapkan SPTJM bersama dua saksi',
          jenis: 'online-manual',
          dependsOn: [],
          dokumen: [
            'SPTJM kebenaran data kelahiran, bila surat keterangan kelahiran tidak ada',
            'SPTJM kebenaran sebagai pasangan suami istri, bila tidak punya buku nikah/akta perkawinan',
          ],
          bawa: [],
          keterangan:
            'Pengganti dokumen yang tidak dimiliki (Perpres 96/2018), bukan langkah wajib bagi semua.',
          sourceRef: [REF_PERPRES],
        }),
        L({
          id: 'ambil',
          judul: `Terima akta kelahiran dan KK baru dari ${dinasKtp}`,
          jenis: 'offline',
          lokasi: 'disdukcapil',
          dependsOn: ['ajukan'],
          dokumen: [],
          bawa: ['Bukti pengajuan'],
          keterangan: `Ada daerah yang mengirim dokumen untuk dicetak mandiri, ada yang diambil di kantor. ${cara}`,
          sourceRef: [sumber(kanal)],
        }),
      ];
    case 'kematian':
      return [
        L({
          id: 'ajukan',
          judul: `Laporkan kematian dan ajukan akta kematian ke ${dinasKtp}`,
          jenis: 'online-manual',
          dependsOn: [],
          dokumen: [
            'Surat kematian dari dokter atau kepala desa/lurah',
            'Kartu Keluarga dan KTP-el almarhum',
            'KTP-el pelapor',
          ],
          bawa: [],
          keterangan: `Persyaratan nasional (Perpres 96/2018). ${cara}`,
          sourceRef: ref,
        }),
        L({
          id: 'ambil',
          judul: `Terima akta kematian dan KK yang diperbarui dari ${dinasKtp}`,
          jenis: 'offline',
          lokasi: 'disdukcapil',
          dependsOn: ['ajukan'],
          dokumen: [],
          bawa: ['Bukti pengajuan'],
          keterangan: cara,
          sourceRef: [sumber(kanal)],
        }),
      ];
    case 'perkawinan':
      return [
        L({
          id: 'ajukan',
          judul: `Ajukan pencatatan perkawinan ke ${dinasKtp}`,
          jenis: 'online-manual',
          dependsOn: [],
          dokumen: [
            'Surat keterangan telah terjadinya perkawinan dari pemuka agama atau penghayat kepercayaan',
            'Pas foto berwarna suami dan istri',
            'KTP-el dan Kartu Keluarga',
          ],
          bawa: [],
          keterangan: `Perkawinan beragama Islam dicatat di KUA kecamatan; Disdukcapil mencatat perkawinan lainnya. Persyaratan nasional (Perpres 96/2018). ${cara}`,
          sourceRef: ref,
        }),
        L({
          id: 'pencatatan',
          judul: `Pencatatan perkawinan dan terima kutipan akta di ${dinasKtp}`,
          jenis: 'offline',
          lokasi: 'disdukcapil',
          dependsOn: ['ajukan'],
          dokumen: [],
          bawa: ['Dokumen asli sesuai persyaratan'],
          keterangan: `Pastikan jadwal dan apakah kedua mempelai harus hadir. ${cara}`,
          sourceRef: [sumber(kanal)],
        }),
      ];
    case 'pindah':
      return [];
  }
}

/**
 * Pindah: dua yurisdiksi. Surat pindah (SKPWNI) dari Disdukcapil ASAL (wilayah KTP sekarang), lalu lapor datang,
 * KK, dan KTP-el di TUJUAN. Halaman resmi Wonogiri hanya dirujuk bila sisi itu memang Wonogiri.
 */
function langkahPindah(asal: Wilayah | null, tujuan: Wilayah | null): Langkah[] {
  const kAsal = asal ? kanalWilayah(asal.kodeKabKota) : { ...KANAL_NASIONAL, jenis: 'nasional' as const };
  const kTujuan = tujuan
    ? kanalWilayah(tujuan.kodeKabKota)
    : { ...KANAL_NASIONAL, jenis: 'nasional' as const };
  const wng = (w: Wilayah | null, ref: SourceRef) => (w?.kodeKabKota === '3312' ? [ref] : []);
  const dAsal = disebut(asal, 'Disdukcapil daerah asal (sesuai KTP sekarang)');
  const dTujuan = disebut(tujuan, 'Disdukcapil daerah tujuan');
  return [
    L({
      id: 'skpwni',
      judul: `Urus surat pindah (SKPWNI) di ${dAsal}`,
      jenis: 'online-manual',
      lokasi: 'disdukcapil',
      dependsOn: [],
      dokumen: ['Kartu Keluarga', 'KTP-el', 'Formulir F-1.03 (pendaftaran perpindahan penduduk)'],
      bawa: [],
      keterangan: `Diurus di daerah asal, sesuai alamat KTP sekarang. ${lewatKanal(kAsal, asal)}`,
      sourceRef: [sumber(kAsal), ...wng(asal, REF_SKPWNI), REF_PERPRES],
    }),
    L({
      id: 'skdwni',
      judul: `Lapor kedatangan (SKDWNI) di ${dTujuan}`,
      jenis: 'online-manual',
      lokasi: 'disdukcapil',
      dependsOn: ['skpwni'],
      dokumen: ['SKPWNI dari daerah asal', 'Formulir F-1.03'],
      bawa: [],
      keterangan: `Setelah SKPWNI terbit. ${lewatKanal(kTujuan, tujuan)}`,
      sourceRef: [sumber(kTujuan), ...wng(tujuan, REF_SKDWNI), REF_PERPRES],
    }),
    L({
      id: 'kk',
      judul: `Terima Kartu Keluarga baru dari ${dTujuan}`,
      jenis: 'online-manual',
      dependsOn: ['skdwni'],
      dokumen: ['Surat keterangan pindah/datang'],
      bawa: [],
      keterangan: 'KK baru diterbitkan Disdukcapil tujuan setelah kedatangan dicatat.',
      sourceRef: [sumber(kTujuan), ...wng(tujuan, REF_KK)],
    }),
    L({
      id: 'ktp-el',
      judul: `Perbarui KTP-el di ${dTujuan}`,
      jenis: 'offline',
      lokasi: 'disdukcapil',
      dependsOn: ['kk'],
      dokumen: ['Surat keterangan pindah'],
      bawa: ['KTP-el lama', 'Kartu Keluarga terbaru'],
      keterangan: 'Perekaman/pencetakan KTP-el dengan alamat baru; tanyakan lokasinya ke kanal resmi tujuan.',
      sourceRef: [sumber(kTujuan), ...wng(tujuan, REF_KTP)],
    }),
  ];
}

function catatanDomisili(ktp: Wilayah, domisili: Wilayah, kanal: KanalWilayah): string {
  return (
    `Anda tinggal di ${domisili.nama}, tetapi urusan kependudukan ditangani Disdukcapil sesuai alamat KTP: ${ktp.nama}. ` +
    (kanal.jenis === 'nasional'
      ? `Langkah tatap muka dilakukan di kantor ${ktp.nama}; tanyakan dulu apakah bisa dilayani dari jauh.`
      : `Langkah online lewat ${kanal.judul} bisa dikerjakan dari mana saja; langkah tatap muka di kantor ${ktp.nama}.`)
  );
}

/**
 * Rencana Peristiwa Hidup yang benar untuk wilayah KTP warga. Bundel khusus kab/kota hanya dipakai bila
 * `kodeWilayah`-nya SAMA dengan wilayah KTP; selain itu langkah disusun dari persyaratan nasional dan kanal
 * resmi kab/kota itu sendiri. Tier `semi` hanya bila Browser Pendamping benar-benar bisa mengerjakan langkahnya.
 */
export function rencanaWilayah(slug: string, opsi: OpsiRencana): RencanaWilayah | undefined {
  const bundel = findBundel(slug);
  if (!bundel) return undefined;
  const ktp = opsi.ktp ? (wilayahByKode(opsi.ktp) ?? null) : null;
  const tujuan = opsi.tujuan ? (wilayahByKode(opsi.tujuan) ?? null) : null;
  const domisiliRaw = opsi.domisili ? (wilayahByKode(opsi.domisili) ?? null) : null;
  const domisili = domisiliRaw && domisiliRaw.kodeKabKota !== ktp?.kodeKabKota ? domisiliRaw : null;
  const kanalKtp = ktp ? kanalWilayah(ktp.kodeKabKota) : { ...KANAL_NASIONAL, jenis: 'nasional' as const };

  let langkah: Langkah[];
  let khususWilayah = false;
  let catatan: string;
  const kanal: KanalWilayah[] = [kanalKtp];
  if (bundel.slug === 'pindah') {
    langkah = langkahPindah(ktp, tujuan);
    if (tujuan) kanal.push(kanalWilayah(tujuan.kodeKabKota));
    catatan =
      ktp && tujuan
        ? `Pindah dari ${ktp.nama} ke ${tujuan.nama}: surat pindah diurus di asal, lapor datang di tujuan. Ketersediaan layanan online diperiksa per situs sebelum dijanjikan.`
        : 'Pindah melibatkan dua Disdukcapil: asal (sesuai KTP sekarang) dan tujuan. Sebutkan keduanya agar kanal resminya tepat.';
  } else if (ktp && bundel.kodeWilayah === ktp.kodeKabKota) {
    const { entry } = routeByKode(ktp.kodeKabKota);
    khususWilayah = true;
    langkah = bundel.langkah.map((l) => {
      if (l.jenis !== 'online-adapter' || opsi.pendampingTersedia?.(entry, l)) return l;
      const { pendamping: _p, ...manual } = l;
      return { ...manual, jenis: 'online-manual' as const };
    });
    catatan = bundel.catatan;
  } else {
    langkah = langkahNasional(bundel.slug, ktp, kanalKtp);
    catatan = ktp
      ? `Persyaratan nasional untuk ${ktp.nama}; detail dan cara pengajuan mengikuti ${kanalKtp.judul}.`
      : 'Persyaratan nasional. Pilih kab/kota sesuai KTP agar kanal resmi wilayah Anda ditampilkan.';
  }
  if (ktp && domisili && bundel.slug !== 'pindah')
    catatan = `${catatanDomisili(ktp, domisili, kanalKtp)} ${catatan}`;
  const peringatan = khususWilayah || bundel.slug === 'pindah' ? bundel.peringatan : undefined;
  return {
    slug: bundel.slug,
    judul: bundel.judul,
    keluaran: bundel.keluaran,
    tier: langkah.some((l) => l.jenis === 'online-adapter') ? 'semi' : 'dipandu',
    catatan,
    // Peringatan bundel khusus kota (mis. PT POS di Wonogiri) tidak dibawa ke wilayah lain.
    ...(peringatan ? { peringatan } : {}),
    langkah,
    ktp,
    tujuan,
    domisili,
    kanal,
    khususWilayah,
  };
}
