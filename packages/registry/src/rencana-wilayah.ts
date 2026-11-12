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
  REF_PMD109,
  REF_PMD7_2026,
  REF_UU23,
  REF_UU24,
} from './regulasi.js';
import { routeByKode } from './router.js';
import type { CityEntry, SourceRef } from './schema.js';
import { kontakDukcapil, namaPendekWilayah, situsPemda, wilayahByKode, type Wilayah } from './wilayah.js';

/** Kanal resmi satu kab/kota untuk rencana: dari mana warga mengajukan. */
export type KanalWilayah = SourceRef & {
  /**
   * portal = portal layanan di registry; disdukcapil = situs Disdukcapil terverifikasi; pemda = situs resmi
   * Pemerintah Kabupaten/Kota; provinsi = situs Dinas Dukcapil atau Pemerintah Provinsi; nasional = cadangan akhir.
   * Hanya portal dan disdukcapil yang menjadi tempat mengajukan; pemda dan provinsi sumber informasi resmi daerah.
   */
  jenis: 'portal' | 'disdukcapil' | 'pemda' | 'provinsi' | 'nasional';
};

/** Kanal Disdukcapil kab/kota (tempat mengajukan), bukan cadangan pemda/provinsi/nasional. */
export const kanalDisdukcapil = (k: Pick<KanalWilayah, 'jenis'>): boolean =>
  k.jenis === 'portal' || k.jenis === 'disdukcapil';

/**
 * Situs resmi provinsi tempat kab/kota ini berada: Dinas Dukcapil provinsi bila terverifikasi, selain itu portal
 * Pemerintah Provinsi. undefined bila keduanya belum terverifikasi.
 */
export function kanalProvinsi(kode: string): KanalWilayah | undefined {
  const w = wilayahByKode(kode);
  const p = situsPemda(kode.slice(0, 2));
  if (!w || !p) return undefined;
  const url = p.website.endsWith('/') ? p.website : `${p.website}/`;
  return p.jenis === 'dukcapil'
    ? {
        url,
        judul: `Situs Dinas Dukcapil Provinsi ${w.provinsi}`,
        instansi: `Dinas Kependudukan dan Pencatatan Sipil Provinsi ${w.provinsi}`,
        jenis: 'provinsi',
      }
    : {
        url,
        judul: `Situs resmi Pemerintah Provinsi ${w.provinsi}`,
        instansi: `Pemerintah Provinsi ${w.provinsi}`,
        jenis: 'provinsi',
      };
}

export const KANAL_NASIONAL: SourceRef = {
  url: 'https://dukcapil.kemendagri.go.id/',
  judul: 'Direktorat Jenderal Kependudukan dan Pencatatan Sipil',
  instansi: 'Kementerian Dalam Negeri',
};

const dinas = (nama: string) => `Dinas Kependudukan dan Pencatatan Sipil ${nama}`;

/**
 * Kanal resmi kab/kota, berurutan: portal layanan di registry, situs Disdukcapil yang terverifikasi
 * (data/wilayah/kontak-dukcapil.json), situs resmi Pemerintah Kabupaten/Kota, situs Dinas Dukcapil/Pemerintah
 * provinsinya (data/wilayah/pemda.json), lalu situs Ditjen Dukcapil. Tidak pernah memakai kanal kota lain.
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
  const pemda = situsPemda(kode);
  if (pemda)
    return {
      url: pemda.website.endsWith('/') ? pemda.website : `${pemda.website}/`,
      judul: `Situs resmi Pemerintah ${entry.nama}`,
      instansi: `Pemerintah ${entry.nama}`,
      jenis: 'pemda',
    };
  return kanalProvinsi(kode) ?? { ...KANAL_NASIONAL, jenis: 'nasional' };
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
  kanalDisdukcapil(k)
    ? `Cara mengajukan (online atau loket) dan formulir mengikuti ${k.judul}; periksa di sana sebelum berangkat.`
    : !w
      ? 'Pilih kab/kota sesuai KTP agar Urusin menunjukkan situs resmi yang tepat.'
      : k.jenis === 'nasional'
        ? `Situs resmi Disdukcapil ${w.nama} belum terverifikasi di Urusin: tanyakan cara pengajuan ke kantor Disdukcapil ${w.nama} atau lewat kanal nasional.`
        : `Situs resmi Disdukcapil ${w.nama} belum terverifikasi di Urusin: tanyakan cara pengajuan ke kantor Disdukcapil ${w.nama}; informasi resmi daerah ada di ${k.judul} (${k.url}).`;

/**
 * Pengajuan online di kab/kota ini sudah terverifikasi di registry: portal layanan yang alurnya sudah dicek
 * (validasi kirim-asli atau read-only). Selain itu (pending-recon, tanpa portal, atau tanpa entri) Urusin tidak
 * boleh melabeli langkah "online" atau "datang langsung".
 */
export function onlineTerverifikasi(w: Pick<Wilayah, 'kodeKabKota'> | null): boolean {
  if (!w) return false;
  const { entry } = routeByKode(w.kodeKabKota);
  return Boolean(entry.portal) && (entry.validasi === 'kirim-asli' || entry.validasi === 'read-only');
}

/** Jenis langkah pengajuan yang jujur: online hanya bila terverifikasi, selain itu cek kanal setempat. */
const caraAjukan = (w: Wilayah | null): Langkah['jenis'] =>
  onlineTerverifikasi(w) ? 'online-manual' : 'cek-kanal';

/** Langkah dari persyaratan nasional (Perpres 96/2018) + kanal resmi wilayah KTP. Tanpa isi kota lain. */
function langkahNasional(
  slug: Exclude<Bundel['slug'], 'pindah'>,
  ktp: Wilayah | null,
  kanal: KanalWilayah,
): Langkah[] {
  const ref = [sumber(kanal), REF_PERPRES];
  const dinasKtp = disebut(ktp, 'Disdukcapil kab/kota sesuai KTP Anda');
  const cara = lewatKanal(kanal, ktp);
  const ajukan = caraAjukan(ktp);
  switch (slug) {
    case 'kelahiran':
      return [
        L({
          id: 'ajukan',
          judul: `Ajukan akta kelahiran ke ${dinasKtp}`,
          jenis: ajukan,
          dependsOn: [],
          dokumen: [
            'Surat keterangan kelahiran dari rumah sakit/puskesmas/dokter/bidan, atau dari kepala desa/lurah',
            'Buku nikah/kutipan akta perkawinan atau bukti lain yang sah',
            'Kartu Keluarga',
            'KTP-el orang tua',
            'Formulir pelaporan yang disediakan petugas (F-2.01)',
          ],
          bawa: [],
          keterangan: `Persyaratan nasional (Perpres 96/2018 Ps. 33). KTP-el tidak disyaratkan bagi ibu kandung di bawah 17 tahun yang belum kawin (Permendagri 108/2019 Ps. 43 ayat 3). Laporkan paling lambat 60 hari sejak kelahiran (UU 24/2013 Ps. 27); lewat dari itu akta tetap terbit setelah keputusan Kepala Disdukcapil, tanpa penetapan pengadilan (Ps. 32 ayat 1). ${cara}`,
          sourceRef: [...ref, REF_PMD108, REF_PMD109, REF_UU24],
        }),
        L({
          id: 'siapkan-sptjm',
          judul: 'Bila surat kurang: siapkan SPTJM bersama dua saksi',
          jenis: ajukan,
          dependsOn: [],
          dokumen: [
            'SPTJM kebenaran data kelahiran (F-2.03) diketahui dua orang saksi, bila surat keterangan kelahiran tidak ada',
            'SPTJM kebenaran sebagai pasangan suami istri (F-2.04) diketahui dua orang saksi, bila tidak punya buku nikah/akta perkawinan tetapi KK menunjukkan orang tua suami istri',
          ],
          bawa: [],
          keterangan:
            'Pengganti dokumen yang tidak dimiliki (Perpres 96/2018 Ps. 34; kode formulir Permendagri 109/2019 Ps. 4), bukan langkah wajib bagi semua.',
          sourceRef: [REF_PERPRES_TEKS, REF_PMD109],
        }),
        L({
          id: 'ambil',
          judul: `Terima akta kelahiran dan KK baru dari ${dinasKtp}`,
          jenis: 'cek-kanal',
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
          jenis: ajukan,
          dependsOn: [],
          dokumen: [
            'Surat kematian dari dokter atau kepala desa/lurah',
            'Kartu Keluarga dan KTP-el almarhum',
            'KTP-el pelapor',
            'Formulir pelaporan yang disediakan petugas (F-2.01)',
          ],
          bawa: [],
          keterangan: `Persyaratan nasional (Perpres 96/2018). Kematian dilaporkan paling lambat 30 hari sejak tanggal kematian; kewajiban lapor ada pada ketua RT atau sebutan lain (UU 24/2013 Ps. 44). ${cara}`,
          sourceRef: [...ref, REF_UU24],
        }),
        L({
          id: 'ambil',
          judul: `Terima akta kematian dan KK yang diperbarui dari ${dinasKtp}`,
          jenis: 'cek-kanal',
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
          jenis: ajukan,
          dependsOn: [],
          dokumen: [
            'Surat keterangan telah terjadinya perkawinan dari pemuka agama atau penghayat kepercayaan',
            'Pas foto berwarna suami dan istri',
            'KTP-el dan Kartu Keluarga',
            'Formulir pelaporan yang disediakan petugas (F-2.01)',
          ],
          bawa: [],
          keterangan: `Perkawinan beragama Islam dicatat di KUA kecamatan dan Dukcapil tidak menerbitkan kutipan akta perkawinannya; buktinya buku nikah. Perkawinan lainnya dilaporkan ke Disdukcapil paling lambat 60 hari (UU 23/2006 Ps. 34). Persyaratan nasional (Perpres 96/2018). ${cara}`,
          sourceRef: [...ref, REF_UU23],
        }),
        L({
          id: 'pencatatan',
          judul: `Pencatatan perkawinan dan terima kutipan akta di ${dinasKtp}`,
          jenis: 'cek-kanal',
          lokasi: 'disdukcapil',
          dependsOn: ['ajukan'],
          dokumen: [],
          bawa: ['Dokumen asli sesuai persyaratan'],
          keterangan: `Pastikan jadwal dan apakah kedua mempelai harus hadir. ${cara}`,
          sourceRef: [sumber(kanal)],
        }),
      ];
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
        jenis: caraAjukan(asal),
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
      jenis: caraAjukan(asal),
      lokasi: 'disdukcapil',
      dependsOn: [],
      dokumen: [
        'Kartu Keluarga',
        'Formulir permohonan pindah yang disediakan petugas (F-1.03)',
        pemilikRumah,
      ],
      bawa: [],
      keterangan: `Diurus di daerah asal, sesuai alamat KTP sekarang. SKPWNI berlaku 100 hari kerja (Permendagri 108/2019 Ps. 30 ayat 2). Sudah tinggal di tujuan? Disdukcapil tujuan bisa membantu memintakan SKPWNI ke asal secara elektronik (Ps. 31). ${lewatKanal(kAsal, asal)}`,
      sourceRef: [sumber(kAsal), ...wng(asal, REF_SKPWNI), REF_PERPRES, REF_PMD108],
    }),
    L({
      id: 'kk-ktp-el',
      judul: `Lapor datang di ${dTujuan}: terima KK dan KTP-el alamat baru`,
      jenis: caraAjukan(tujuan),
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

/** Jenis urusan di luar Peristiwa Hidup yang punya rencana nasional bersumber (Perpres 96/2018, Permendagri 7/2026). */
export const JENIS_LAYANAN = ['kk', 'ktp', 'kia'] as const;
export type JenisLayanan = (typeof JENIS_LAYANAN)[number];

/** Rencana minimal untuk urusan KK/KTP-el/KIA: persyaratan nasional bersumber pasal + kanal resmi wilayah KTP. */
export type RencanaLayanan = {
  slug: JenisLayanan;
  judul: string;
  tier: 'dipandu';
  catatan: string;
  langkah: Langkah[];
  ktp: Wilayah | null;
  domisili: Wilayah | null;
  kanal: KanalWilayah[];
  khususWilayah: false;
};

function langkahLayanan(slug: JenisLayanan, ktp: Wilayah | null, kanal: KanalWilayah): Langkah[] {
  const dinasKtp = disebut(ktp, 'Disdukcapil kab/kota sesuai KTP Anda');
  const cara = lewatKanal(kanal, ktp);
  const ref = [sumber(kanal), REF_PERPRES_TEKS, REF_PERPRES];
  if (slug === 'kia')
    return [
      L({
        id: 'ajukan',
        judul: `Ajukan KIA ke ${dinasKtp}`,
        jenis: caraAjukan(ktp),
        dependsOn: [],
        dokumen: [
          'Anak di bawah 5 tahun yang terbit bersama akta kelahiran: fotokopi KK (atau wali)',
          'Anak di bawah 5 tahun yang sudah punya akta: fotokopi kutipan akta kelahiran dan fotokopi KK (atau wali), tanpa pas foto',
          'Anak 5 sampai 17 tahun kurang sehari: fotokopi kutipan akta kelahiran, fotokopi KK (atau wali), dan 1 lembar pas foto berwarna 2x3 cm',
          'KIA hilang: surat keterangan kehilangan dari kepolisian; KIA rusak: KIA yang rusak',
        ],
        bawa: [],
        keterangan: `Persyaratan nasional (Permendagri 7/2026 Ps. 6, 11, dan 12); KTP-el asli orang tua tidak lagi disyaratkan. KIA juga bisa diajukan online lewat aplikasi IKD (Ps. 24 sampai 26). ${cara}`,
        sourceRef: [sumber(kanal), REF_PMD7_2026],
      }),
      L({
        id: 'ambil',
        judul: `Terima KIA dari ${dinasKtp}`,
        jenis: 'cek-kanal',
        lokasi: 'disdukcapil',
        dependsOn: ['ajukan'],
        dokumen: [],
        bawa: ['Bukti pengajuan'],
        keterangan: `KIA bisa dicetak di Anjungan Dukcapil Mandiri (Permendagri 7/2026). ${cara}`,
        sourceRef: [sumber(kanal), REF_PMD7_2026],
      }),
    ];
  if (slug === 'kk')
    return [
      L({
        id: 'ajukan',
        judul: `Ajukan penerbitan KK ke ${dinasKtp}`,
        jenis: caraAjukan(ktp),
        dependsOn: [],
        dokumen: [
          'KK baru (mis. setelah menikah): buku nikah/kutipan akta perkawinan',
          'Bila pasangan atau anggota keluarga pindah dari kab/kota lain: surat keterangan pindah',
          'KK karena perubahan data: KK lama dan surat keterangan/bukti perubahannya',
        ],
        bawa: [],
        keterangan: `Persyaratan nasional (Perpres 96/2018 Ps. 11 ayat 1 dan Ps. 12). ${cara}`,
        sourceRef: ref,
      }),
      L({
        id: 'ambil',
        judul: `Terima KK baru dari ${dinasKtp}`,
        jenis: 'cek-kanal',
        lokasi: 'disdukcapil',
        dependsOn: ['ajukan'],
        dokumen: [],
        bawa: ['Bukti pengajuan'],
        keterangan: `Ada daerah yang mengirim KK untuk dicetak mandiri, ada yang diambil di kantor. ${cara}`,
        sourceRef: [sumber(kanal)],
      }),
    ];
  return [
    L({
      id: 'ajukan',
      judul: `Ajukan KTP-el ke ${dinasKtp}`,
      jenis: caraAjukan(ktp),
      dependsOn: [],
      dokumen: [
        'KTP-el hilang: surat keterangan hilang dari kepolisian dan KK',
        'KTP-el rusak: KTP-el yang rusak dan KK',
        'Pindah datang: surat keterangan pindah dari Disdukcapil daerah asal dan KK',
      ],
      bawa: [],
      keterangan: `Persyaratan nasional (Perpres 96/2018 Ps. 17 ayat 1 dan Ps. 21). Di luar domisili, KTP-el bisa diterbitkan Disdukcapil kab/kota lain bila tidak ada perubahan data, dengan membawa KK (Ps. 22). ${cara}`,
      sourceRef: ref,
    }),
    L({
      id: 'ambil',
      judul: `Terima KTP-el dari ${dinasKtp}`,
      jenis: 'cek-kanal',
      lokasi: 'disdukcapil',
      dependsOn: ['ajukan'],
      dokumen: [],
      bawa: ['Bukti pengajuan'],
      keterangan: cara,
      sourceRef: [sumber(kanal)],
    }),
  ];
}

/**
 * Rencana minimal bersumber untuk urusan KK/KTP-el (bukan Peristiwa Hidup), untuk wilayah mana pun: persyaratan
 * nasional dari pasal Perpres 96/2018 dan kanal resmi wilayah KTP (Disdukcapil, cadangan pemda/provinsi/nasional).
 * undefined untuk jenis lain.
 */
export function rencanaLayanan(
  jenis: string,
  opsi: { ktp: string | null; domisili?: string | null | undefined },
): RencanaLayanan | undefined {
  if (!(JENIS_LAYANAN as readonly string[]).includes(jenis)) return undefined;
  const slug = jenis as JenisLayanan;
  const ktp = opsi.ktp ? (wilayahByKode(opsi.ktp) ?? null) : null;
  const domisiliRaw = opsi.domisili ? (wilayahByKode(opsi.domisili) ?? null) : null;
  const domisili = domisiliRaw && domisiliRaw.kodeKabKota !== ktp?.kodeKabKota ? domisiliRaw : null;
  const kanalKtp = ktp ? kanalWilayah(ktp.kodeKabKota) : { ...KANAL_NASIONAL, jenis: 'nasional' as const };
  const kanal: KanalWilayah[] = [kanalKtp];
  let catatan = ktp
    ? `Syarat ini berlaku di seluruh Indonesia. Cara mengajukan di ${ktp.nama}: lihat ${kanalKtp.judul}.`
    : 'Persyaratan nasional. Pilih kab/kota sesuai KTP agar kanal resmi wilayah Anda ditampilkan.';
  if (ktp && domisili) {
    const kanalDom = kanalWilayah(domisili.kodeKabKota);
    kanal.push(kanalDom);
    catatan =
      slug === 'ktp'
        ? `Anda tinggal di ${domisili.nama}: KTP-el bisa diterbitkan Disdukcapil ${domisili.nama} tanpa pulang ke ${ktp.nama} bila tidak ada perubahan data, dengan membawa KK (Perpres 96/2018 Ps. 22); lihat ${kanalDom.judul}. ${catatan}`
        : `${catatanDomisili(ktp, domisili, kanalKtp)} ${catatan}`;
  }
  return {
    slug,
    judul: { kk: 'Kartu Keluarga (KK)', ktp: 'KTP elektronik (KTP-el)', kia: 'Kartu Identitas Anak (KIA)' }[
      slug
    ],
    tier: 'dipandu',
    catatan,
    langkah: langkahLayanan(slug, ktp, kanalKtp),
    ktp,
    domisili,
    kanal,
    khususWilayah: false,
  };
}

function catatanDomisili(ktp: Wilayah, domisili: Wilayah, kanal: KanalWilayah): string {
  return (
    `Anda tinggal di ${domisili.nama}, tetapi urusan kependudukan ditangani Disdukcapil sesuai alamat KTP: ${ktp.nama}. ` +
    (!kanalDisdukcapil(kanal)
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
      ? `Syarat ini berlaku di seluruh Indonesia. Cara mengajukan di ${ktp.nama}: lihat ${kanalKtp.judul}.`
      : 'Persyaratan nasional. Pilih kab/kota sesuai KTP agar kanal resmi wilayah Anda ditampilkan.';
    if (ktp && bundel.slug === 'kematian')
      catatan = `Kematian dilaporkan ke Disdukcapil tempat tinggal almarhum (UU 24/2013): ${ktp.nama}. ${catatan}`;
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
