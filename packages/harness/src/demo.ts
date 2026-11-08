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
import { INTENT_JENIS, type IntentJenis } from './intent.js';
import { DATAMARK } from './spotlight.js';

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

/** Ambil chunk pertama dari blok SUMBER (format `[refId] judul\n<<DATA...>>teks<</DATA...>>`). */
function firstSource(prompt: string): { refId: string; quote: string } | null {
  const m = /\[([^\]\s]+)\] [^\n]*\n<<DATA_TAK_TEPERCAYA[^>]*>>([\s\S]*?)<<\/DATA_TAK_TEPERCAYA/.exec(prompt);
  if (!m?.[1] || !m[2]) return null;
  const words = m[2].split(DATAMARK).filter(Boolean);
  return { refId: m[1], quote: words.slice(0, 9).join(' ') };
}

/** Langkah berikutnya untuk agen: tool-call berikutnya atau balasan teks. */
function nextAction(
  messages: readonly ChatMessage[],
): { tool: string; args: Record<string, unknown> } | { reply: string } {
  const userText = lastUserText(messages);
  const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user');
  const after = messages.slice(lastUserIdx + 1);
  const lastAssistantTool = [...after].reverse().find((m) => m.role === 'assistant' && m.tool_calls?.length);
  const lastToolName =
    lastAssistantTool?.role === 'assistant' && lastAssistantTool.tool_calls?.[0]?.type === 'function'
      ? lastAssistantTool.tool_calls[0].function.name
      : undefined;
  const wantsFacts = /syarat|persyaratan|cara|bagaimana|biaya|dokumen|berkas|bawa|urus|buat|daftar|\?/i.test(
    userText,
  );
  if (!wantsFacts && !lastToolName)
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
      const src = firstSource(params.messages.map(text).join('\n'));
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
    const next = nextAction(params.messages);
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

/** Korpus contoh untuk demo/eval; judul diberi tanda "(contoh)" karena bukan hasil ingest resmi. */
export const DEMO_CHUNKS = [
  {
    id: 'demo-akta-lahir-1',
    text: 'Persyaratan akta kelahiran: surat keterangan lahir dari rumah sakit atau bidan, Kartu Keluarga orang tua, dan KTP elektronik kedua orang tua. Pengurusan akta kelahiran tidak dipungut biaya.',
    judul: 'Akta Kelahiran (contoh)',
    layanan: 'akta-kelahiran',
  },
  {
    id: 'demo-kk-1',
    text: 'Persyaratan perubahan Kartu Keluarga: Kartu Keluarga lama, surat pengantar RT dan RW, dan dokumen pendukung perubahan seperti akta kelahiran atau akta perkawinan.',
    judul: 'Kartu Keluarga (contoh)',
    layanan: 'kartu-keluarga',
  },
  {
    id: 'demo-ktp-1',
    text: 'Penggantian KTP elektronik yang hilang: surat keterangan kehilangan dari kepolisian, Kartu Keluarga, dan fotokopi dokumen identitas lain bila ada. Pencetakan dilakukan di kantor Dinas Kependudukan.',
    judul: 'KTP Elektronik Hilang (contoh)',
    layanan: 'ktp-el',
  },
  {
    id: 'demo-pindah-1',
    text: 'Pindah antar kabupaten kota memerlukan surat keterangan pindah dari daerah asal dan surat keterangan datang di daerah tujuan sebelum Kartu Keluarga diperbarui.',
    judul: 'Pindah Domisili (contoh)',
    layanan: 'pindah',
  },
  {
    id: 'demo-kematian-1',
    text: 'Akta kematian diurus dengan surat keterangan kematian dari rumah sakit atau kelurahan, Kartu Keluarga almarhum, dan KTP elektronik almarhum serta pelapor.',
    judul: 'Akta Kematian (contoh)',
    layanan: 'akta-kematian',
  },
  {
    id: 'demo-nikah-1',
    text: 'Pencatatan perkawinan memerlukan surat keterangan menikah dari tokoh agama, Kartu Keluarga, KTP elektronik kedua mempelai, dan pas foto bersama.',
    judul: 'Pencatatan Perkawinan (contoh)',
    layanan: 'perkawinan',
  },
] as const;

export function createDemoRagDb(): Db {
  const db = openDb(':memory:');
  upsertChunks(
    db,
    DEMO_CHUNKS.map((c) => ({
      id: c.id,
      text: c.text,
      sourceRef: {
        url: 'https://dukcapil.kemendagri.go.id/layanan',
        judul: c.judul,
        instansi: 'Direktorat Jenderal Dukcapil (data contoh)',
      },
      verifiedAt: '2026-11-01T00:00:00.000Z',
      layanan: c.layanan,
    })),
  );
  return db;
}
