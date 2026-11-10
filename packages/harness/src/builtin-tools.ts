import { randomUUID } from 'node:crypto';
import { ADAPTERS } from '@urusin/adapters';
import { llmText } from '@urusin/core';
import { LAYANAN_KORPUS, cariPengetahuanTool } from '@urusin/rag';
import {
  SEED_ENTRIES,
  cariWilayah,
  kanalWilayah,
  menyebutWilayah,
  routeByKode,
  type HasilCariWilayah,
  type Wilayah,
} from '@urusin/registry';
import { z } from 'zod';
import type { PayloadOf } from '@urusin/contracts';
import { KALIMAT_TETAP, buildHandoff, generateGroundedAnswer, verifyGrounded } from './grounding.js';
import { spotlight } from './spotlight.js';
import { paramsHash, type ChunkRecord } from './store.js';
import { NON_TERMINAL_STATES, defineTool, type ToolContext, type ToolDef, type ToolResult } from './tools.js';
import { keteranganPendamping, rutePendamping, tierUrusan } from './rencana.js';
import { kalimatKanal, kartuRencana, wilayahUrusan } from './wilayah.js';

const kodeKabKota = z.string().regex(/^\d{4}$/);

type Hit = ReturnType<typeof cariPengetahuanTool.execute>['hasil'][number];

/**
 * Anggaran per hit ditetapkan SEBELUM dibungkus (spotlight maxChars); keluaran terbungkus tidak boleh dipotong lagi.
 * Tanpa hasil: sebut kanal resmi wilayah itu sendiri (portal, situs Disdukcapil terverifikasi, atau nasional).
 */
export function formatHits(hits: readonly Hit[], nonce: string, max = 4, kode?: string | null): string {
  if (hits.length === 0)
    return `Tidak ada hasil di basis pengetahuan resmi. Arahkan warga ke kanal resmi${kode ? `: ${kalimatKanal(kode)}` : '.'}`;
  return hits
    .slice(0, max)
    .map(
      (h) =>
        `[${h.id}] ${h.kutipan.judul.slice(0, 120)} — ${h.kutipan.instansi.slice(0, 120)} (diverifikasi: ${h.verifiedAt ?? 'belum'})\n` +
        spotlight('rag', h.text, { nonce, id: h.id, maxChars: 500 }),
    )
    .join('\n');
}

/**
 * Retrieval untuk tool agen. Dengan `ragSearch` (produksi): hybrid BM25 + vektor + rerank endpoint, jatuh ke BM25
 * sendiri bila penyedia gagal. Tanpa itu (tes, mode demo): BM25 sinkron atas `ragDb`.
 */
async function retrieve(ctx: ToolContext, query: string, kode: string | null | undefined, layanan?: string) {
  const ragDb = ctx.deps.ragDb;
  if (!ragDb) return { hasil: [] as Hit[], tanpaHasil: true };
  const search = ctx.deps.ragSearch;
  const cari = async (lay?: string) => {
    const input = { query, ...(kode ? { kodeKabKota: kode } : {}), ...(lay ? { layanan: lay } : {}), k: 4 };
    return search ? await search(input) : cariPengetahuanTool.execute(ragDb, input);
  };
  // Kategori sah yang tetap 0 hasil (mis. salah kategori) tidak boleh memaksa abstain: ulangi tanpa filter.
  let out = await cari(layanan);
  if (layanan && out.hasil.length === 0) out = await cari();
  const chunks: ChunkRecord[] = out.hasil.map((h) => ({
    refId: h.id,
    text: h.text,
    url: h.kutipan.url,
    judul: h.kutipan.judul,
    instansi: h.kutipan.instansi,
    verifiedAt: h.verifiedAt,
  }));
  if (chunks.length > 0) ctx.store.saveChunks(ctx.urusan.id, chunks);
  return out;
}

export const ragCariPengetahuan = defineTool({
  name: 'rag__cari_pengetahuan',
  description:
    'Cari pengetahuan layanan publik dari korpus resmi. Hasil berupa potongan bersumber dengan [id]; id itulah refId untuk kutipan.',
  effect: 'read',
  spanOperation: 'retrieval',
  input: z.object({
    query: llmText().max(500),
    kodeKabKota: kodeKabKota.optional(),
    // Nilai di luar enum (mis. "akta kelahiran") diabaikan (`catch`), bukan ditolak atau memfilter ke 0 hasil.
    layanan: z
      .enum(LAYANAN_KORPUS)
      .optional()
      .catch(undefined)
      .describe(
        'Opsional. Kategori korpus, BUKAN nama layanan: adminduk (KTP, KK, akta, pindah), samsat (pajak kendaraan), lapor, ombudsman, oss (izin usaha), bansos, pdp, pemilu, bpjs, skck, sim, ikd. Kosongkan bila ragu; tulis nama layanan di query.',
      ),
  }),
  allowedStates: NON_TERMINAL_STATES,
  async execute(ctx, args): Promise<ToolResult> {
    // Wilayah urusan yang sudah dipastikan warga menang atas kode tebakan model.
    const kode = ctx.urusan.kodeKabKota ?? args.kodeKabKota ?? null;
    const out = await retrieve(ctx, args.query, kode, args.layanan);
    return { content: formatHits(out.hasil, ctx.nonce, 4, kode), terbungkus: true };
  },
});

export const dukcapilCekPersyaratan = defineTool({
  name: 'dukcapil__cek_persyaratan',
  description:
    'Cek persyaratan layanan kependudukan untuk satu kab/kota (dirutekan lewat registry). Mengembalikan tingkat otomasi kota dan potongan bersumber.',
  effect: 'read',
  spanOperation: 'retrieval',
  input: z.object({ kodeKabKota, layanan: llmText().max(80) }),
  allowedStates: NON_TERMINAL_STATES,
  async execute(ctx, args): Promise<ToolResult> {
    const kode = ctx.urusan.kodeKabKota ?? args.kodeKabKota;
    const { entry } = routeByKode(kode);
    const out = await retrieve(ctx, `persyaratan ${args.layanan}`, kode, undefined);
    const tier = tierUrusan({ jenis: ctx.urusan.jenis, kodeKabKota: kode }) ?? entry.tier;
    const head = `${entry.nama}: tingkat ${tier}, validasi ${entry.validasi}. ${kalimatKanal(kode)}`;
    return {
      content: `${head}
${formatHits(out.hasil, ctx.nonce, 4, kode)}`,
      terbungkus: true,
    };
  },
});

export const urusanUsulkanRencana = defineTool({
  name: 'urusan__usulkan_rencana',
  description:
    'Usulkan rencana langkah kepada warga untuk disetujui. Memindahkan urusan ke RENCANA_DIUSULKAN. Ditolak sampai wilayah KTP ditetapkan (wilayah__tetapkan).',
  effect: 'plan',
  butuhWilayah: true,
  input: z.object({
    ringkasan: llmText().max(300),
    langkah: z
      .array(
        z.object({
          judul: llmText().max(120),
          jenis: z.enum(['online-adapter', 'online-manual', 'offline']),
          bawa: z.array(llmText().max(80)).max(10).optional(),
        }),
      )
      .min(1)
      .max(10),
  }),
  allowedStates: ['MEMAHAMI'],
  execute(ctx, args): ToolResult {
    const w = wilayahUrusan(ctx.store, ctx.urusan);
    const ktp = w.ktp!; // dijamin gerbang wilayah (butuhWilayah)
    // Peristiwa Hidup: rencana deterministik untuk wilayah ini menang atas langkah karangan model.
    const kartu = ctx.urusan.jenis ? kartuRencana(ctx.urusan.jenis, w, ctx.deps.ragDb) : undefined;
    const k = kanalWilayah(ktp.kodeKabKota);
    const sumber = [{ url: k.url, judul: k.judul, instansi: k.instansi }];
    return {
      content: 'Rencana ditampilkan kepada warga untuk disetujui.',
      nextState: 'RENCANA_DIUSULKAN',
      endTurn: true,
      events: [
        kartu
          ? { type: 'plan_card', ...kartu }
          : {
              type: 'plan_card',
              ringkasan: args.ringkasan,
              // Model tidak boleh menjanjikan Browser Pendamping: tanpa alur adapter, semua langkah online = manual.
              langkah: args.langkah.map((l, i) => ({
                id: `l${i + 1}`,
                judul: l.judul,
                jenis: l.jenis === 'online-adapter' ? ('online-manual' as const) : l.jenis,
                bawa: l.bawa ?? [],
                sumber,
              })),
              wilayah: {
                ktp,
                ...(w.domisili ? { domisili: w.domisili } : {}),
                ...(w.tujuan ? { tujuan: w.tujuan } : {}),
              },
              tier: 'dipandu',
              catatan: `Diurus lewat ${k.judul} (${ktp.nama}).`,
            },
      ],
    };
  },
});

/**
 * Jawaban persyaratan/prosedur: ditandai oleh tool ini (bukan regex). Tidak ada teks mentah yang di-stream;
 * hanya event progress, lalu objek tervalidasi (`grounded_answer`) atau `handoff`.
 */
export const urusanJawabPersyaratan = defineTool({
  name: 'urusan__jawab_persyaratan',
  description:
    'Susun jawaban bersumber atas pertanyaan persyaratan/prosedur dari potongan yang sudah dicari. Panggil setelah rag__cari_pengetahuan.',
  effect: 'answer',
  input: z.object({ pertanyaan: llmText().max(500) }),
  allowedStates: NON_TERMINAL_STATES,
  async execute(ctx, args): Promise<ToolResult> {
    const chunks = ctx.store.getChunks(ctx.urusan.id);
    const ctxHandoff = { kodeKabKota: ctx.urusan.kodeKabKota };
    const handoffEvent = (sebab: PayloadOf<'handoff'>['sebab']): ToolResult => ({
      content: 'Tidak ada sumber resmi yang cukup; warga diarahkan ke kanal resmi.',
      endTurn: true,
      events: [{ type: 'handoff', ...buildHandoff({ ...ctxHandoff, chunks }, sebab) }],
    });
    if (chunks.length === 0) return handoffEvent('tanpa_sumber');

    const gen = await generateGroundedAnswer({
      provider: ctx.deps.provider,
      model: ctx.deps.model,
      caps: ctx.deps.caps,
      pertanyaan: args.pertanyaan,
      chunks,
      signal: ctx.signal,
    });
    const verified = verifyGrounded(gen.data, chunks, ctxHandoff, ctx.deps.now());
    const usage = { usage: gen.usage, structuredMode: gen.method };
    if (verified.handoff) {
      return {
        ...handoffEvent(verified.handoff.sebab),
        events: [{ type: 'handoff', ...verified.handoff }],
        ...usage,
      };
    }
    const data: PayloadOf<'grounded_answer'> = {
      klaim: verified.klaim,
      klaimDibuang: verified.klaimDibuang,
      kalimatTetap: KALIMAT_TETAP,
    };
    return {
      content: `Jawaban bersumber (${verified.klaim.length} klaim) sudah ditampilkan kepada warga.`,
      endTurn: true,
      events: [{ type: 'grounded_answer', ...data }],
      ...usage,
    };
  },
});

/** Tool tulis: hanya untuk kota berstatus `kirim-asli`. Menghasilkan ExecutionRequest, tidak mengeksekusi apa pun sendiri. */
export const dukcapilAjukanLayanan = defineTool({
  name: 'dukcapil__ajukan_layanan',
  description:
    'Ajukan layanan di portal resmi kota lewat Browser Pendamping (butuh confirmationId dari warga). Hanya kota berstatus kirim-asli.',
  effect: 'write',
  input: z.object({ kodeKabKota, layananId: z.number().int().positive() }),
  allowedStates: ['BERKAS_SIAP', 'MENGISI', 'MENUNGGU_KONFIRMASI', 'MENGUNGGAH'],
  origin(args, { urusan }) {
    // Hanya portal wilayah KTP urusan ini: kode lain dari model tidak pernah membuka situs kota lain.
    if (urusan.kodeKabKota && args.kodeKabKota !== urusan.kodeKabKota) return undefined;
    const { entry } = routeByKode(args.kodeKabKota);
    return entry.validasi === 'kirim-asli' ? entry.portal?.origin : undefined;
  },
  execute(_ctx, args): ToolResult {
    const { entry } = routeByKode(args.kodeKabKota);
    return {
      content:
        'Permintaan eksekusi dikirim ke Browser Pendamping; warga akan diminta mengizinkan sebelum diisi.',
      execution: {
        executionId: `x_${randomUUID()}`,
        adapterId: entry.adapterId ?? `dukcapil.${entry.kodeKabKota}`,
        flowId: 'ajukan',
        ringkasan: `Ajukan layanan ${args.layananId} di ${entry.portal?.nama ?? entry.nama}. Data pribadi tersamar.`,
        params: { layanan_id: args.layananId },
        tool: 'dukcapil__ajukan_layanan',
        paramsHash: paramsHash('dukcapil__ajukan_layanan', args),
      },
    };
  },
});

/**
 * Catatan jujur per adapter baca-saja: apa yang dikerjakan AI, apa yang tetap bagian warga, dan seberapa jauh
 * alurnya sudah teruji. Ditampilkan di layar konfirmasi dan dikembalikan ke model.
 */
const CATATAN_BACA: Readonly<Record<string, string>> = {
  'telunjuk-sakti-wonogiri':
    'Perlu masuk akun Telunjuk Sakti: Anda mengetik kata sandi dan CAPTCHA sendiri, lalu daftar permohonan dibaca.',
  'klampid-surabaya':
    'AI mengisi nomor kitir; Anda menjawab pertanyaan keamanan dan menekan Cari. Tampilan situs asli belum teramati (diuji pada replika).',
  'sidnok-semarang':
    'AI mengisi kode pelayanan; Anda menjawab pertanyaan keamanan dan menekan Cek Status. Diuji pada replika.',
  'samsat-dki':
    'Hanya kendaraan terdaftar di Samsat DKI Jakarta. AI mengisi nomor polisi; verifikasi situs (Turnstile) Anda selesaikan sendiri. Struktur halaman hasil belum teramati: hasilnya Anda baca di layar.',
  'oss-nib':
    'Pencarian NIB publik di oss.go.id. AI mengisi NIB; verifikasi situs (Turnstile) Anda selesaikan sendiri. Hasilnya Anda baca di layar.',
};

/** Alur baca-saja adapter bawaan, atau undefined bila adapter/alur tidak ada atau bukan baca-saja. */
export function alurBaca(
  adapterId: string | undefined,
  flowId: string,
): { adapterId: string; origin: string } | undefined {
  if (!adapterId || !Object.hasOwn(ADAPTERS, adapterId)) return undefined;
  const adapter = ADAPTERS[adapterId]!;
  const flow = Object.hasOwn(adapter.flows, flowId) ? adapter.flows[flowId] : undefined;
  return flow?.bacaSaja ? { adapterId, origin: adapter.origin } : undefined;
}

/**
 * ExecutionRequest baca-saja. Tanpa nilai pribadi: params kosong; nomor kitir/kode/nomor polisi/NIB adalah
 * placeholder adapter yang diisi lewat "Izinkan isi" (server) atau diketik warga di layar.
 */
function permintaanBaca(
  tool: string,
  args: unknown,
  alur: { adapterId: string; origin: string },
  flowId: string,
  ringkasan: string,
): ToolResult {
  const catatan = CATATAN_BACA[alur.adapterId] ?? '';
  return {
    content: `Baca saja, tidak ada yang dikirim. ${catatan} Warga diminta mengizinkan sebelum Browser Pendamping membuka situs.`,
    endTurn: true,
    execution: {
      executionId: `x_${randomUUID()}`,
      adapterId: alur.adapterId,
      flowId,
      ringkasan: `${ringkasan} Baca saja, tidak ada yang dikirim. ${catatan}`,
      params: {},
      tool,
      paramsHash: paramsHash(tool, args),
      origin: alur.origin,
      bacaSaja: true,
    },
  };
}

/** Kota yang adapternya punya alur cek status (diturunkan dari registry + adapter, bukan daftar tulisan tangan). */
const KOTA_CEK_STATUS = SEED_ENTRIES.filter((e) => alurBaca(e.adapterId, 'cek_status'))
  .map((e) => `${e.nama} (${e.portal?.nama ?? e.adapterId})`)
  .join(', ');

/** Cek status pengajuan kependudukan di portal kota (hanya kota yang adapternya punya alur cek_status). */
export const dukcapilCekStatus = defineTool({
  name: 'dukcapil__cek_status',
  description: `Cek status pengajuan kependudukan di portal resmi kota lewat Browser Pendamping (baca saja), untuk wilayah KTP urusan. Tersedia untuk: ${KOTA_CEK_STATUS}. Kota lain: arahkan ke kanal resmi.`,
  effect: 'read',
  input: z.object({ kodeKabKota }),
  allowedStates: NON_TERMINAL_STATES,
  origin(args, { urusan }) {
    return alurBaca(routeByKode(urusan.kodeKabKota ?? args.kodeKabKota).entry.adapterId, 'cek_status')
      ?.origin;
  },
  execute(ctx, rawArgs): ToolResult {
    const args = { kodeKabKota: ctx.urusan.kodeKabKota ?? rawArgs.kodeKabKota };
    const { entry } = routeByKode(args.kodeKabKota);
    const alur = alurBaca(entry.adapterId, 'cek_status');
    if (!alur) {
      const lewat = entry.portal
        ? ` lewat ${entry.portal.nama} (${entry.portal.origin})`
        : ` lewat ${kalimatKanal(args.kodeKabKota)}`;
      return {
        content: `${entry.nama}: tingkat dipandu untuk cek status. Browser Pendamping belum punya alur cek status di sini; warga mengecek sendiri${lewat}.`,
      };
    }
    return permintaanBaca(
      'dukcapil__cek_status',
      args,
      alur,
      'cek_status',
      `Cek status pengajuan di ${entry.portal?.nama ?? entry.nama} (tingkat ${entry.tier}).`,
    );
  },
});

function alurWajib(adapterId: string, flowId: string): { adapterId: string; origin: string } {
  const alur = alurBaca(adapterId, flowId);
  if (!alur) throw new Error(`alur baca-saja ${adapterId}/${flowId} tidak ada`);
  return alur;
}
const SAMSAT_DKI = alurWajib('samsat-dki', 'cek_pkb');
const OSS_NIB = alurWajib('oss-nib', 'cari_nib');

/** Info PKB kendaraan di Samsat DKI Jakarta. */
export const samsatCekPkb = defineTool({
  name: 'samsat__cek_pkb',
  description:
    'Cek info Pajak Kendaraan Bermotor (PKB) di situs resmi Samsat DKI Jakarta lewat Browser Pendamping (baca saja). Hanya kendaraan terdaftar di DKI Jakarta. Jangan sertakan nomor polisi: warga mengisinya di layar.',
  effect: 'read',
  input: z.object({}),
  allowedStates: NON_TERMINAL_STATES,
  origin: () => SAMSAT_DKI.origin,
  execute(_ctx, args): ToolResult {
    return permintaanBaca(
      'samsat__cek_pkb',
      args,
      SAMSAT_DKI,
      'cek_pkb',
      'Cek info PKB di Samsat DKI Jakarta (tingkat semi).',
    );
  },
});

/** Pencarian NIB publik di OSS. */
export const ossCariNib = defineTool({
  name: 'oss__cari_nib',
  description:
    'Cari data usaha berdasarkan NIB di widget publik "Pencarian NIB" oss.go.id lewat Browser Pendamping (baca saja). Jangan sertakan NIB: warga mengisinya di layar.',
  effect: 'read',
  input: z.object({}),
  allowedStates: NON_TERMINAL_STATES,
  origin: () => OSS_NIB.origin,
  execute(_ctx, args): ToolResult {
    return permintaanBaca('oss__cari_nib', args, OSS_NIB, 'cari_nib', 'Cari NIB di OSS (tingkat semi).');
  },
});

const AFIRMASI = /^\s*(ya|iya+|y|yes|betul|benar|bener|ok|oke|okay|yup|tepat|sesuai|sudah benar)\b/i;

const teksPesan = (m: { content?: unknown }) => (typeof m.content === 'string' ? m.content : '');

/**
 * Bukti bahwa WARGA (bukan model) menyebut atau membenarkan wilayah ini: namanya/kodenya ada di pesan warga
 * urusan ini, atau pesan terakhir warga berupa "ya/betul" atas usulan wilayah itu atau atas pertanyaan
 * terakhir asisten yang menyebutnya. Pemetaan kecamatan → kab/kota oleh model (mis. Cikarang → Kab. Bekasi)
 * karena itu wajib ditanyakan dulu.
 */
function dibenarkanWarga(ctx: ToolContext, w: Wilayah, usulan: string | null): boolean {
  const riwayat = ctx.store.loadHistory(ctx.urusan.id);
  const warga = [
    ctx.pesanWarga,
    ...riwayat
      .filter((m) => m.role === 'user')
      .map(teksPesan)
      .filter((t) => !t.startsWith('HASIL_TOOL')),
  ];
  if (warga.some((t) => menyebutWilayah(t, w))) return true;
  if (!AFIRMASI.test(ctx.pesanWarga)) return false;
  if (usulan === w.kodeKabKota) return true;
  const tanyaTerakhir = [...riwayat].reverse().find((m) => m.role === 'assistant' && teksPesan(m));
  return tanyaTerakhir ? menyebutWilayah(teksPesan(tanyaTerakhir), w) : false;
}

const daftarPilihan = (h: Extract<HasilCariWilayah, { status: 'ambigu' }>) =>
  h.pilihan.map((w) => `${w.nama} (${w.kodeKabKota}, ${w.provinsi})`).join('; ');

/**
 * Wilayah dulu: tetapkan kab/kota KTP warga (yurisdiksi Dukcapil), domisili bila berbeda, dan tujuan pindah.
 * Divalidasi ke 514 kab/kota; nama ganda (Bekasi = Kota/Kabupaten) dikembalikan sebagai pilihan untuk ditanyakan.
 */
export const wilayahTetapkan = defineTool({
  name: 'wilayah__tetapkan',
  description:
    'Tetapkan kab/kota sesuai KTP warga (wajib sebelum rencana), plus domisili bila warga tinggal di kab/kota lain, dan tujuan untuk urusan pindah. Isi nama ("Kota Surabaya", "Kab. Bekasi") atau kode 4 digit. Panggil hanya setelah warga menyebut atau membenarkan wilayahnya; jangan pernah meminta NIK.',
  effect: 'plan',
  input: z.object({
    ktp: llmText().max(80).describe('Kab/kota sesuai alamat KTP warga (untuk pindah: kab/kota asal).'),
    domisili: llmText()
      .max(80)
      .optional()
      .describe('Opsional. Kab/kota tempat tinggal sekarang, hanya bila berbeda dari KTP.'),
    tujuan: llmText().max(80).optional().describe('Hanya urusan pindah: kab/kota tujuan.'),
  }),
  allowedStates: ['MEMAHAMI', 'RENCANA_DIUSULKAN'],
  execute(ctx, args): ToolResult {
    const sekarang = wilayahUrusan(ctx.store, ctx.urusan);
    const usulan = sekarang.usulan?.ktp.kodeKabKota ?? null;
    // Wilayah yang SUDAH dipastikan warga tidak perlu dikonfirmasi ulang (mis. menambah tujuan pindah).
    const tercatat = {
      ktp: sekarang.ktp?.kodeKabKota,
      domisili: sekarang.domisili?.kodeKabKota,
      tujuan: sekarang.tujuan?.kodeKabKota,
    };
    const peran = { ktp: 'KTP', domisili: 'domisili', tujuan: 'tujuan' } as const;
    const pasti: Partial<Record<keyof typeof peran, Wilayah>> = {};
    for (const kunci of ['ktp', 'domisili', 'tujuan'] as const) {
      const teks = args[kunci];
      if (!teks) continue;
      const h = cariWilayah(teks);
      if (h.status === 'tidak_dikenal')
        return {
          content: `Wilayah ${peran[kunci]} tidak dikenal di 514 kab/kota. Tanyakan nama kabupaten/kotanya (bukan kecamatan/desa). Bila warga menyebut kecamatan atau kota kecil, sebutkan kab/kotanya dan minta warga membenarkan dulu.`,
        };
      if (h.status === 'ambigu')
        return {
          content: `Wilayah ${peran[kunci]} belum pasti. Pilihan: ${daftarPilihan(h)}. Tanyakan warga yang mana, lalu panggil lagi dengan nama lengkapnya.`,
        };
      if (
        tercatat[kunci] !== h.wilayah.kodeKabKota &&
        !dibenarkanWarga(ctx, h.wilayah, kunci === 'ktp' ? usulan : null)
      )
        return {
          content: `Belum dikonfirmasi warga. Tanyakan dulu: "${kunci === 'ktp' ? 'KTP Anda terdaftar di' : kunci === 'tujuan' ? 'Pindah ke' : 'Sekarang tinggal di'} ${h.wilayah.nama}, betul?" Panggil lagi setelah warga membenarkan.`,
        };
      pasti[kunci] = h.wilayah;
    }
    const ktp = pasti.ktp!;
    const { entry } = routeByKode(ktp.kodeKabKota);
    // Sama dengan rute yang ditawarkan saat rencana disetujui (adapter -> generik -> dipandu).
    const rute = ctx.urusan.jenis
      ? rutePendamping({ jenis: ctx.urusan.jenis, kodeKabKota: ktp.kodeKabKota })
      : undefined;
    const pendamping =
      rute && rute.jalur !== 'dipandu'
        ? `Browser Pendamping: ${keteranganPendamping(rute)}`
        : entry.adapterId
          ? `Browser Pendamping punya adapter di ${entry.portal?.nama ?? entry.nama}.`
          : 'Browser Pendamping belum tersedia untuk urusan ini: tingkat dipandu (warga mengisi sendiri dengan panduan).';
    return {
      content: [
        `Wilayah KTP ditetapkan: ${ktp.nama}. ${kalimatKanal(ktp.kodeKabKota)} ${pendamping}`,
        pasti.domisili && pasti.domisili.kodeKabKota !== ktp.kodeKabKota
          ? `Domisili ${pasti.domisili.nama}: urusan kependudukan tetap di Disdukcapil ${ktp.nama}; langkah online bisa dari mana saja, tatap muka di kantor wilayah KTP.`
          : '',
        pasti.tujuan ? `Tujuan pindah: ${kalimatKanal(pasti.tujuan.kodeKabKota)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      wilayah: {
        ktp: ktp.kodeKabKota,
        domisili: pasti.domisili?.kodeKabKota ?? null,
        tujuan: pasti.tujuan?.kodeKabKota ?? null,
      },
    };
  },
});

/** Terdaftar supaya percobaan memanggilnya ditolak gate dengan aturan yang jelas; tidak pernah ditawarkan ke model. */
export const dukcapilKlikSelesai = defineTool({
  name: 'dukcapil__klik_selesai',
  description: 'Klik "Selesai" pada pengiriman akhir. Hanya warga yang boleh melakukannya (gate.human).',
  effect: 'final',
  input: z.object({}),
  allowedStates: NON_TERMINAL_STATES,
  execute(): ToolResult {
    throw new Error('tool final tidak boleh dijalankan agen');
  },
});

export function builtinTools(): ToolDef[] {
  return [
    ragCariPengetahuan,
    dukcapilCekPersyaratan,
    urusanUsulkanRencana,
    urusanJawabPersyaratan,
    dukcapilAjukanLayanan,
    dukcapilKlikSelesai,
    dukcapilCekStatus,
    samsatCekPkb,
    ossCariNib,
    wilayahTetapkan,
  ] as unknown as ToolDef[];
}
