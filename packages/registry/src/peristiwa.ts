import { z } from 'zod';
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
  jenis: z.enum(['online-adapter', 'online-manual', 'offline']),
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
export const REF_PERPRES: SourceRef = {
  url: 'https://peraturan.go.id/id/perpres-no-96-tahun-2018',
  judul:
    'Perpres No. 96 Tahun 2018 tentang Persyaratan dan Tata Cara Pendaftaran Penduduk dan Pencatatan Sipil',
  instansi: 'Pemerintah Republik Indonesia',
};

const L = (l: Omit<Langkah, 'verifiedAt'>): Langkah => ({ ...l, verifiedAt: null });

export const PERISTIWA_BUNDEL: readonly Bundel[] = [
  {
    slug: 'kelahiran',
    judul: 'Kelahiran',
    kodeWilayah: '3312',
    tier: 'semi',
    keluaran: ['Akta Kelahiran', 'Kartu Keluarga', 'KIA'],
    catatan:
      'Layanan terintegrasi Wonogiri: 1 hari kerja, tanpa biaya. Pengajuan online lewat Telunjuk Sakti layanan 23 "Akta Kelahiran" (recon 2026-11-08): Browser Pendamping mengunggah Dokumen, warga masuk akun dan menekan Selesai sendiri.',
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
          'Formulir F-2.01 (Pelaporan Pencatatan Sipil)',
        ],
        bawa: [],
        keterangan:
          'Untuk cetak mandiri akta dan KK, alamat email wajib diisi. Berkas yang tidak sesuai dibatalkan dan pemohon menerima SMS pembatalan.',
        sourceRef: [REF_LAHIR],
      }),
      L({
        id: 'siapkan-sptjm',
        judul: 'Bila surat kurang: siapkan SPTJM bersama dua saksi',
        jenis: 'online-manual',
        dependsOn: [],
        dokumen: [
          'SPTJM kebenaran data kelahiran (F-2.03) dan dua orang saksi, bila surat keterangan kelahiran tidak ada',
          'SPTJM kebenaran sebagai pasangan suami istri (F-2.04) dan dua orang saksi, bila tidak punya buku nikah/akta perkawinan',
        ],
        bawa: [],
        keterangan: 'Pengganti dokumen yang tidak dimiliki, bukan langkah tambahan bagi semua orang.',
        sourceRef: [REF_LAHIR],
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
          'KIA dicetak Operator SIAK Kecamatan. Halaman resmi tidak menyebut lokasi pengambilan secara eksplisit; tanyakan ke Disdukcapil atau kecamatan sebelum berangkat.',
        sourceRef: [REF_LAHIR],
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
          'Surat kematian dari dokter atau kepala desa/lurah (atau dokumen pengganti sesuai keadaan, mis. keterangan kepolisian atau penetapan pengadilan)',
          'Fotokopi KK/KTP orang yang meninggal',
          'Dokumen perjalanan bagi WNI bukan penduduk atau orang asing',
          'Formulir F-2.01 (Pelaporan Pencatatan Sipil)',
        ],
        bawa: [],
        keterangan: 'Untuk cetak mandiri akta dan KK, alamat email wajib diisi.',
        sourceRef: [REF_MATI],
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
          'Formulir F-2.01 (Pelaporan Pencatatan Sipil)',
        ],
        bawa: [],
        keterangan: 'Petugas memeriksa kelengkapan; bila sesuai, pemohon diminta mengirim berkas fisik.',
        sourceRef: [REF_KAWIN],
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
    keluaran: ['SKPWNI', 'SKDWNI', 'Kartu Keluarga', 'KTP-el'],
    peringatan:
      'Risiko lebih tinggi: dua sistem berbeda. Tidak ada bundel resmi; alur ini orkestrasi buatan Urusin.',
    catatan:
      'Persyaratan di bawah merujuk halaman Wonogiri sebagai contoh; ketersediaan online di instansi asal dan tujuan harus diperiksa per situs sebelum dijanjikan.',
    langkah: [
      L({
        id: 'skpwni',
        judul: 'Urus SKPWNI di daerah asal',
        jenis: 'online-manual',
        lokasi: 'disdukcapil',
        dependsOn: [],
        dokumen: [
          'Formulir F-1.03',
          'KTP asli dan fotokopi',
          'Fotokopi KK sebelum pindah',
          'Surat nikah (bagi yang sudah menikah)',
        ],
        bawa: [],
        keterangan:
          'Di Wonogiri tersedia tatap muka dan daring, 1 hari kerja, tanpa biaya; daerah lain bisa berbeda.',
        sourceRef: [REF_SKPWNI, REF_PERPRES],
      }),
      L({
        id: 'skdwni',
        judul: 'Urus SKDWNI di daerah tujuan',
        jenis: 'online-manual',
        lokasi: 'disdukcapil',
        dependsOn: ['skpwni'],
        dokumen: [
          'SKPWNI dari Disdukcapil asal',
          'Biodata dari kabupaten/kota asal atau fotokopi KK terakhir',
          'Surat nikah bagi yang sudah menikah (data harus sesuai)',
        ],
        bawa: [],
        keterangan: 'Mensyaratkan SKPWNI selesai lebih dulu.',
        sourceRef: [REF_SKDWNI, REF_PERPRES],
      }),
      L({
        id: 'kk',
        judul: 'Terbitkan Kartu Keluarga di alamat baru',
        jenis: 'online-manual',
        dependsOn: ['skdwni'],
        dokumen: [
          'Surat Keterangan Pindah/Datang',
          'Fotokopi akta kelahiran dan ijazah untuk verifikasi data',
        ],
        bawa: [],
        keterangan: 'Syarat KK baru menurut halaman Wonogiri; periksa syarat instansi tujuan.',
        sourceRef: [REF_KK],
      }),
      L({
        id: 'ktp-el',
        judul: 'Perbarui KTP-el',
        jenis: 'offline',
        lokasi: 'kecamatan',
        dependsOn: ['kk'],
        dokumen: ['SKP bila permohonan karena pindah datang antar kab/kota/provinsi'],
        bawa: ['KTP-el lama', 'Kartu Keluarga terbaru'],
        keterangan: 'KTP-el dicetak dan diambil di kecamatan menurut halaman Wonogiri.',
        sourceRef: [REF_KTP],
      }),
    ],
  },
].map((b) => BundelSchema.parse(b));

export function findBundel(slug: string): Bundel | undefined {
  return PERISTIWA_BUNDEL.find((b) => b.slug === slug);
}
