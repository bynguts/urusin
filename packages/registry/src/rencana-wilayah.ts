import {
  REF_KK,
  REF_KTP,
  REF_SKDWNI,
  REF_SKPWNI,
  findBundel,
  type Bundel,
  type Langkah,
} from './peristiwa.js';
import {
  REF_DUKCAPIL_2023,
  REF_PERPRES,
  REF_PERPRES_TEKS,
  REF_PMD108,
  REF_PMD7_2026,
  REF_UU23,
  REF_UU24,
} from './regulasi.js';
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
          keterangan: `Persyaratan nasional (Perpres 96/2018). Laporkan paling lambat 60 hari sejak kelahiran (UU 24/2013 Ps. 27); lewat dari itu akta tetap terbit setelah keputusan Kepala Disdukcapil, tanpa penetapan pengadilan (Ps. 32 ayat 1). ${cara}`,
          sourceRef: [...ref, REF_UU24],
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
            'Pengganti dokumen yang tidak dimiliki (Perpres 96/2018 Ps. 34), bukan langkah wajib bagi semua.',
          sourceRef: [REF_PERPRES_TEKS],
        }),
        L({
          id: 'ambil',
          judul: `Terima akta kelahiran dan KK baru dari ${dinasKtp}`,
          jenis: 'offline',
          lokasi: 'disdukcapil',
          dependsOn: ['ajukan'],
          dokumen: [],
          bawa: ['Bukti pengajuan'],
          keterangan: `Ada daerah yang mengirim dokumen untuk dicetak mandiri, ada yang diambil di kantor. KIA anak bisa terbit bersama akta dengan melampirkan fotokopi KK saja (Permendagri 7/2026 Ps. 6 ayat 1). ${cara}`,
          sourceRef: [sumber(kanal), REF_PMD7_2026],
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
          keterangan: `Persyaratan nasional (Perpres 96/2018). Kematian dilaporkan paling lambat 30 hari sejak tanggal kematian; kewajiban lapor ada pada ketua RT atau sebutan lain (UU 24/2013 Ps. 44). ${cara}`,
          sourceRef: [...ref, REF_UU24],
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
          keterangan: `Perkawinan beragama Islam dicatat di KUA kecamatan dan Dukcapil tidak menerbitkan kutipan akta perkawinannya; buktinya buku nikah. Perkawinan lainnya dilaporkan ke Disdukcapil paling lambat 60 hari (UU 23/2006 Ps. 34). Persyaratan nasional (Perpres 96/2018). ${cara}`,
          sourceRef: [...ref, REF_UU23],
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
 * Pindah antar kab/kota: dua yurisdiksi. Surat Keterangan Pindah (SKPWNI) dari Disdukcapil ASAL (wilayah KTP
 * sekarang), lalu Disdukcapil TUJUAN menerbitkan KK dan KTP-el alamat baru (Perpres 96/2018 Ps. 25; Permendagri
 * 108/2019 Ps. 28-31). Dalam satu kab/kota cukup satu langkah (Ps. 29). Halaman resmi Wonogiri hanya dirujuk bila
 * sisi itu memang Wonogiri; di sana layanan sisi tujuan bernama "SKDWNI", nama lokal, bukan dokumen nasional.
 */
function langkahPindah(asal: Wilayah | null, tujuan: Wilayah | null): Langkah[] {
  const kAsal = asal ? kanalWilayah(asal.kodeKabKota) : { ...KANAL_NASIONAL, jenis: 'nasional' as const };
  const kTujuan = tujuan
    ? kanalWilayah(tujuan.kodeKabKota)
    : { ...KANAL_NASIONAL, jenis: 'nasional' as const };
  const wng = (w: Wilayah | null, ...refs: SourceRef[]) => (w?.kodeKabKota === '3312' ? refs : []);
  const dAsal = disebut(asal, 'Disdukcapil daerah asal (sesuai KTP sekarang)');
  const dTujuan = disebut(tujuan, 'Disdukcapil daerah tujuan');
  const pemilikRumah =
    'Surat pernyataan tidak keberatan dari pemilik rumah, bila menumpang KK, sewa, kontrak, atau kos';
  if (asal && tujuan && asal.kodeKabKota === tujuan.kodeKabKota)
    return [
      L({
        id: 'pindah-alamat',
        judul: `Laporkan pindah alamat di ${dAsal}: terima KK dan KTP-el alamat baru`,
        jenis: 'online-manual',
        lokasi: 'disdukcapil',
        dependsOn: [],
        dokumen: ['Kartu Keluarga', 'KK yang akan ditumpangi, bila menumpang KK', pemilikRumah],
        bawa: ['KTP-el lama'],
        keterangan: `Pindah dalam satu kab/kota cukup satu langkah: Disdukcapil langsung menerbitkan KK dan KTP-el alamat baru dan mencabut yang lama (Permendagri 108/2019 Ps. 29). ${lewatKanal(kAsal, asal)}`,
        sourceRef: [sumber(kAsal), ...wng(asal, REF_SKPWNI), REF_PMD108],
      }),
    ];
  return [
    L({
      id: 'skpwni',
      judul: `Urus surat pindah (SKPWNI) di ${dAsal}`,
      jenis: 'online-manual',
      lokasi: 'disdukcapil',
      dependsOn: [],
      dokumen: ['Kartu Keluarga', 'Formulir F-1.03 (pendaftaran perpindahan penduduk)', pemilikRumah],
      bawa: [],
      keterangan: `Diurus di daerah asal, sesuai alamat KTP sekarang. SKPWNI berlaku 100 hari kerja (Permendagri 108/2019 Ps. 30 ayat 2). Sudah tinggal di tujuan? Disdukcapil tujuan bisa membantu memintakan SKPWNI ke asal secara elektronik (Ps. 31). ${lewatKanal(kAsal, asal)}`,
      sourceRef: [sumber(kAsal), ...wng(asal, REF_SKPWNI), REF_PERPRES, REF_PMD108],
    }),
    L({
      id: 'kk-ktp-el',
      judul: `Lapor datang di ${dTujuan}: terima KK dan KTP-el alamat baru`,
      jenis: 'online-manual',
      lokasi: 'disdukcapil',
      dependsOn: ['skpwni'],
      dokumen: ['SKPWNI dari daerah asal', 'KTP-el dan/atau KIA alamat lama', pemilikRumah],
      bawa: ['KTP-el lama'],
      keterangan: `Setelah SKPWNI terbit. Disdukcapil tujuan menerbitkan KK dan KTP-el alamat baru berdasarkan SKPWNI (Perpres 96/2018 Ps. 17 dan Ps. 25 ayat 5); KTP-el lama ditarik di sini, bukan di asal.${tujuan?.kodeKabKota === '3312' ? ' Di Wonogiri layanan ini bernama Surat Keterangan Datang WNI (SKDWNI).' : ''} ${lewatKanal(kTujuan, tujuan)}`,
      sourceRef: [
        sumber(kTujuan),
        ...wng(tujuan, REF_SKDWNI, REF_KK, REF_KTP),
        REF_PERPRES_TEKS,
        REF_DUKCAPIL_2023,
      ],
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
    catatan = !(ktp && tujuan)
      ? 'Pindah antar kab/kota melibatkan dua Disdukcapil: asal (sesuai KTP sekarang) dan tujuan. Sebutkan keduanya agar kanal resminya tepat.'
      : ktp.kodeKabKota === tujuan.kodeKabKota
        ? `Pindah alamat di dalam ${ktp.nama}: cukup satu kali lapor, tanpa surat pindah antar daerah. Ketersediaan layanan online diperiksa per situs sebelum dijanjikan.`
        : `Pindah dari ${ktp.nama} ke ${tujuan.nama}: SKPWNI diurus di asal, lalu Disdukcapil tujuan menerbitkan KK dan KTP-el baru. Ketersediaan layanan online diperiksa per situs sebelum dijanjikan.`;
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
