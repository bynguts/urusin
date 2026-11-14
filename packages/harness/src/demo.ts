import {
  FakeProvider,
  fakeCompletion,
  type ChatCompletion,
  type ChatMessage,
  type ChatParams,
  type FakeProviderOptions,
  type RequestOptions,
} from '@urusin/llm';
import { openDb, upsertChunks, type Db } from '@urusin/rag';
import {
  REF_PERPRES_TEKS,
  REF_PMD108,
  REF_PMD7_2026,
  REF_UU23,
  REF_UU24,
  temukanWilayah,
  type SourceRef,
} from '@urusin/registry';
import { INTENT_JENIS, type IntentJenis } from './intent.js';
import { DATAMARK } from './spotlight.js';
import { AFIRMASI, TEKS_WILAYAH } from './wilayah.js';

/**
 * Model palsu "cukup pintar" untuk dijalankan tanpa kunci LLM (demo lokal, eval CI): klasifikasi intent
 * berbasis kata kunci, memanggil rag__cari_pengetahuan lalu urusan__jawab_persyaratan, dan menyusun jawaban
 * bersumber dengan menyalin potongan dari sumber yang diberikan. Deterministik dan tanpa jaringan.
 */
const INTENT_KEYWORDS: [RegExp, IntentJenis][] = [
  [/lahir|bayi|kelahiran/i, 'kelahiran'],
  [/meninggal|kematian|wafat/i, 'kematian'],
  [/nikah|menikah|kawin|pernikahan/i, 'perkawinan'],
  [/pindah|domisili|skpwni/i, 'pindah'],
  [/skck/i, 'skck'],
  [/pajak|stnk|kendaraan|samsat/i, 'pajak_kendaraan'],
  [/\bdpt\b|pemilu|pilkada/i, 'cek_dpt'],
  [/bansos|bantuan sosial|pkh/i, 'bansos'],
  [/lapor|pengaduan|aduan|keluhan/i, 'pengaduan'],
  [/\bktp\b|ktp-el/i, 'ktp'],
  [/\bkk\b|kartu keluarga/i, 'kk'],
  [
    /(?<!\b(?:mobil|motor|kendaraan|dealer|merek|merk)\s+)\bkia\b(?!\s+(?:sonet|picanto|seltos|carens|carnival|rio|sportage|motors?)\b)|kartu identitas anak|kartu anak/i,
    'kia',
  ],
  [/akta/i, 'akta'],
];

export function demoIntent(text: string): IntentJenis {
  for (const [re, jenis] of INTENT_KEYWORDS) if (re.test(text)) return jenis;
  return 'lainnya';
}

const text = (m: ChatMessage | undefined): string =>
  typeof m?.content === 'string'
    ? m.content
    : Array.isArray(m?.content)
      ? m.content.map((p) => ('text' in p ? p.text : '')).join(' ')
      : '';

function lastUserText(messages: readonly ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user' && !text(m).startsWith('HASIL_TOOL')) return text(m);
  }
  return '';
}

/** Jenis keluaran terstruktur yang diminta (dari nama skema, deskripsi tool emit_result, atau skema di prompt). */
function structuredKind(params: ChatParams): 'intent' | 'grounded' | 'action' | null {
  const hint = (s: string) =>
    /klasifikasi_urusan|keyakinan/.test(s)
      ? 'intent'
      : /jawab_persyaratan|"klaim"/.test(s)
        ? 'grounded'
        : /aksi_agen|argsJson/.test(s)
          ? 'action'
          : null;
  const rf = params.response_format;
  if (rf?.type === 'json_schema') return hint(JSON.stringify(rf.json_schema));
  const tool = params.tools?.find((t) => t.type === 'function' && t.function.name === 'emit_result');
  if (tool?.type === 'function')
    return hint(`${tool.function.description ?? ''}${JSON.stringify(tool.function.parameters)}`);
  if (rf?.type === 'json_object') {
    const sys = [...params.messages]
      .reverse()
      .find((m) => m.role === 'system' && text(m).startsWith('Balas HANYA'));
    return sys ? hint(text(sys)) : null;
  }
  return null;
}

const STOP = new Set([
  'apa',
  'syarat',
  'persyaratan',
  'saja',
  'yang',
  'dan',
  'untuk',
  'saya',
  'cara',
  'bagaimana',
  'dengan',
  'atau',
  'dari',
  'kamu',
  'perlu',
  'ingin',
  'mau',
  'dokumen',
  'berkas',
  'tahun',
  // "ingin tahu" bukan kata kunci layanan; tanpa ini prefiks "tahu" cocok dengan "tahun" di korpus.
  'tahu',
  'harus',
  'disiapkan',
  'membuat',
  'mengurus',
  'ini',
  'itu',
  'ada',
  'kami',
  'anda',
  'baru',
  'saja',
]);

/** Sumber paling relevan dari blok SUMBER (`[refId] judul` + blok data ber-spotlight); null bila tak ada yang cocok. */
function bestSource(prompt: string): { refId: string; quote: string } | null {
  // Pertanyaan dibungkus spotlight: ambil isinya, tanda datamark kembali jadi spasi.
  const baris = /Pertanyaan warga: ([^\n]*)/.exec(prompt)?.[1] ?? '';
  const question = (/>>([\s\S]*?)<</.exec(baris)?.[1] ?? baris).split(DATAMARK).join(' ').toLowerCase();
  const stems = [...new Set(question.match(/\p{L}{3,}/gu) ?? [])]
    .filter((w) => !STOP.has(w))
    .map((w) => w.slice(0, 5));
  let best: { refId: string; quote: string; score: number } | null = null;
  const re = /\[([^\]\s]+)\] [^\n]*\n<<DATA_TAK_TEPERCAYA[^>]*>>([\s\S]*?)<<\/DATA_TAK_TEPERCAYA/g;
  for (const m of prompt.matchAll(re)) {
    if (!m[1] || !m[2]) continue;
    const words = m[2].split(DATAMARK).filter(Boolean);
    const body = words.join(' ').toLowerCase();
    const score = stems.filter((st) => body.includes(st)).length;
    if (score >= 2 && (!best || score > best.score))
      best = { refId: m[1], quote: words.slice(0, 9).join(' '), score };
  }
  return best;
}

const wantsFacts = (t: string) =>
  /syarat|persyaratan|cara|bagaimana|biaya|dokumen|berkas|bawa|urus|buat|daftar|\?/i.test(t);

/** Catatan state harness terakhir (pesan system "STATE URUSAN: ..."). */
function stateNote(messages: readonly ChatMessage[]): string {
  return text(
    [...messages].reverse().find((m) => m.role === 'system' && text(m).startsWith('STATE URUSAN:')),
  );
}

/**
 * Wilayah yang disebut warga (nama terpanjang menang, lihat `temukanWilayah`): yang didahului "ke" = tujuan,
 * lainnya = KTP/asal, menurut urutan kemunculan. Nama ganda (Bekasi) dikirim apa adanya; tool yang menanyakan.
 */
function sebutanWilayah(t: string): { ktp?: string; tujuan?: string } {
  const out: { ktp?: string; tujuan?: string } = {};
  const sudah = new Set<number>();
  for (const x of temukanWilayah(t)) {
    if (sudah.has(x.mulai)) continue;
    sudah.add(x.mulai);
    const sebut = x.jenisDisebut ? `${x.jenisDisebut === 'kota' ? 'Kota' : 'Kabupaten'} ${x.teks}` : x.teks;
    if (x.sebelum === 'ke') out.tujuan ??= sebut;
    else out.ktp ??= sebut;
  }
  return out;
}

/**
 * Wilayah dulu (seperti arahan prompt): selama catatan state menyebut wilayah KTP belum ditetapkan (atau tujuan
 * pindah belum ada), tetapkan dari ucapan warga atau tanyakan. null = wilayah sudah siap, lanjut alur biasa.
 */
function langkahWilayah(
  messages: readonly ChatMessage[],
  userText: string,
  lastToolName: string | undefined,
  lastToolResult: string,
): { tool: string; args: Record<string, unknown> } | { reply: string } | null {
  const note = stateNote(messages);
  // Rencana Peristiwa Hidup diblokir sampai wilayah siap: tanyakan dulu. Urusan lain dijawab dari korpus nasional.
  const peristiwa = /Jenis urusan: (kelahiran|kematian|perkawinan|pindah)\./.test(note);
  const belumKtp = peristiwa && note.includes(TEKS_WILAYAH.belum);
  const belumTujuan = note.includes(TEKS_WILAYAH.butuhTujuan);
  if (lastToolName === 'wilayah__tetapkan') {
    if (lastToolResult.startsWith(TEKS_WILAYAH.ditetapkan)) {
      if (belumTujuan) return { reply: 'Pindah ke kabupaten/kota mana?' };
      // Warga sekaligus bertanya persyaratan: lanjut mencari sumber untuk wilayahnya.
      if (wantsFacts(userText)) return null;
      return {
        reply: 'Terima kasih, wilayah KTP sudah dicatat. Rencana disusun dari kanal resmi wilayah Anda.',
      };
    }
    const pilihan = new RegExp(`${TEKS_WILAYAH.pilihan} ([^.]+)\\.`).exec(lastToolResult)?.[1];
    return {
      reply: pilihan
        ? `Maksud Anda yang mana: ${pilihan}?`
        : 'KTP Anda terdaftar di kabupaten/kota mana? Sebutkan nama kabupaten/kotanya.',
    };
  }
  if (lastToolName || (!belumKtp && !belumTujuan)) return null;
  const sebut = sebutanWilayah(userText);
  if (belumKtp) {
    const usulan = new RegExp(`${TEKS_WILAYAH.usulan} \\([^)]*\\): (.+?)\\. Tanyakan`).exec(note)?.[1];
    if (sebut.ktp)
      return {
        tool: 'wilayah__tetapkan',
        args: { ktp: sebut.ktp, ...(sebut.tujuan ? { tujuan: sebut.tujuan } : {}) },
      };
    if (usulan && AFIRMASI.test(userText)) return { tool: 'wilayah__tetapkan', args: { ktp: usulan } };
    return {
      reply: usulan
        ? `Aturan dan situs resmi berbeda di tiap kab/kota. KTP Anda terdaftar di ${usulan}, betul?`
        : 'Aturan dan situs resmi berbeda di tiap kab/kota. KTP Anda terdaftar di kabupaten/kota mana?',
    };
  }
  const ktpTercatat = new RegExp(`${TEKS_WILAYAH.baris} (.+?) \\(\\d{4}\\)`).exec(note)?.[1];
  const tujuan = sebut.tujuan ?? sebut.ktp;
  if (tujuan && ktpTercatat) return { tool: 'wilayah__tetapkan', args: { ktp: ktpTercatat, tujuan } };
  return { reply: 'Pindah ke kabupaten/kota mana?' };
}

/** Langkah berikutnya untuk agen: tool-call berikutnya atau balasan teks. */
function nextAction(
  messages: readonly ChatMessage[],
  intent: (text: string) => IntentJenis = demoIntent,
): { tool: string; args: Record<string, unknown> } | { reply: string } {
  const userText = lastUserText(messages);
  const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user');
  const after = messages.slice(lastUserIdx + 1);
  const lastAssistantTool = [...after].reverse().find((m) => m.role === 'assistant' && m.tool_calls?.length);
  const namaTerakhir =
    lastAssistantTool?.role === 'assistant' && lastAssistantTool.tool_calls?.[0]?.type === 'function'
      ? lastAssistantTool.tool_calls[0].function.name
      : undefined;
  // Menetapkan jenis bukan langkah alur: sesudahnya lanjut seolah belum ada tool.
  const toolTerakhir = namaTerakhir === 'urusan__tetapkan_jenis' ? undefined : namaTerakhir;
  const lastToolResult = toolTerakhir ? text([...after].reverse().find((m) => m.role === 'tool')) : '';
  // Jenis belum diketahui (kata kunci/embedding harness tidak mengenali): model menetapkannya sendiri.
  const note = stateNote(messages);
  if (
    !namaTerakhir &&
    /Jenis urusan: belum diketahui\./.test(note) &&
    /Tool yang boleh dipakai sekarang: [^\n]*\burusan__tetapkan_jenis\b/.test(note)
  ) {
    const jenis = intent(userText);
    return {
      tool: 'urusan__tetapkan_jenis',
      args: { jenis: INTENT_JENIS.includes(jenis) ? jenis : 'lainnya' },
    };
  }
  const wilayah = langkahWilayah(messages, userText, toolTerakhir, lastToolResult);
  if (wilayah) return wilayah;
  // Wilayah baru saja ditetapkan dan warga bertanya persyaratan: lanjut seolah belum ada tool.
  const lastToolName = toolTerakhir === 'wilayah__tetapkan' ? undefined : toolTerakhir;
  if (!wantsFacts(userText) && !lastToolName)
    return { reply: 'Halo! Saya Urusin. Ceritakan urusan apa yang ingin Anda selesaikan.' };
  if (!lastToolName) return { tool: 'rag__cari_pengetahuan', args: { query: userText.slice(0, 400) } };
  if (lastToolName === 'rag__cari_pengetahuan')
    return { tool: 'urusan__jawab_persyaratan', args: { pertanyaan: userText.slice(0, 400) } };
  return { reply: 'Sudah saya tampilkan. Ada yang ingin ditanyakan lagi?' };
}

export type DemoHandler = (params: ChatParams) => ChatCompletion | undefined;

export type DemoProviderOptions = FakeProviderOptions & {
  /** Ambil alih respons tertentu (mis. suntik perilaku "patuh injeksi"); kembalikan undefined untuk perilaku default. */
  override?: DemoHandler;
  /** Tiru model yang salah mengklasifikasi (untuk tes eval). */
  intentOverride?: (text: string) => IntentJenis;
};

export class DemoProvider extends FakeProvider {
  constructor(private readonly demo: DemoProviderOptions = {}) {
    super(demo);
  }

  override async create(params: ChatParams, opts: RequestOptions = {}): Promise<ChatCompletion> {
    const handled = this.demo.override?.(params);
    if (handled) {
      // catat panggilan lewat jalur antrean agar `calls` tetap lengkap
      this.enqueue(handled);
      return super.create(params, opts);
    }
    this.enqueue(this.respond(params));
    return super.create(params, opts);
  }

  private respond(params: ChatParams): ChatCompletion {
    const kind = structuredKind(params);
    const userText = lastUserText(params.messages);
    const asStructured = (value: unknown): ChatCompletion => {
      const json = JSON.stringify(value);
      return params.response_format
        ? fakeCompletion({ content: json })
        : fakeCompletion({ toolCalls: [{ name: 'emit_result', arguments: json }] });
    };
    if (kind === 'intent') {
      const jenis = (this.demo.intentOverride ?? demoIntent)(userText);
      return asStructured({ jenis: INTENT_JENIS.includes(jenis) ? jenis : 'lainnya', keyakinan: 0.9 });
    }
    if (kind === 'grounded') {
      const src = bestSource(params.messages.map(text).join('\n'));
      return asStructured({
        klaim: src
          ? [
              {
                teks: 'Menurut sumber resmi, ini hal yang perlu Anda siapkan.',
                kutipan: [{ refId: src.refId, kutipanPersis: src.quote }],
              },
            ]
          : [],
        handoff: null,
      });
    }
    const next = nextAction(params.messages, this.demo.intentOverride ?? demoIntent);
    if (kind === 'action') {
      return asStructured(
        'tool' in next
          ? {
              jenis: 'tool',
              nama: next.tool,
              argsJson: JSON.stringify(next.args),
              teks: null,
              confirmationId: null,
            }
          : { jenis: 'balas', teks: next.reply, nama: null, argsJson: null, confirmationId: null },
      );
    }
    return 'tool' in next
      ? fakeCompletion({ toolCalls: [{ name: next.tool, arguments: JSON.stringify(next.args) }] })
      : fakeCompletion({ content: next.reply });
  }
}

/** Sumber chunk contoh yang tidak menyebut pasal; chunk yang menyebut pasal memakai teks resmi peraturannya. */
const CONTOH: SourceRef = {
  url: 'https://dukcapil.kemendagri.go.id/layanan',
  judul: 'Ditjen Dukcapil',
  instansi: 'Direktorat Jenderal Dukcapil (data contoh)',
};

/** Korpus contoh untuk demo/eval; judul diberi tanda "(contoh)" karena bukan hasil ingest resmi. */
export const DEMO_CHUNKS = [
  {
    id: 'demo-akta-lahir-1',
    text: 'Persyaratan akta kelahiran: surat keterangan lahir dari rumah sakit atau bidan, buku nikah atau kutipan akta perkawinan, Kartu Keluarga orang tua, dan KTP elektronik kedua orang tua. Pengurusan akta kelahiran tidak dipungut biaya. Kelahiran dilaporkan paling lambat 60 hari; lewat dari itu akta tetap terbit setelah keputusan Kepala Disdukcapil, tanpa penetapan pengadilan (UU 24/2013 Pasal 27, 32, dan 79A).',
    judul: 'Akta Kelahiran (contoh)',
    layanan: 'adminduk',
    sumber: REF_UU24,
  },
  {
    id: 'demo-kk-1',
    text: 'Persyaratan perubahan Kartu Keluarga: Kartu Keluarga lama, surat pengantar RT dan RW, dan dokumen pendukung perubahan seperti akta kelahiran atau akta perkawinan.',
    judul: 'Kartu Keluarga (contoh)',
    layanan: 'adminduk',
    sumber: CONTOH,
  },
  {
    id: 'demo-ktp-1',
    text: 'Penggantian KTP elektronik yang hilang: surat keterangan kehilangan dari kepolisian dan Kartu Keluarga. KTP elektronik rusak cukup diganti dengan menyerahkan KTP yang rusak dan Kartu Keluarga, tanpa surat kepolisian. Bila tidak ada perubahan data, KTP elektronik juga bisa dicetak di Dinas Kependudukan di luar domisili (Perpres 96/2018 Pasal 21 dan 22).',
    judul: 'KTP Elektronik Hilang (contoh)',
    layanan: 'adminduk',
    sumber: REF_PERPRES_TEKS,
  },
  {
    id: 'demo-pindah-1',
    text: 'Pindah antar kabupaten kota memerlukan surat keterangan pindah (SKPWNI) dari Dinas Kependudukan daerah asal, berlaku 100 hari kerja. Di daerah tujuan, Dinas Kependudukan memberikan Kartu Keluarga dan KTP elektronik alamat baru berdasarkan SKPWNI itu dan menarik KTP lama. Pindah dalam satu kabupaten kota cukup satu kali lapor (Permendagri 108/2019 Pasal 29 sampai 31).',
    judul: 'Pindah Domisili (contoh)',
    layanan: 'adminduk',
    sumber: REF_PMD108,
  },
  {
    id: 'demo-kematian-1',
    text: 'Akta kematian diurus dengan surat keterangan kematian dari rumah sakit atau kelurahan, Kartu Keluarga almarhum, dan KTP elektronik almarhum serta pelapor. Kematian dilaporkan paling lambat 30 hari sejak tanggal kematian (UU 24/2013 Pasal 44).',
    judul: 'Akta Kematian (contoh)',
    layanan: 'adminduk',
    sumber: REF_UU24,
  },
  {
    id: 'demo-nikah-1',
    text: 'Pencatatan perkawinan memerlukan surat keterangan menikah dari tokoh agama, Kartu Keluarga, KTP elektronik kedua mempelai, dan pas foto bersama. Perkawinan non-Muslim dicatat Dinas Kependudukan paling lambat 60 hari; perkawinan Muslim dicatat KUA kecamatan dan tidak diterbitkan kutipan akta perkawinan oleh Dukcapil (UU 23/2006 Pasal 34).',
    judul: 'Pencatatan Perkawinan (contoh)',
    layanan: 'adminduk',
    sumber: REF_UU23,
  },
  {
    id: 'demo-kia-1',
    text: 'Kartu Identitas Anak (KIA) mengikuti Permendagri 7/2026: KIA anak di bawah 5 tahun yang terbit bersama akta kelahiran cukup melampirkan fotokopi Kartu Keluarga; anak di bawah 5 tahun yang sudah memiliki akta melampirkan fotokopi akta kelahiran dan Kartu Keluarga; anak 5 sampai 17 tahun menambah 1 pas foto berwarna 2x3. KIA juga bisa diajukan online lewat aplikasi IKD.',
    judul: 'Kartu Identitas Anak (contoh)',
    layanan: 'adminduk',
    sumber: REF_PMD7_2026,
  },
] as const;

export function createDemoRagDb(): Db {
  const db = openDb(':memory:');
  upsertChunks(
    db,
    DEMO_CHUNKS.map((c) => ({
      id: c.id,
      text: c.text,
      sourceRef: { url: c.sumber.url, judul: c.judul, instansi: c.sumber.instansi },
      verifiedAt: '2026-11-01T00:00:00.000Z',
      layanan: c.layanan,
    })),
  );
  return db;
}
