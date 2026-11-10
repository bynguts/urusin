import { randomUUID } from 'node:crypto';
import { ADAPTERS } from '@urusin/adapters';
import { llmText } from '@urusin/core';
import { LAYANAN_KORPUS, cariPengetahuanTool } from '@urusin/rag';
import {
  KANAL_NASIONAL,
  REF_PERPRES,
  SEED_ENTRIES,
  cariWilayah,
  kanalWilayah,
  kontakDukcapil,
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
import {
  AFIRMASI,
  TEKS_WILAYAH,
  kalimatKanal,
  kartuRencana,
  kodeKtp,
  rencanaPeristiwa,
  wilayahUrusan,
} from './wilayah.js';

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
    const kode = kodeKtp(ctx.store, ctx.urusan) ?? args.kodeKabKota ?? null;
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
    const kode = kodeKtp(ctx.store, ctx.urusan) ?? args.kodeKabKota;
    const { entry } = routeByKode(kode);
    const out = await retrieve(ctx, `persyaratan ${args.layanan}`, kode, undefined);
    const head = `${entry.nama}: tingkat ${entry.tier}, validasi ${entry.validasi}. ${kalimatKanal(kode)}`;
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
              // Langkah karangan model tidak diberi sumber: kanal resmi bukan bukti isi langkahnya (cukup di catatan).
              langkah: args.langkah.map((l, i) => ({
                id: `l${i + 1}`,
                judul: l.judul,
                jenis: l.jenis === 'online-adapter' ? ('online-manual' as const) : l.jenis,
                bawa: l.bawa ?? [],
                sumber: [],
              })),
              wilayah: {
                ktp,
                ...(w.domisili ? { domisili: w.domisili } : {}),
                ...(w.tujuan ? { tujuan: w.tujuan } : {}),
              },
              tier: 'dipandu',
              catatan: `Langkah disusun asisten, belum bersumber. Pastikan di kanal resmi ${ktp.nama}: ${k.judul} (${k.url}).`,
            },
      ],
    };
  },
});

/**
 * Persyaratan dari registry untuk wilayah yang sudah dipastikan warga (dokumen + keterangan tiap langkah rencana),
 * sebagai potongan yang sah dikutip. Jadi "dokumen apa saja?" setelah rencana terjawab bersumber walau korpus RAG
 * tidak memuat pasal nasionalnya. Sumber: Perpres 96/2018 bila langkah merujuknya, selain itu sumber pertama langkah.
 */
export function chunkRencana(ctx: Pick<ToolContext, 'store' | 'urusan'>): ChunkRecord[] {
  const w = wilayahUrusan(ctx.store, ctx.urusan);
  if (!ctx.urusan.jenis || !w.ktp) return [];
  const r = rencanaPeristiwa(ctx.urusan.jenis, {
    ktp: w.ktp.kodeKabKota,
    domisili: w.domisili?.kodeKabKota ?? null,
    tujuan: w.tujuan?.kodeKabKota ?? null,
  });
  if (!r) return [];
  return r.langkah.flatMap((l) => {
    const ref = l.sourceRef.find((s) => s.url === REF_PERPRES.url) ?? l.sourceRef[0];
    if (!ref || l.dokumen.length === 0) return [];
    return [
      {
        refId: `rencana-${r.slug}-${l.id}`,
        text: `${l.judul}. Dokumen yang disiapkan: ${l.dokumen.join('; ')}. ${l.keterangan}`,
        url: ref.url,
        judul: ref.judul,
        instansi: ref.instansi,
        verifiedAt: l.verifiedAt,
      },
    ];
  });
}

const urlSama = (u: string) => u.trim().toLowerCase().replace(/\/+$/, '');

/**
 * Hand-off tanpa pengulangan: warga yang sudah diarahkan ke kanal yang sama tidak diberi hand-off identik lagi.
 * Kanal pengganti berurutan: kanal resmi wilayah (kanalWilayah: portal → situs Disdukcapil → nasional), situs
 * Disdukcapil terverifikasi, lalu kanal nasional. Bila semuanya sudah diberikan, tidak ada hand-off baru: model
 * diminta memberi langkah lain (isi kartu rencana atau datang ke kantor) tanpa mengulang kanal.
 */
function handoffTanpaUlang(ctx: ToolContext, h: PayloadOf<'handoff'>): ToolResult {
  const kunci = (k: { url?: string | undefined; nama: string }) => urlSama(k.url ?? k.nama);
  const sudah = new Set(
    ctx.store
      .eventsOfType(ctx.urusan.id, 'handoff', 20)
      .flatMap((e) => (e.payload as PayloadOf<'handoff'>).kanal.map(kunci)),
  );
  const biasa: ToolResult = {
    content: 'Tidak ada sumber resmi yang cukup; warga diarahkan ke kanal resmi.',
    endTurn: true,
    events: [{ type: 'handoff', ...h }],
  };
  if (h.kanal.some((k) => !sudah.has(kunci(k)))) return biasa;
  const kode = kodeKtp(ctx.store, ctx.urusan) ?? ctx.urusan.kodeKabKota;
  const calon: PayloadOf<'handoff'>['kanal'] = [];
  if (kode) {
    const k = kanalWilayah(kode);
    calon.push({ nama: k.instansi, url: k.url });
    const d = kontakDukcapil(kode);
    if (d)
      calon.push({
        nama: `Disdukcapil ${routeByKode(kode).entry.nama}`,
        url: d.website,
        ...(d.alamat ? { kontak: d.alamat } : {}),
      });
  }
  calon.push({ nama: KANAL_NASIONAL.instansi, url: KANAL_NASIONAL.url });
  const lain = calon.filter(
    (k, i) => !sudah.has(kunci(k)) && calon.findIndex((x) => kunci(x) === kunci(k)) === i,
  );
  const first = lain[0];
  if (first) {
    return {
      ...biasa,
      events: [
        {
          type: 'handoff',
          alasan: `Kanal yang tadi belum menjawab ini. Coba tanyakan ke ${first.nama} (${first.url}).`,
          sebab: h.sebab,
          kanal: lain,
        },
      ],
    };
  }
  const rencana = chunkRencana(ctx).map((c) => c.text);
  return {
    content: [
      `Hand-off ke kanal resmi yang sama (${h.kanal.map((k) => k.url ?? k.nama).join(', ')}) SUDAH diberikan sebelumnya: JANGAN ulangi kanal itu dan jangan mengulang jawaban tadi.`,
      rencana.length > 0
        ? `Beri langkah berikutnya yang berbeda dari isi kartu rencana: ${rencana.join(' | ')}`
        : 'Beri langkah berikutnya yang berbeda: tanyakan detail yang belum jelas, atau sarankan datang langsung ke kantor instansi itu dan bertanya ke petugas.',
    ].join(' '),
  };
}

/**
 * Jawaban persyaratan/prosedur: ditandai oleh tool ini (bukan regex). Tidak ada teks mentah yang di-stream;
 * hanya event progress, lalu objek tervalidasi (`grounded_answer`) atau `handoff`.
 */
export const urusanJawabPersyaratan = defineTool({
  name: 'urusan__jawab_persyaratan',
  description:
    'Susun jawaban bersumber atas pertanyaan persyaratan/prosedur dari potongan yang sudah dicari. Panggil setelah rag__cari_pengetahuan. Dokumen persyaratan rencana wilayah urusan (registry) selalu ikut sebagai sumber.',
  effect: 'answer',
  input: z.object({ pertanyaan: llmText().max(500) }),
  allowedStates: NON_TERMINAL_STATES,
  async execute(ctx, args): Promise<ToolResult> {
    const chunks = [...ctx.store.getChunks(ctx.urusan.id), ...chunkRencana(ctx)];
    const ctxHandoff = { kodeKabKota: ctx.urusan.kodeKabKota };
    if (chunks.length === 0)
      return handoffTanpaUlang(ctx, buildHandoff({ ...ctxHandoff, chunks }, 'tanpa_sumber'));

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
    if (verified.handoff) return { ...handoffTanpaUlang(ctx, verified.handoff), ...usage };
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
  // Tool ini juga dipanggil langsung tanpa urusan (e2e/alat Browser Pendamping): konteks urusan opsional.
  origin(args, ctx) {
    const kode = ctx?.urusan?.kodeKabKota ?? args.kodeKabKota;
    return alurBaca(routeByKode(kode).entry.adapterId, 'cek_status')?.origin;
  },
  execute(ctx, rawArgs): ToolResult {
    // Wilayah KTP yang sudah dipastikan warga menang atas kode dari model; tanpa urusan pakai argumen.
    const pasti = ctx?.urusan && ctx.store ? kodeKtp(ctx.store, ctx.urusan) : null;
    const args = { kodeKabKota: pasti ?? rawArgs.kodeKabKota };
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
      `Cek status pengajuan di ${entry.portal?.nama ?? entry.nama} lewat Browser Pendamping.`,
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
      'Cek info PKB di Samsat DKI Jakarta lewat Browser Pendamping.',
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
    return permintaanBaca(
      'oss__cari_nib',
      args,
      OSS_NIB,
      'cari_nib',
      'Cari NIB di OSS lewat Browser Pendamping.',
    );
  },
});

const teksPesan = (m: { content?: unknown }) => (typeof m.content === 'string' ? m.content : '');

/**
 * Bukti bahwa WARGA (bukan model) menyebut atau membenarkan wilayah ini: namanya/kodenya ada di pesan warga
 * urusan ini, atau pesan terakhir warga berupa "ya/betul" tepat setelah pesan asisten terakhir yang menyebut
 * wilayah itu. "Ya" atas pertanyaan lain tidak pernah dihitung, juga bila wilayahnya sama dengan usulan.
 * Pemetaan kecamatan → kab/kota oleh model (mis. Cikarang → Kab. Bekasi) karena itu wajib ditanyakan dulu.
 */
function dibenarkanWarga(ctx: ToolContext, w: Wilayah): boolean {
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
          content: `Wilayah ${peran[kunci]} belum pasti. ${TEKS_WILAYAH.pilihan} ${daftarPilihan(h)}. Tanyakan warga yang mana, lalu panggil lagi dengan nama lengkapnya.`,
        };
      if (tercatat[kunci] !== h.wilayah.kodeKabKota && !dibenarkanWarga(ctx, h.wilayah))
        return {
          content: `Belum dikonfirmasi warga. Tanyakan dulu: "${kunci === 'ktp' ? 'KTP Anda terdaftar di' : kunci === 'tujuan' ? 'Pindah ke' : 'Sekarang tinggal di'} ${h.wilayah.nama}, betul?" Panggil lagi setelah warga membenarkan.`,
        };
      pasti[kunci] = h.wilayah;
    }
    const ktp = pasti.ktp!;
    const { entry } = routeByKode(ktp.kodeKabKota);
    const pendamping = entry.adapterId
      ? `Browser Pendamping punya adapter di ${entry.portal?.nama ?? entry.nama}.`
      : 'Belum ada Browser Pendamping di sini: tingkat dipandu (warga mengisi sendiri dengan panduan).';
    return {
      content: [
        `${TEKS_WILAYAH.ditetapkan} ${ktp.nama}. ${kalimatKanal(ktp.kodeKabKota)} ${pendamping}`,
        pasti.domisili && pasti.domisili.kodeKabKota !== ktp.kodeKabKota
          ? `Domisili ${pasti.domisili.nama}: urusan kependudukan tetap di Disdukcapil ${ktp.nama}; langkah online bisa dari mana saja, tatap muka di kantor wilayah KTP.`
          : '',
        pasti.tujuan ? `Tujuan pindah: ${kalimatKanal(pasti.tujuan.kodeKabKota)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      // Hanya yang disebut di panggilan ini; domisili/tujuan yang tidak disebut tetap seperti sekarang.
      wilayah: {
        ktp: ktp.kodeKabKota,
        ...(pasti.domisili ? { domisili: pasti.domisili.kodeKabKota } : {}),
        ...(pasti.tujuan ? { tujuan: pasti.tujuan.kodeKabKota } : {}),
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
