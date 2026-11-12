import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OpenAIProvider,
  applyForcedOff,
  loadLlmConfig,
  probeCapabilities,
  type ChatParams,
  type ChatProvider,
  type ChatStreamParams,
  type RequestOptions,
} from '@urusin/llm';
import { createRagSearcher, openDb } from '@urusin/rag';
import type { UrusinEvent } from '@urusin/contracts';
import { runTurn } from '../agent.js';
import { CacheJawaban } from '../grounding.js';
import { createHarness } from '../runtime.js';

/**
 * Benchmark latensi rencana (LLM NYATA, korpus RAG produksi, BM25 saja): enam persona satu pesan pembuka,
 * diukur dari pesan warga sampai rencana tampil. Rincian per tahap: RAG, tiap panggilan LLM (tujuan, token
 * masuk/keluar), validasi grounding, dan render (kartu rencana deterministik + event selesai).
 *
 *   pnpm --filter @urusin/harness bench:latensi -- --label baseline [--ulang 2] [--persona wonogiri,jayapura]
 *
 * Rahasia: ~/.urusin-secrets/llm.env (atau process.env); kunci tidak pernah dicetak. Korpus: --rag-db
 * (bawaan URUSIN_RAG_DB). Embedding/rerank sengaja dimatikan (hanya BM25, sama dengan produksi saat ini).
 */

type Persona = {
  id: string;
  pesan: string;
  /** Kab/kota KTP yang benar untuk rencana. */
  kode: string;
  /** Kode tujuan (pindah). */
  tujuan?: string;
  /** Jenis urusan yang diharapkan. */
  jenis: string;
  /** Host kanal portal/situs resmi wilayah yang wajib muncul di kartu atau catatan rencana. */
  kanal: RegExp;
};

export const PERSONA_LATENSI: readonly Persona[] = [
  {
    id: 'wonogiri-ktp-rusak',
    pesan: 'KTP saya rusak, retak di tengah. KTP saya terdaftar di Kabupaten Wonogiri. Gimana cara gantinya?',
    kode: '3312',
    jenis: 'ktp',
    kanal: /wonogiri/i,
  },
  {
    id: 'surabaya-akta-lahir',
    pesan:
      'Anak saya baru lahir minggu lalu, KTP saya Kota Surabaya. Mau bikin akta kelahiran, syaratnya apa?',
    kode: '3578',
    jenis: 'kelahiran',
    kanal: /surabaya/i,
  },
  {
    id: 'semarang-pindah',
    pesan:
      'Saya mau pindah domisili dari Kota Semarang ke Kabupaten Sleman. KTP saya Kota Semarang. Urusnya gimana?',
    kode: '3374',
    tujuan: '3404',
    jenis: 'pindah',
    kanal: /semarang/i,
  },
  {
    id: 'jaksel-kia',
    pesan:
      'Saya mau bikinin KIA (kartu identitas anak) buat anak saya umur 5 tahun. KTP saya Jakarta Selatan.',
    kode: '3174',
    jenis: 'ktp|akta|lainnya',
    kanal: /jakarta/i,
  },
  {
    id: 'makassar-kk-baru',
    pesan: 'Saya baru menikah dan mau bikin KK baru, pisah dari KK orang tua. KTP saya Kota Makassar.',
    kode: '7371',
    jenis: 'kk|perkawinan',
    kanal: /makassar/i,
  },
  {
    id: 'jayapura-ktp-17',
    pesan: 'Anak saya baru umur 17 tahun, mau bikin KTP pertama kali. KTP saya Kota Jayapura.',
    kode: '9171',
    jenis: 'ktp',
    kanal: /jayapura|papua|dukcapil\.kemendagri/i,
  },
];

type PanggilanLlm = {
  tujuan: string;
  mulaiMs: number;
  selesaiMs: number;
  tokenMasuk: number;
  tokenKeluar: number;
  stream: boolean;
};

/** Provider pembungkus: catat waktu dan token tiap panggilan (tujuan ditebak dari parameter). */
function providerTerukur(
  inner: ChatProvider,
  t0: () => number,
  log: PanggilanLlm[],
  /** Proxy LLM meng-cache permintaan identik: field `user` unik per run memaksa pengukuran dingin. */
  user: string | undefined,
): ChatProvider {
  const tandai = <P extends ChatParams | ChatStreamParams>(p: P): P => (user ? { ...p, user } : p);
  const tujuan = (p: ChatParams | ChatStreamParams): string => {
    const rf = p.response_format;
    if (rf && rf.type === 'json_schema') return `struktur:${rf.json_schema.name}`;
    const tc = p.tool_choice;
    if (tc && typeof tc === 'object' && 'function' in tc) return `paksa:${tc.function.name}`;
    if (p.tools?.length) return 'agen:tool_loop';
    return 'teks';
  };
  return {
    baseURL: inner.baseURL,
    async create(params: ChatParams, opts?: RequestOptions) {
      const mulaiMs = t0();
      const r = await inner.create(tandai(params), opts);
      log.push({
        tujuan: tujuan(params),
        mulaiMs,
        selesaiMs: t0(),
        tokenMasuk: r.usage?.prompt_tokens ?? 0,
        tokenKeluar: r.usage?.completion_tokens ?? 0,
        stream: false,
      });
      return r;
    },
    async stream(params: ChatStreamParams, opts?: RequestOptions) {
      const mulaiMs = t0();
      const it = await inner.stream(tandai({ ...params, stream_options: { include_usage: true } }), opts);
      const entri: PanggilanLlm = {
        tujuan: `stream:${tujuan(params)}`,
        mulaiMs,
        selesaiMs: mulaiMs,
        tokenMasuk: 0,
        tokenKeluar: 0,
        stream: true,
      };
      log.push(entri);
      return (async function* () {
        for await (const c of it) {
          if (c.usage) {
            entri.tokenMasuk = c.usage.prompt_tokens;
            entri.tokenKeluar = c.usage.completion_tokens;
          }
          entri.selesaiMs = t0();
          yield c;
        }
      })();
    },
    transcribe: (i) => inner.transcribe(i),
    embed: (i) => inner.embed(i),
  };
}

const CAPS_PRODUKSI =
  '{"tools":true,"parallel_tool_calls":true,"json_schema_strict":true,"vision":true,"streaming_tools":true}';

function bacaEnvBerkas(berkas: string): Record<string, string> {
  const out: Record<string, string> = {};
  let teks: string;
  try {
    teks = readFileSync(berkas, 'utf8');
  } catch {
    return out;
  }
  for (const baris of teks.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(baris);
    if (!m) continue;
    let v = m[2]!;
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    out[m[1]!] = v;
  }
  return out;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const PENTING: ReadonlySet<UrusinEvent['type']> = new Set([
  'assistant_text',
  'grounded_answer',
  'handoff',
  'plan_card',
  'ringkasan_awal' as UrusinEvent['type'],
]);

export type HasilPersona = {
  id: string;
  ulang: number;
  status: string;
  totalMs: number;
  /** Event bermakna pertama (teks, ringkasan awal, jawaban bersumber, kartu rencana). */
  pertamaMs: number | null;
  pertamaJenis: string | null;
  rencanaMs: number | null;
  jawabanMs: number | null;
  ragMs: number;
  ragPanggilan: number;
  llm: PanggilanLlm[];
  llmMs: number;
  validasiMs: number | null;
  renderMs: number | null;
  tokenMasuk: number;
  tokenKeluar: number;
  benar: {
    jenis: string | null;
    jenisOk: boolean;
    kodeKtp: string | null;
    wilayahOk: boolean;
    kanalOk: boolean;
    refIdOk: boolean | null;
    refIdJumlah: number;
    rencana: boolean;
  };
};

const detik = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? '-' : (ms / 1000).toFixed(1);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0
    ? null
    : s.length % 2
      ? s[(s.length - 1) / 2]!
      : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** `--banding a,b`: tabel markdown median per persona dari dua berkas hasil (tanpa memanggil LLM). */
function banding(dir: string, a: string, b: string): string {
  const baca = (l: string) =>
    (JSON.parse(readFileSync(join(dir, `${l}.json`), 'utf8')) as { hasil: HasilPersona[] }).hasil;
  const ha = baca(a);
  const hb = baca(b);
  const m = (h: HasilPersona[], id: string, f: (r: HasilPersona) => number | null) =>
    median(h.filter((r) => r.id === id).flatMap((r) => (f(r) === null ? [] : [f(r)!])));
  const baris = [
    `| Persona | Pertama berguna ${a} → ${b} (s) | Rencana tampil ${a} → ${b} (s) | Jawaban bersumber ${a} → ${b} (s) | Total ${a} → ${b} (s) | Panggilan LLM | Token masuk | Benar (${b}) |`,
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const p of PERSONA_LATENSI) {
    const pa = ha.filter((r) => r.id === p.id);
    const pb = hb.filter((r) => r.id === p.id);
    if (!pa.length || !pb.length) continue;
    const ok = pb.every(
      (r) =>
        r.benar.jenisOk &&
        r.benar.wilayahOk &&
        r.benar.kanalOk &&
        r.benar.rencana &&
        r.benar.refIdOk !== false,
    );
    const refs = pb
      .map((r) => (r.benar.refIdOk === null ? 'hand-off' : `${r.benar.refIdJumlah} refId`))
      .join('/');
    baris.push(
      `| ${p.id} | ${detik(m(ha, p.id, (r) => r.pertamaMs))} → ${detik(m(hb, p.id, (r) => r.pertamaMs))} | ${detik(m(ha, p.id, (r) => r.rencanaMs))} → ${detik(m(hb, p.id, (r) => r.rencanaMs))} | ${detik(m(ha, p.id, (r) => r.jawabanMs))} → ${detik(m(hb, p.id, (r) => r.jawabanMs))} | ${detik(m(ha, p.id, (r) => r.totalMs))} → ${detik(m(hb, p.id, (r) => r.totalMs))} | ${m(ha, p.id, (r) => r.llm.length)} → ${m(hb, p.id, (r) => r.llm.length)} | ${m(ha, p.id, (r) => r.tokenMasuk)} → ${m(hb, p.id, (r) => r.tokenMasuk)} | ${ok ? 'ya' : 'TIDAK'} (${refs}) |`,
    );
  }
  return baris.join('\n');
}

async function main(): Promise<number> {
  const akar = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const band = arg('banding')?.split(',');
  if (band?.length === 2) {
    console.log(banding(join(akar, 'packages', 'harness', 'evals', 'latensi'), band[0]!, band[1]!));
    return 0;
  }
  const rahasia = bacaEnvBerkas(
    process.env.URUSIN_EVAL_SECRETS ?? join(homedir(), '.urusin-secrets', 'llm.env'),
  );
  const env: Record<string, string | undefined> = {
    LLM_REASONING_EFFORT: 'low',
    ...rahasia,
    ...process.env,
  };
  // Hanya BM25 (Jina nonaktif: saldo habis). Tanpa kunci embedding/rerank, pencari turun ke BM25.
  for (const k of Object.keys(env)) if (/^(JINA|RAG_EMBED|RAG_RERANK|LLM_EMBED)/.test(k)) delete env[k];
  // Allowlist egress dibaca dari process.env (origin proxy LLM), sama dengan server produksi.
  for (const k of ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_AGENT_MODEL', 'LLM_REASONING_EFFORT'])
    process.env[k] ??= env[k];
  const cfg = loadLlmConfig(env);
  const label = arg('label') ?? 'lokal';
  const ulang = Number(arg('ulang') ?? 1);
  const filter = arg('persona')?.split(',');
  const ragPath = resolve(
    arg('rag-db') ??
      env.URUSIN_RAG_DB ??
      join(akar, '..', 'urusin-wt-eval', 'scripts', 'eval-persona', '.cache', 'rag.prod.db'),
  );
  const ragDb = openDb(ragPath, { readonly: true });
  const searcher = createRagSearcher(ragDb, env);
  const inner = new OpenAIProvider(cfg);
  // Pin produksi (deploy/README.md, LLM_CAPS_PIN); --probe untuk memprobe ulang.
  const caps = process.argv.includes('--probe')
    ? applyForcedOff(await probeCapabilities({ provider: inner, models: cfg.models }), cfg.forcedOff).flags
    : (JSON.parse(env.LLM_CAPS_PIN ?? CAPS_PRODUKSI) as Record<string, boolean>);
  console.log(
    `model=${cfg.models.agent} reasoning=${cfg.reasoningEffort ?? '-'} rag=${ragPath} vektor=${searcher.info.vektor} caps=${JSON.stringify(caps)}`,
  );
  const persona = PERSONA_LATENSI.filter((p) => !filter || filter.some((f) => p.id.includes(f)));
  const hasil: HasilPersona[] = [];
  // --cache: satu CacheJawaban untuk seluruh run (seperti server produksi); ulangan kedua mengukur cache hangat.
  const cache = process.argv.includes('--cache') ? new CacheJawaban() : undefined;
  for (let u = 0; u < ulang; u++) {
    for (const p of persona) {
      let mulai = performance.now();
      const t0 = () => Math.round(performance.now() - mulai);
      const llm: PanggilanLlm[] = [];
      let ragMs = 0;
      let ragPanggilan = 0;
      const h = createHarness({
        provider: providerTerukur(
          inner,
          t0,
          llm,
          process.argv.includes('--hangat') ? undefined : `bench-${label}-${u}-${p.id}-${Date.now()}`,
        ),
        model: cfg.models.agent,
        caps,
        ragDb,
        ragSearch: async (input) => {
          const a = performance.now();
          try {
            return await searcher.search(input);
          } finally {
            ragMs += performance.now() - a;
            ragPanggilan++;
          }
        },
        quota: { dailyIdrCap: 1e9 },
        ...(cache ? { cacheJawaban: cache } : {}),
      });
      const urusan = h.store.createUrusan();
      const waktu: { type: string; ms: number }[] = [];
      h.bus.subscribe(urusan.id, (e) => waktu.push({ type: e.type, ms: t0() }));
      mulai = performance.now();
      const out = await runTurn(h.deps, { urusanId: urusan.id, userText: p.pesan });
      const totalMs = t0();
      const pertama = waktu.find((w) => PENTING.has(w.type as UrusinEvent['type']));
      const rencana = waktu.find((w) => w.type === 'plan_card');
      const jawaban = waktu.find((w) => w.type === 'grounded_answer' || w.type === 'handoff');
      const jawabLlm = llm.find((c) => c.tujuan.includes('jawab_persyaratan'));
      const done = waktu.find((w) => w.type === 'done');
      const akhirLlm = Math.max(0, ...llm.map((c) => c.selesaiMs));
      const u2 = h.store.getUrusanOrThrow(urusan.id);
      const wil = h.store
        .eventsOfType(urusan.id, 'wilayah', 20)
        .map((e) => e.payload as { status: string; ktp?: { kodeKabKota: string } })
        .find((w) => w.status === 'ditetapkan');
      const kartu = out.events.find((e) => e.type === 'plan_card');
      const ga = out.events.find((e) => e.type === 'grounded_answer');
      const chunks = new Set(h.store.getChunks(urusan.id).map((c) => c.refId));
      const refs =
        ga && ga.type === 'grounded_answer' ? ga.klaim.flatMap((k) => k.kutipan.map((q) => q.refId)) : [];
      const teksKanal = kartu ? JSON.stringify(kartu) : '';
      const r: HasilPersona = {
        id: p.id,
        ulang: u,
        status: out.status,
        totalMs,
        pertamaMs: pertama?.ms ?? null,
        pertamaJenis: pertama?.type ?? null,
        rencanaMs: rencana?.ms ?? null,
        jawabanMs: jawaban?.ms ?? null,
        ragMs: Math.round(ragMs),
        ragPanggilan,
        llm,
        llmMs: llm.reduce((s, c) => s + (c.selesaiMs - c.mulaiMs), 0),
        validasiMs: jawabLlm && jawaban ? jawaban.ms - jawabLlm.selesaiMs : null,
        renderMs: done ? done.ms - Math.max(akhirLlm, jawaban?.ms ?? 0) : null,
        tokenMasuk: out.tokensIn,
        tokenKeluar: out.tokensOut,
        benar: {
          jenis: u2.jenis,
          jenisOk: new RegExp(`^(${p.jenis})$`).test(u2.jenis ?? ''),
          kodeKtp: wil?.ktp?.kodeKabKota ?? null,
          wilayahOk: wil?.ktp?.kodeKabKota === p.kode,
          kanalOk: p.kanal.test(teksKanal),
          // refId kutipan harus salah satu potongan yang diambil urusan ini (RAG) atau potongan registry rencana.
          refIdOk: ga ? refs.every((id) => chunks.has(id) || id.startsWith('rencana-')) : null,
          refIdJumlah: refs.length,
          rencana: Boolean(kartu),
        },
      };
      hasil.push(r);
      console.log(
        `${p.id.padEnd(22)} total=${(totalMs / 1000).toFixed(1)}s pertama=${r.pertamaMs === null ? '-' : (r.pertamaMs / 1000).toFixed(1)}s(${r.pertamaJenis ?? '-'}) jawaban=${r.jawabanMs === null ? '-' : (r.jawabanMs / 1000).toFixed(1)}s rencana=${r.rencanaMs === null ? '-' : (r.rencanaMs / 1000).toFixed(1)}s llm=${llm.length}x/${(r.llmMs / 1000).toFixed(1)}s [${llm.map((c) => `${c.tujuan} ${((c.selesaiMs - c.mulaiMs) / 1000).toFixed(1)}s ${c.tokenMasuk}/${c.tokenKeluar}`).join('; ')}] rag=${r.ragPanggilan}x/${r.ragMs}ms ok=${JSON.stringify(r.benar)}`,
      );
    }
  }
  const keluar = join(akar, 'packages', 'harness', 'evals', 'latensi', `${label}.json`);
  mkdirSync(dirname(keluar), { recursive: true });
  writeFileSync(
    keluar,
    `${JSON.stringify({ label, model: cfg.models.agent, tanggal: new Date().toISOString(), caps, hasil }, null, 2)}\n`,
  );
  console.log(`hasil: ${keluar}`);
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
