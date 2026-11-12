import { z } from 'zod';
import {
  REF_DUKCAPIL_2023,
  REF_PERPRES,
  REF_PERPRES_TEKS,
  REF_PMD108,
  REF_PMD7_2026,
  REF_UU23,
  REF_UU24,
} from './regulasi.js';
import { SourceRefSchema, type SourceRef } from './schema.js';

/**
 * Bundel Peristiwa Hidup sebagai data (rencana §3.12). Slug sama dengan apps/web/src/lib/peristiwa.ts
 * (yang hanya memuat kartu beranda); modul ini menambah langkah, langkah offline, dan dokumen.
 * Seluruh isi disarikan dari halaman resmi yang dicantumkan di `sourceRef`; `verifiedAt` null sampai
 * pemilik data memeriksanya dengan tangan.
 */
export const LangkahSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  judul: z.string().min(1),
  jenis: z.enum(['online-adapter', 'online-manual', 'offline', 'cek-kanal']),
  /** Hanya langkah offline yang wajib punya lokasi. */
  lokasi: z
    .enum(['loket-online', 'kecamatan', 'disdukcapil', 'kelurahan-desa', 'pt-pos', 'kepolisian'])
    .optional(),
  dependsOn: z.array(z.string()),
  dokumen: z.array(z.string().min(1)),
  bawa: z.array(z.string().min(1)),
  keterangan: z.string(),
  sourceRef: z.array(SourceRefSchema).min(1),
  verifiedAt: z.iso.datetime().nullable(),
  /**
   * Hanya langkah `online-adapter`: alur adapter Browser Pendamping di portal kota (`adapterId` registry) beserta
   * parameter tetapnya (id layanan portal, jenis Dokumen yang diunggah). Tanpa data pribadi.
   */
  pendamping: z
    .object({
      flowId: z.string().min(1),
      params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    })
    .optional(),
});
export type Langkah = z.infer<typeof LangkahSchema>;

export const BundelSchema = z
  .object({
    slug: z.enum(['kelahiran', 'kematian', 'perkawinan', 'pindah']),
    judul: z.string().min(1),
    /** null = lintas instansi / tidak terikat satu wilayah. */
    kodeWilayah: z
      .string()
      .regex(/^\d{4}$/)
      .nullable(),
    tier: z.enum(['semi', 'dipandu']),
    keluaran: z.array(z.string().min(1)).min(1),
    peringatan: z.string().optional(),
    catatan: z.string(),
    langkah: z.array(LangkahSchema).min(1),
  })
  .superRefine((b, ctx) => {
    const ids = new Set(b.langkah.map((l) => l.id));
    if (ids.size !== b.langkah.length) ctx.addIssue({ code: 'custom', message: 'id langkah ganda' });
    for (const l of b.langkah) {
      for (const d of l.dependsOn) {
        if (!ids.has(d)) ctx.addIssue({ code: 'custom', message: `dependsOn tidak dikenal: ${d}` });
      }
      if (l.jenis === 'offline' && !l.lokasi)
        ctx.addIssue({ code: 'custom', message: `langkah offline tanpa lokasi: ${l.id}` });
      if ((l.jenis === 'online-adapter') !== (l.pendamping !== undefined))
        ctx.addIssue({
          code: 'custom',
          message: `online-adapter wajib (dan hanya dia) punya pendamping: ${l.id}`,
        });
    }
    // Tanpa siklus: setiap langkah hanya boleh bergantung pada langkah yang muncul lebih dulu.
    const seen = new Set<string>();
    for (const l of b.langkah) {
      if (l.dependsOn.some((d) => !seen.has(d)))
        ctx.addIssue({ code: 'custom', message: `urutan/siklus: ${l.id}` });
      seen.add(l.id);
    }
  });
export type Bundel = z.infer<typeof BundelSchema>;

const WNG = 'Dinas Kependudukan dan Pencatatan Sipil Kabupaten Wonogiri';
const wng = (slug: string, judul: string): SourceRef => ({
  url: `https://disdukcapil.wonogirikab.go.id/layanan/${slug}`,
  judul,
  instansi: WNG,
});

const REF_LAHIR = wng(
  'terintegrasi-pencatatan-akta-kelahiran-kartu-keluarga-dan-kia',
  'Terintegrasi Pencatatan Akta Kelahiran, Kartu Keluarga dan KIA',
);
const REF_MATI = wng(
  'terintegrasi-pencatatan-akta-kematian-kartu-keluarga-dan-ktp-el',
  'Terintegrasi Pencatatan Akta Kematian, Kartu Keluarga, dan KTP-el',
);
const REF_KAWIN = wng(
  'terintegrasi-pencatatan-akta-perkawinan-kartu-keluarga-ktp-el',
  'Terintegrasi Pencatatan Akta Perkawinan, Kartu Keluarga, KTP-el',
);
export const REF_SKPWNI = wng(
  'pelayanan-penerbitan-surat-keterangan-pindah-warga-negara-indonesia-skpwni',
  'Penerbitan Surat Keterangan Pindah WNI (SKPWNI)',
);
/** Nama layanan pindah datang di Wonogiri. "SKDWNI" bukan dokumen nasional; dokumen nasionalnya hanya SKP/SKPWNI. */
export const REF_SKDWNI = wng(
  'pelayanan-penerbitan-surat-keterangan-datang-warga-negara-indonesia-skdwni',
  'Penerbitan Surat Keterangan Datang WNI (SKDWNI)',
);
export const REF_KK = wng(
  'pelayanan-penerbitan-kartu-keluarga-baru-perubahan-data-penambahan-anggota-keluarga-pengurangan-anggota-keluarga-hilang-dan-rusak',
  'Penerbitan Kartu Keluarga',
);
export const REF_KTP = wng(
  'pelayanan-penerbitan-kartu-tanda-penduduk-eletronik-ktp-el-perubahan-data-hilang-dan-rusak',
  'Penerbitan KTP-el',
);

const L = (l: Omit<Langkah, 'verifiedAt'>): Langkah => ({ ...l, verifiedAt: null });

export const PERISTIWA_BUNDEL: readonly Bundel[] = [
  {
    slug: 'kelahiran',
    judul: 'Kelahiran',
    kodeWilayah: '3312',
    tier: 'semi',
    keluaran: ['Akta Kelahiran', 'Kartu Keluarga', 'KIA'],
    catatan:
      'Layanan terintegrasi Wonogiri: 1 hari kerja, tanpa biaya. Pengajuan online melalui Telunjuk Sakti layanan 23 "Akta Kelahiran". Warga masuk ke akun layanan, melengkapi berkas, dan mengirim pengajuan melalui kanal resmi.',
    langkah: [
      L({
        id: 'ajukan',
        judul: 'Ajukan akta kelahiran terintegrasi lewat loket online',
        jenis: 'online-adapter',
        lokasi: 'loket-online',
        // Telunjuk Sakti `pendaftaran/uploadberkas/23` (Akta Kelahiran): KK orang tua, KTP, surat keterangan lahir.
        pendamping: { flowId: 'ajukan', params: { layanan_id: 23, berkas: 'kk,ktp,surat' } },
        dependsOn: [],
        dokumen: [
          'Surat keterangan kelahiran dari RS/Puskesmas/fasilitas kesehatan/dokter/bidan, atau dari kepala desa/lurah bila lahir di rumah atau tempat lain',
          'Buku nikah/kutipan akta perkawinan/bukti lain yang sah',
          'KK tempat penduduk terdaftar atau akan didaftarkan sebagai anggota keluarga',
          'KTP-el orang tua',
          'Formulir pelaporan yang disediakan petugas (F-2.01)',
        ],
        bawa: [],
        keterangan:
          'Untuk cetak mandiri akta dan KK, alamat email wajib diisi. Berkas yang tidak sesuai dibatalkan dan pemohon menerima SMS pembatalan. KTP-el tidak disyaratkan bagi ibu kandung di bawah 17 tahun yang belum kawin (Permendagri 108/2019 Ps. 43 ayat 3). Kelahiran dilaporkan paling lambat 60 hari (UU 24/2013 Ps. 27); lewat dari itu akta tetap terbit setelah keputusan Kepala Disdukcapil, tanpa penetapan pengadilan (Ps. 32 ayat 1).',
        sourceRef: [REF_LAHIR, REF_PERPRES_TEKS, REF_PMD108, REF_UU24],
      }),
      L({
        id: 'siapkan-sptjm',
        judul: 'Bila surat kurang: siapkan SPTJM bersama dua saksi',
        jenis: 'online-manual',
        dependsOn: [],
        dokumen: [
          'SPTJM kebenaran data kelahiran (F-2.03) diketahui dua orang saksi, bila surat keterangan kelahiran tidak ada',
          'SPTJM kebenaran sebagai pasangan suami istri (F-2.04) diketahui dua orang saksi, bila tidak punya buku nikah/akta perkawinan tetapi KK menunjukkan orang tua suami istri',
        ],
        bawa: [],
        keterangan:
          'Pengganti dokumen yang tidak dimiliki (Perpres 96/2018 Ps. 34), bukan langkah tambahan bagi semua orang.',
        sourceRef: [REF_LAHIR, REF_PERPRES_TEKS],
      }),
      L({
        id: 'ambil-kia',
        judul: 'Ambil KIA',
        jenis: 'offline',
        lokasi: 'kecamatan',
        dependsOn: ['ajukan'],
        dokumen: [],
        bawa: ['Bukti/SMS pengambilan'],
        keterangan:
          'KIA dicetak Operator SIAK Kecamatan. Halaman resmi tidak menyebut lokasi pengambilan secara eksplisit; tanyakan ke Disdukcapil atau kecamatan sebelum berangkat. KIA yang terbit bersama akta cukup melampirkan fotokopi KK (Permendagri 7/2026 Ps. 6 ayat 1).',
        sourceRef: [REF_LAHIR, REF_PMD7_2026],
      }),
    ],
  },
  {
    slug: 'kematian',
    judul: 'Kematian',
    kodeWilayah: '3312',
    tier: 'dipandu',
    keluaran: ['Akta Kematian', 'Kartu Keluarga', 'KTP-el'],
    catatan:
      'Layanan terintegrasi Wonogiri: 1 hari kerja, tanpa biaya. Daftar hal lain yang mungkin perlu dilaporkan (bank, BPJS, pensiun) belum disertakan karena belum ada sumber resmi yang dipetakan.',
    langkah: [
      L({
        id: 'ajukan',
        judul: 'Ajukan akta kematian terintegrasi lewat loket online',
        jenis: 'online-manual',
        lokasi: 'loket-online',
        dependsOn: [],
        dokumen: [
          'Surat kematian dari dokter atau kepala desa/lurah (keterangan kepolisian bila identitas jenazah tidak jelas; salinan penetapan pengadilan hanya bila jenazah tidak ditemukan)',
          'Fotokopi KK/KTP orang yang meninggal',
          'Dokumen perjalanan bagi WNI bukan penduduk atau orang asing',
          'Formulir pelaporan yang disediakan petugas (F-2.01)',
        ],
        bawa: [],
        keterangan:
          'Untuk cetak mandiri akta dan KK, alamat email wajib diisi. Kematian dilaporkan paling lambat 30 hari sejak tanggal kematian; kewajiban lapor ada pada ketua RT atau sebutan lain (UU 24/2013 Ps. 44).',
        sourceRef: [REF_MATI, REF_UU24],
      }),
      L({
        id: 'ambil-ktp-el',
        judul: 'Ambil KTP-el',
        jenis: 'offline',
        lokasi: 'kecamatan',
        dependsOn: ['ajukan'],
        dokumen: [],
        bawa: ['Bukti/SMS pengambilan'],
        keterangan:
          'KTP-el dicetak Operator SIAK Kecamatan. Lokasi pengambilan tidak disebut eksplisit di halaman resmi; pastikan ke kantor sebelum berangkat.',
        sourceRef: [REF_MATI],
      }),
    ],
  },
  {
    slug: 'perkawinan',
    judul: 'Perkawinan',
    kodeWilayah: '3312',
    tier: 'dipandu',
    keluaran: ['Akta Perkawinan', 'Kartu Keluarga', 'KTP-el'],
    peringatan:
      'Ada langkah fisik: berkas dikirim lewat PT POS dan pencatatan dilakukan tatap muka di Dinas.',
    catatan: 'Wonogiri: 1 hari kerja, tanpa biaya. Dipandu dengan pelacak karena ada langkah offline wajib.',
    langkah: [
      L({
        id: 'ajukan',
        judul: 'Ajukan akta perkawinan terintegrasi lewat loket online',
        jenis: 'online-manual',
        lokasi: 'loket-online',
        dependsOn: [],
        dokumen: [
          'Surat keterangan telah terjadinya perkawinan dari pemuka agama atau penghayat kepercayaan',
          'Pas foto berwarna suami dan istri',
          'KTP-el asli',
          'Kartu Keluarga asli',
          'Janda/duda cerai mati: fotokopi akta kematian pasangan; cerai hidup: fotokopi akta perceraian',
          'Formulir pelaporan yang disediakan petugas (F-2.01)',
        ],
        bawa: [],
        keterangan:
          'Untuk perkawinan non-Muslim, dilaporkan paling lambat 60 hari. Perkawinan Muslim dicatat KUA kecamatan dan Dukcapil tidak menerbitkan kutipan akta perkawinannya (UU 23/2006 Ps. 34). Petugas memeriksa kelengkapan; bila sesuai, pemohon diminta mengirim berkas fisik.',
        sourceRef: [REF_KAWIN, REF_UU23],
      }),
      L({
        id: 'kirim-berkas-pos',
        judul: 'Kirim berkas fisik lewat PT POS Indonesia',
        jenis: 'offline',
        lokasi: 'pt-pos',
        dependsOn: ['ajukan'],
        dokumen: [],
        bawa: ['Berkas fisik sesuai persyaratan'],
        keterangan: 'Dilakukan setelah berkas online dinyatakan sesuai oleh petugas.',
        sourceRef: [REF_KAWIN],
      }),
      L({
        id: 'pencatatan-tatap-muka',
        judul: 'Pencatatan perkawinan langsung di Disdukcapil',
        jenis: 'offline',
        lokasi: 'disdukcapil',
        dependsOn: ['kirim-berkas-pos'],
        dokumen: [],
        bawa: ['Identitas', 'Pemberitahuan/SMS pengambilan'],
        keterangan:
          'Kepala Bidang Pelayanan Pencatatan Sipil mencatat langsung, menandatangani register, lalu menyerahkan kutipan akta, KK, dan KTP-el.',
        sourceRef: [REF_KAWIN],
      }),
    ],
  },
  {
    slug: 'pindah',
    judul: 'Pindah',
    kodeWilayah: null,
    tier: 'dipandu',
    keluaran: ['SKPWNI', 'Kartu Keluarga', 'KTP-el'],
    peringatan:
      'Risiko lebih tinggi: dua sistem berbeda. Tidak ada bundel resmi; alur ini orkestrasi buatan Urusin.',
    catatan:
      'Pindah antar kab/kota: SKPWNI dari daerah asal, lalu daerah tujuan menerbitkan KK dan KTP-el baru. SKPWNI berlaku 100 hari kerja. Persyaratan merujuk halaman Wonogiri sebagai contoh; ketersediaan online di instansi asal dan tujuan harus diperiksa per situs sebelum dijanjikan.',
    langkah: [
      L({
        id: 'skpwni',
        judul: 'Urus SKPWNI di daerah asal',
        jenis: 'online-manual',
        lokasi: 'disdukcapil',
        dependsOn: [],
        dokumen: [
          'Formulir permohonan pindah yang disediakan petugas (F-1.03)',
          'Fotokopi KK',
          'Surat pernyataan tidak keberatan dari pemilik rumah, bila menumpang KK, sewa, kontrak, atau kos',
        ],
        bawa: [],
        keterangan:
          'Surat Keterangan Pindah (SKPWNI) diterbitkan Disdukcapil asal dan berlaku 100 hari kerja (Permendagri 108/2019 Ps. 30). Sudah tinggal di tujuan? Disdukcapil tujuan bisa membantu memintakannya ke asal secara elektronik (Ps. 31). Di Wonogiri tersedia tatap muka dan daring, 1 hari kerja, tanpa biaya; daerah lain bisa berbeda.',
        sourceRef: [REF_SKPWNI, REF_PERPRES, REF_PMD108],
      }),
      L({
        id: 'kk-ktp-el',
        judul: 'Lapor datang di daerah tujuan: terima KK dan KTP-el alamat baru',
        jenis: 'online-manual',
        lokasi: 'disdukcapil',
        dependsOn: ['skpwni'],
        dokumen: [
          'SKPWNI dari Disdukcapil asal (di Wonogiri layanan ini disebut SKDWNI)',
          'KTP-el dan/atau KIA alamat lama',
          'Surat pernyataan tidak keberatan dari pemilik rumah, bila menumpang KK, sewa, kontrak, atau kos',
        ],
        bawa: ['KTP-el lama'],
        keterangan:
          'Disdukcapil tujuan menerbitkan KK dan KTP-el alamat baru berdasarkan SKPWNI (Perpres 96/2018 Ps. 17 dan Ps. 25 ayat 5); KTP-el lama ditarik di tujuan, bukan di asal.',
        sourceRef: [REF_SKDWNI, REF_KK, REF_KTP, REF_PERPRES_TEKS, REF_DUKCAPIL_2023],
      }),
    ],
  },
].map((b) => BundelSchema.parse(b));

export function findBundel(slug: string): Bundel | undefined {
  return PERISTIWA_BUNDEL.find((b) => b.slug === slug);
}

/**
 * Bundel layanan adminduk umum (bukan Peristiwa Hidup): jenis urusan `ktp`, `kk`, `kia`, `akta`. Rencananya disusun
 * `rencanaLayanan` (persyaratan nasional) atau model; bundel ini memberi Browser Pendamping tujuan layanan di
 * portal web Disdukcapil wilayah mana pun (Navigator generik), sama seperti bundel Peristiwa Hidup.
 */
export const BundelLayananSchema = z.object({
  slug: z.enum(['ktp', 'kk', 'kia', 'akta']),
  judul: z.string().min(1),
  /** Frasa sesudah "Ajukan" di kartu konfirmasi (singkatan tetap huruf besar). */
  frasa: z.string().min(1),
  keluaran: z.array(z.string().min(1)).min(1),
  sourceRef: z.array(SourceRefSchema).min(1),
});
export type BundelLayanan = z.infer<typeof BundelLayananSchema>;

export const LAYANAN_BUNDEL: readonly BundelLayanan[] = [
  {
    slug: 'ktp',
    judul: 'KTP elektronik (KTP-el)',
    frasa: 'penerbitan KTP-el',
    keluaran: ['KTP-el'],
    sourceRef: [REF_KTP, REF_PERPRES_TEKS],
  },
  {
    slug: 'kk',
    judul: 'Kartu Keluarga (KK)',
    frasa: 'penerbitan Kartu Keluarga',
    keluaran: ['Kartu Keluarga'],
    sourceRef: [REF_KK, REF_PERPRES_TEKS],
  },
  {
    slug: 'kia',
    judul: 'Kartu Identitas Anak (KIA)',
    frasa: 'penerbitan KIA',
    keluaran: ['KIA'],
    sourceRef: [REF_PMD7_2026],
  },
  {
    slug: 'akta',
    judul: 'Akta pencatatan sipil',
    frasa: 'pencatatan akta',
    keluaran: ['Kutipan akta'],
    sourceRef: [REF_UU24, REF_PERPRES_TEKS],
  },
].map((b) => BundelLayananSchema.parse(b));

/** Bundel yang bisa dikerjakan Browser Pendamping untuk jenis urusan ini: Peristiwa Hidup atau layanan adminduk. */
export function bundelPendamping(jenis: string): { slug: string; judul: string; frasa: string } | undefined {
  const p = findBundel(jenis);
  if (p) return { slug: p.slug, judul: p.judul, frasa: p.judul.toLowerCase() };
  const l = LAYANAN_BUNDEL.find((b) => b.slug === jenis);
  return l ? { slug: l.slug, judul: l.judul, frasa: l.frasa } : undefined;
}

/**
 * Varian layanan seperti yang ditawarkan portal Disdukcapil (mis. Telunjuk Sakti: KTP Baru, KTP Perubahan Data,
 * KTP Hilang, KTP Rusak). Pemicu berupa frasa, bukan kata lepas: "baru pindah" bukan "KTP baru".
 */
export type VarianLayanan = { id: string; judul: string; kataKunci: RegExp };

const RUSAK = /\b(rusak|retak|patah|pudar|terbelah|sobek|robek|luntur|tidak terbaca)\b/i;
const HILANG = /\b(hilang|ilang|kehilangan|kecurian|dicuri|dicopet|raib)\b/i;
const UBAH =
  /\b(perubahan|ubah|mengubah|ganti\s+(data|nama|alamat|status|agama|pekerjaan)|salah\s+(data|nama|tulis|ketik)|perbaik\w*|pembetulan)\b/i;

export const VARIAN_LAYANAN: Readonly<Record<string, readonly VarianLayanan[]>> = {
  ktp: [
    { id: 'rusak', judul: 'cetak ulang karena rusak', kataKunci: RUSAK },
    { id: 'hilang', judul: 'cetak ulang karena hilang', kataKunci: HILANG },
    { id: 'perubahan-data', judul: 'perubahan data', kataKunci: UBAH },
    {
      id: 'baru',
      judul: 'KTP-el baru (pertama kali)',
      kataKunci:
        /\b(ktp(-?el)?\s+(baru|pertama)|(bikin|buat|membuat|rekam|merekam)\s+ktp(-?el)?\s+(baru|pertama)|pertama\s+kali|belum\s+punya|17\s+tahun|perekaman)\b/i,
    },
  ],
  kk: [
    { id: 'rusak', judul: 'cetak ulang karena rusak', kataKunci: RUSAK },
    { id: 'hilang', judul: 'cetak ulang karena hilang', kataKunci: HILANG },
    {
      id: 'penambahan-anggota',
      judul: 'penambahan anggota keluarga',
      kataKunci: /\b(tambah\w*\s+(anggota|anak|istri|suami)|masuk\w*\s+(anak|istri|suami|bayi))\b/i,
    },
    {
      id: 'pengurangan-anggota',
      judul: 'pengurangan anggota keluarga',
      kataKunci:
        /\b(kurang\w*\s+anggota|hapus\w*\s+anggota|keluar\w*\s+dari\s+kk|anggota\s+(meninggal|pindah))\b/i,
    },
    { id: 'perubahan-data', judul: 'perubahan data', kataKunci: UBAH },
    {
      id: 'baru',
      judul: 'KK baru',
      kataKunci:
        /\b((kk|kartu\s+keluarga)\s+baru|(bikin|buat|membuat)\s+(kk|kartu\s+keluarga)|pisah\s+kk|kk\s+sendiri|(habis|baru|sudah)\s+(menikah|nikah)|belum\s+punya)\b/i,
    },
  ],
  kia: [
    { id: 'rusak', judul: 'cetak ulang karena rusak', kataKunci: RUSAK },
    { id: 'hilang', judul: 'cetak ulang karena hilang', kataKunci: HILANG },
    { id: 'perubahan-data', judul: 'perubahan data', kataKunci: UBAH },
    {
      id: 'baru',
      judul: 'KIA baru',
      kataKunci: /\b(kia\s+(baru|pertama)|(bikin|buat|membuat)\s+kia|pertama\s+kali|belum\s+punya)\b/i,
    },
  ],
  akta: [
    { id: 'perceraian', judul: 'akta perceraian', kataKunci: /\b(cerai|perceraian)\b/i },
    { id: 'perubahan-nama', judul: 'perubahan nama', kataKunci: /\b(ganti|ubah|perubahan)\s+nama\b/i },
    {
      id: 'pembetulan',
      judul: 'pembetulan akta',
      kataKunci: /\b(salah\s+(data|nama|tulis|ketik)|pembetulan|perbaik\w*|betulkan)\b/i,
    },
    {
      id: 'hilang-rusak',
      judul: 'kutipan kedua (akta hilang atau rusak)',
      kataKunci: new RegExp(`${RUSAK.source}|${HILANG.source}`, 'i'),
    },
    {
      id: 'anak',
      judul: 'pengakuan, pengesahan, atau pengangkatan anak',
      kataKunci: /\b(pengakuan|pengesahan|pengangkatan|adopsi|angkat)\s+anak\b/i,
    },
  ],
  pindah: [
    {
      id: 'datang',
      judul: 'pindah datang (lapor datang/SKDWNI)',
      kataKunci: /\b(pindah\s+datang|lapor\s+datang|skdwni|baru\s+datang|pindahan\s+ke\s+sini)\b/i,
    },
    {
      id: 'keluar',
      judul: 'pindah keluar (SKPWNI)',
      kataKunci: /\b(pindah\s+keluar|skpwni|surat\s+(keterangan\s+)?pindah|mau\s+pindah|akan\s+pindah)\b/i,
    },
  ],
};

/** Penyangkal tepat sebelum pemicu: "tidak rusak", "bukan hilang", "belum pernah rusak". */
const SANGKAL = /^(tidak|tak|bukan|belum|nggak|ngga|enggak|gak|ga)$/i;

/** Pemicu cocok setidaknya sekali tanpa penyangkal di dua kata sebelumnya. */
function disebut(re: RegExp, teks: string): boolean {
  for (const m of teks.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))) {
    const sebelum = teks
      .slice(0, m.index)
      .split(/[^\p{L}\p{N}-]+/u)
      .filter(Boolean)
      .slice(-2);
    if (!sebelum.some((k) => SANGKAL.test(k))) return true;
  }
  return false;
}

/** Varian yang disebut di pesan TERBARU yang menyebut varian mana pun (kosong = belum disebut). */
function varianCocok(slug: string, pesanWarga: readonly string[]): readonly VarianLayanan[] {
  const varian = VARIAN_LAYANAN[slug] ?? [];
  let cocok: readonly VarianLayanan[] = [];
  for (let i = pesanWarga.length - 1; i >= 0 && cocok.length === 0; i--)
    cocok = varian.filter((v) => disebut(v.kataKunci, pesanWarga[i] ?? ''));
  return cocok;
}

/**
 * Id varian layanan (`VARIAN_LAYANAN`) yang disebut warga untuk jenis urusan ini, hanya bila tepat SATU (pesan
 * terbaru yang menyebut varian menentukan). Belum disebut atau lebih dari satu = undefined (tidak menebak).
 */
export function varianDisebut(
  jenis: string | null | undefined,
  pesanWarga: readonly string[] = [],
): string | undefined {
  const b = jenis ? bundelPendamping(jenis) : undefined;
  if (!b) return undefined;
  const cocok = varianCocok(b.slug, pesanWarga);
  return cocok.length === 1 ? cocok[0]!.id : undefined;
}

const SERAHKAN = 'bila portal meminta konfirmasi jenis layanan, serahkan ke warga';

/**
 * Tujuan Navigator untuk urusan ini: judul bundel dan varian yang disebut warga (dicocokkan dari pesan warga
 * dengan kata kunci; teks warga sendiri TIDAK ikut ke prompt). Pesan TERBARU yang menyebut varian menentukan.
 * Varian belum jelas atau lebih dari satu: kandidatnya disebut supaya Navigator menyerahkan pilihan ke warga,
 * bukan menebak. Konfirmasi jenis layanan di portal selalu diserahkan ke warga.
 */
export function tujuanPendamping(
  jenis: string | null | undefined,
  pesanWarga: readonly string[] = [],
): string {
  const b = jenis ? bundelPendamping(jenis) : undefined;
  if (!b) return `Layanan kependudukan; ${SERAHKAN}`;
  const varian = VARIAN_LAYANAN[b.slug] ?? [];
  if (varian.length === 0) return `${b.judul}; ${SERAHKAN}`;
  const cocok = varianCocok(b.slug, pesanWarga);
  if (cocok.length === 1) return `${b.judul}: ${cocok[0]!.judul}; ${SERAHKAN}`;
  const daftar = (cocok.length > 1 ? cocok : varian).map((x) => x.judul).join('; ');
  const ket =
    cocok.length > 1 ? 'warga menyebut lebih dari satu jenis layanan' : 'jenis layanan belum disebut warga';
  return `${b.judul} (${ket}: ${daftar}; bila portal meminta memilih, serahkan ke warga); ${SERAHKAN}`;
}
