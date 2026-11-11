import { z } from 'zod';
import {
  IsoWaktuSchema,
  JenisLangkahSchema,
  KodeKabKotaSchema,
  SumberSchema,
  TierSchema,
  UrusanStateSchema,
} from './common.js';
import {
  AlasanSerahkanSchema,
  JenisAksiSchema,
  KelasKendaliSchema,
  PemilikSesiInternalSchema,
  PendampingBuktiSchema,
  RefSchema,
} from './pendamping.js';

/**
 * Event SSE: satu union bertanda `type`. Setiap frame: `id: <seq>`, `event: <type>`, `data: <JSON event>`.
 * `seq` = nilai `Last-Event-ID` untuk resume; `chainHead` = kepala rantai audit setelah event ini
 * (klien menyimpannya agar `/jejak/[id]` dapat mendeteksi manipulasi server).
 */
const dasar = {
  seq: z.number().int().nonnegative(),
  at: IsoWaktuSchema,
  chainHead: z.string().min(1),
};

function event<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
  return z.object({ type: z.literal(type), ...dasar, ...shape });
}

/** Progres tanpa isi jawaban: satu-satunya yang di-stream saat menyusun jawaban persyaratan. */
export const ProgressEventSchema = event('progress', {
  label: z.string().min(1),
  toolName: z.string().optional(),
});

/** Hanya untuk obrolan ringan di luar persyaratan/prosedur. Jawaban persyaratan tidak pernah di-stream per token. */
export const AssistantTextEventSchema = event('assistant_text', { delta: z.string() });

export const KutipanTerverifikasiSchema = z.object({
  refId: z.string().min(1),
  kutipanPersis: z.string().min(1),
  url: z.url(),
  judul: z.string().min(1),
  instansi: z.string().min(1),
  /** null = belum pernah diverifikasi tangan. */
  verifiedAt: IsoWaktuSchema.nullable(),
  /** Tautan sumber dengan Text Fragment (`#:~:text=`) yang menyorot kutipan. */
  textFragmentUrl: z.string().min(1),
  /** true bila `verifiedAt` null atau lebih dari 30 hari: UI menampilkan lencana "perlu dicek ulang". */
  perluDicekUlang: z.boolean(),
});
export type KutipanTerverifikasi = z.infer<typeof KutipanTerverifikasiSchema>;

export const KlaimSchema = z.object({
  teks: z.string().min(1),
  kutipan: z.array(KutipanTerverifikasiSchema).min(1),
});
export type Klaim = z.infer<typeof KlaimSchema>;

export const GroundedAnswerEventSchema = event('grounded_answer', {
  klaim: z.array(KlaimSchema),
  /** Jumlah klaim yang dibuang karena kutipannya tidak terverifikasi. */
  klaimDibuang: z.number().int().nonnegative(),
  /** Kalimat tetap tentang batas wewenang ("Keputusan ada di petugas ..."). */
  kalimatTetap: z.string(),
});

export const KanalSchema = z.object({
  nama: z.string().min(1),
  url: z.url().optional(),
  kontak: z.string().optional(),
});
export type Kanal = z.infer<typeof KanalSchema>;

export const HandoffEventSchema = event('handoff', {
  /** Kalimat untuk warga: kenapa dialihkan ke kanal resmi. */
  alasan: z.string().min(1),
  sebab: z.enum(['tanpa_sumber', 'kutipan_tidak_terverifikasi', 'kuota']),
  kanal: z.array(KanalSchema),
});

export const LangkahKartuSchema = z.object({
  id: z.string().min(1),
  jenis: JenisLangkahSchema,
  judul: z.string().min(1),
  lokasi: z.string().optional(),
  bawa: z.array(z.string()),
  /** Dokumen persyaratan langkah ini (registry: persyaratan nasional atau bundel kab/kota). */
  dokumen: z.array(z.string()).optional(),
  /** Keterangan langkah untuk warga: dasar persyaratan dan cara mengajukan di kanal resmi. */
  keterangan: z.string().optional(),
  sumber: z.array(SumberSchema),
});
export type LangkahKartu = z.infer<typeof LangkahKartuSchema>;

/** Satu kab/kota: kode empat digit + nama resmi Kepmendagri. */
export const WilayahRefSchema = z.object({
  kodeKabKota: KodeKabKotaSchema,
  nama: z.string().min(1),
});
export type WilayahRef = z.infer<typeof WilayahRefSchema>;

/** Wilayah yang dipakai rencana: KTP (yurisdiksi adminduk), domisili bila berbeda, tujuan (hanya pindah). */
export const WilayahRencanaSchema = z.object({
  ktp: WilayahRefSchema,
  domisili: WilayahRefSchema.optional(),
  tujuan: WilayahRefSchema.optional(),
});

export const PlanCardEventSchema = event('plan_card', {
  ringkasan: z.string(),
  langkah: z.array(LangkahKartuSchema).min(1),
  /** Wilayah yang menjadi dasar rencana (selalu ada pada rencana dari harness sejak gerbang wilayah). */
  wilayah: WilayahRencanaSchema.optional(),
  /** Tier rencana ini: `semi` hanya bila Browser Pendamping sanggup mengerjakan langkahnya di wilayah ini. */
  tier: TierSchema.optional(),
  /** Catatan untuk warga: kantor/situs yang berwenang, domisili beda, atau pindah dua Disdukcapil. */
  catatan: z.string().optional(),
  /**
   * Bantuan Browser Pendamping untuk rencana ini (aditif): `adapter` = alur tulisan tangan, `generik` = Navigator
   * generik di portal web resmi wilayah KTP. `keterangan` = kalimat templat untuk warga (apa yang dikerjakan AI,
   * apa yang tetap dikerjakan warga). Tidak ada = dipandu.
   */
  pendamping: z
    .object({
      jalur: z.enum(['adapter', 'generik']),
      host: z.string().min(1).max(253),
      keterangan: z.string().max(300),
    })
    .optional(),
});

/**
 * Wilayah urusan. `usulan` = kandidat (Data Diri KTP atau pilihan di perangkat) yang WAJIB dikonfirmasi warga;
 * `ditetapkan` = wilayah KTP yang sudah dipastikan warga (rencana diblokir sampai ada). Setiap penetapan
 * membawa keadaan lengkap (ktp + domisili + tujuan), jadi event terakhir = keadaan terkini.
 */
export const WilayahEventSchema = event('wilayah', {
  status: z.enum(['usulan', 'ditetapkan']),
  ktp: WilayahRefSchema,
  /** data_diri = Data Diri akun; pilihan = pemilih wilayah di perangkat; warga = disebut/dikonfirmasi warga. */
  sumber: z.enum(['data_diri', 'pilihan', 'warga']),
  domisili: WilayahRefSchema.optional(),
  tujuan: WilayahRefSchema.optional(),
});

export const ItemChecklistSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** ok = lengkap, perlu = masih perlu disiapkan, kurang = ada yang kurang/salah. */
  status: z.enum(['ok', 'perlu', 'kurang']),
  alasan: z.string().optional(),
});
export const ChecklistEventSchema = event('checklist', { item: z.array(ItemChecklistSchema) });

export const EligibilityEventSchema = event('eligibility', {
  mungkin: z.array(z.string()),
  perluKonfirmasi: z.array(z.string()),
});

/** Permintaan eksekusi untuk ekstensi; nilai placeholder di-resolve di sisi klien, bukan server. */
export const ExecutionRequestEventSchema = event('execution_request', {
  executionId: z.string().min(1),
  adapterId: z.string().min(1),
  flowId: z.string().min(1),
  /** Ringkasan tersamar untuk layar konfirmasi (tanpa data pribadi mentah). */
  ringkasan: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  /** Nama tool + hash parameter yang disetujui lewat konfirmasi. */
  tool: z.string(),
  paramsHash: z.string(),
  /**
   * Origin resmi yang dibuka adapter, bila bukan portal dukcapil kota urusan (mis. Samsat, OSS). Tanpa ini
   * server memakai origin portal kota dari registry.
   */
  origin: z.url().optional(),
  /** Alur baca-saja (cek status/informasi): tidak ada yang dikirim, jadi hasilnya tidak mengubah state urusan. */
  bacaSaja: z.boolean().optional(),
});

/** Menunggu bagian warga. */
export const GateEventSchema = event('gate', {
  jenis: z.enum(['konfirmasi', 'login', 'captcha', 'profil', 'final']),
  pesan: z.string(),
  /** Hanya `konfirmasi`: tool + hash parameter yang akan disetujui warga lewat POST /konfirmasi. */
  tool: z.string().optional(),
  paramsHash: z.string().optional(),
});

export const StateEventSchema = event('state', {
  state: UrusanStateSchema,
  tier: TierSchema.nullable(),
  version: z.number().int().nonnegative(),
  dari: UrusanStateSchema.optional(),
});

export const DegradedEventSchema = event('degraded', {
  /** Kemampuan yang sedang mati, mis. `vision`, `mikrofon`, `rerank`. */
  kapabilitas: z.array(z.string()),
  mode: z.enum(['hemat', 'tanpa_ai']).nullable(),
});

export const GalatEventSchema = event('error', {
  kode: z.enum([
    'TIMEOUT',
    'CONFLICT',
    'LLM_REFUSAL',
    'LLM_LENGTH',
    'LLM_CONTENT_FILTER',
    'LLM_FAILED',
    'QUOTA',
    'ABORTED',
    'INTERNAL',
  ]),
  pesanWarga: z.string().min(1),
  bisaUlang: z.boolean(),
});

export const TimeoutEventSchema = event('timeout', {});

/** Dikirim berkala agar proxy tidak memutus koneksi. Tidak punya `id:` dan tidak masuk tabel events. */
export const HeartbeatEventSchema = event('heartbeat', {});

export const DoneEventSchema = event('done', {
  turnId: z.string().min(1),
  status: z.enum(['selesai', 'timeout', 'galat', 'dibatalkan']),
  /** true di mode degraded "JSON satu aksi": klien boleh mengirim "lanjut" agar agen meneruskan. */
  lanjutkan: z.boolean(),
  degraded: z.boolean(),
  /** Versi urusan setelah turn (klaim turn dan klasifikasi menaikkan versi tanpa event `state`); klien memakainya sebagai expectedVersion berikutnya. */
  version: z.number().int().optional(),
});

export const GateRuleSchema = z.enum([
  'TOOL_NOT_ALLOWED_IN_STATE',
  'UNKNOWN_TOOL',
  'SCHEMA_INVALID',
  'PLACEHOLDER_OR_PII_IN_PARAM',
  'FINAL_REQUIRES_CITIZEN',
  'CONFIRMATION_REQUIRED',
  'CONFIRMATION_MISMATCH',
  'CONFIRMATION_EXPIRED',
  'ORIGIN_NOT_OFFICIAL',
  'QUOTA_EXCEEDED',
  'WILAYAH_BELUM_DITETAPKAN',
]);
export type GateRule = z.infer<typeof GateRuleSchema>;

/** Keputusan policy gate (audit/jejak). Bukan menunggu warga: lihat `gate`. */
export const PolicyGateEventSchema = event('policy_gate', {
  tool: z.string(),
  keputusan: z.enum(['allow', 'deny']),
  aturan: GateRuleSchema.optional(),
  pesan: z.string().optional(),
});

const HashHexSchema = z.string().regex(/^[0-9a-f]{64}$/);
/** Id aturan (validator/klasifikator/gerbang), mis. `REF_TIDAK_DIAMATI`. Tanpa teks bebas. */
const IdAturanSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/);
/** Token fitur klasifikator, mis. `submitterAsli`, `neg:kirim`. Tanpa nilai kolom. */
const TokenFiturSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_:.-]{0,47}$/);

/**
 * Satu catatan Navigator generik (ADR 0030) di rantai audit. TIDAK PERNAH memuat nilai isian, teks halaman,
 * atau ketukan warga: hanya sidik pengamatan, model/token, aksi tanpa nilai, putusan validator, kelas klik,
 * blokir gerbang tulis {metode, host, sha(path)}, persetujuan {rencanaHash, n}, ambil alih, dan bukti.
 */
export const CatatanPendampingSchema = z.discriminatedUnion('jenis', [
  z.object({
    jenis: z.literal('amati'),
    host: z.string().min(1).max(253),
    sidik: z.string().min(1).max(128),
    elemen: z.number().int().nonnegative(),
  }),
  z.object({
    jenis: z.literal('rencana'),
    model: z.string().min(1).max(100),
    tokenMasuk: z.number().int().nonnegative(),
    tokenKeluar: z.number().int().nonnegative(),
    rencanaHash: HashHexSchema,
    /** Aksi yang diusulkan tanpa nilai: jenis + ref saja. */
    aksi: z.array(z.object({ jenis: JenisAksiSchema, ref: RefSchema.optional() })).max(25),
  }),
  z.object({
    jenis: z.literal('validasi'),
    rencanaHash: HashHexSchema,
    putusan: z.enum(['terima', 'tolak']),
    aturan: z.array(IdAturanSchema).max(25),
    /** Aditif: hash rencana asal yang persetujuannya dipakai (validasi ulang sesudah ikat ulang ref). */
    asal: HashHexSchema.optional(),
  }),
  z.object({
    jenis: z.literal('klik'),
    ref: RefSchema,
    kelas: KelasKendaliSchema,
    /** Nomor aturan klasifikator yang cocok pertama (1..11). */
    aturan: z.number().int().min(1).max(20),
    fitur: z.array(TokenFiturSchema).max(20),
    putusan: z.enum(['izinkan', 'tolak']),
  }),
  z.object({
    jenis: z.literal('blokir'),
    metode: z.string().regex(/^[A-Z]{3,7}$/),
    host: z.string().min(1).max(253),
    jalurSha256: HashHexSchema,
    jendela: z.enum(['ai_diam', 'ai_isi', 'ai_klik']),
  }),
  z.object({
    jenis: z.literal('persetujuan'),
    rencanaHash: HashHexSchema,
    n: z.number().int().nonnegative(),
  }),
  z.object({
    jenis: z.literal('ambil_alih'),
    fase: z.enum(['mulai', 'selesai']),
    alasan: AlasanSerahkanSchema.optional(),
  }),
  /** Host di luar registry wilayah: diserahkan ke warga, tidak pernah ditambahkan saat runtime. */
  z.object({ jenis: z.literal('host_kandidat'), host: z.string().min(1).max(253) }),
  z.object({ jenis: z.literal('bukti'), bukti: PendampingBuktiSchema }),
  /**
   * Aditif: jumlah catatan worker yang terbuang karena buffer jejak penuh sebelum dikuras (`/jejak`
   * `terbuang`). Hanya angka, tanpa isi; tanda bahwa rantai audit sesi ini tidak lengkap.
   */
  z.object({ jenis: z.literal('jejak_terbuang'), n: z.number().int().positive().max(1_000_000) }),
  /**
   * Aditif: resi akhir satu eksekusi Navigator (tanpa nilai): cara berakhir, hash resi kanonik, dan hitungan
   * anggaran. Bukti nomor (bila ada) dicatat terpisah sebagai `bukti`.
   */
  z.object({
    jenis: z.literal('resi'),
    akhir: z.string().min(1).max(40),
    hash: HashHexSchema,
    halaman: z.number().int().nonnegative(),
    aksi: z.number().int().nonnegative(),
    panggilanLlm: z.number().int().nonnegative(),
  }),
]);
export type CatatanPendamping = z.infer<typeof CatatanPendampingSchema>;

/** Jejak Navigator generik (aditif). Tanpa nilai dan tanpa teks halaman. */
export const JejakPendampingEventSchema = event('jejak_pendamping', {
  executionId: z.string().min(1),
  catatan: CatatanPendampingSchema,
});

/**
 * POST /internal/sesi/jejak (web -> worker): kuras catatan audit Navigator yang dikumpulkan worker (blokir
 * gerbang tulis, kelas klik, ambil alih, persetujuan). Web menambahkannya sebagai `jejak_pendamping`.
 */
export const JejakSesiInternalSchema = PemilikSesiInternalSchema;
export type JejakSesiInternal = z.infer<typeof JejakSesiInternalSchema>;
export const JejakSesiResponseSchema = z.object({
  executionId: z.string().min(1),
  catatan: z.array(CatatanPendampingSchema).max(500),
  /** Catatan terlama yang terbuang karena buffer worker penuh sejak pengurasan terakhir. */
  terbuang: z.number().int().nonnegative(),
});
export type JejakSesiResponse = z.infer<typeof JejakSesiResponseSchema>;

export const UrusinEventSchema = z.discriminatedUnion('type', [
  ProgressEventSchema,
  AssistantTextEventSchema,
  GroundedAnswerEventSchema,
  HandoffEventSchema,
  PlanCardEventSchema,
  ChecklistEventSchema,
  EligibilityEventSchema,
  ExecutionRequestEventSchema,
  GateEventSchema,
  StateEventSchema,
  DegradedEventSchema,
  GalatEventSchema,
  TimeoutEventSchema,
  HeartbeatEventSchema,
  DoneEventSchema,
  PolicyGateEventSchema,
  WilayahEventSchema,
  JejakPendampingEventSchema,
]);

export type UrusinEvent = z.infer<typeof UrusinEventSchema>;
export type UrusinEventType = UrusinEvent['type'];
export type EventOf<T extends UrusinEventType> = Extract<UrusinEvent, { type: T }>;
/** Isi event tanpa amplop dan tanpa `type`. */
export type PayloadOf<T extends UrusinEventType> = Omit<EventOf<T>, 'seq' | 'at' | 'chainHead' | 'type'>;
/** Isi event tanpa field amplop: yang dihasilkan harness sebelum diberi seq/at/chainHead. */
export type EventPayload = {
  [T in UrusinEventType]: { type: T } & Omit<EventOf<T>, 'seq' | 'at' | 'chainHead' | 'type'>;
}[UrusinEventType];

export const EVENT_TYPES: readonly UrusinEventType[] = UrusinEventSchema.options.map(
  (o) => o.shape.type.value,
);
