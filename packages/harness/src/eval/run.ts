import type { CapabilityFlags, ChatProvider, Prices } from '@urusin/llm';
import { ALL_ON } from '@urusin/llm';
import { runTurn } from '../agent.js';
import { createDemoRagDb } from '../demo.js';
import { percentile } from '../trace.js';
import { createHarness } from '../runtime.js';
import { INJECTION_CASES, type InjectionCase } from '../injection/cases.js';
import { runInjectionSuite, summarizeAsr, type AsrSummary } from '../injection/runner.js';
import { INTENT_TASKS, type EvalTask } from './tasks.js';
import { buatUrusanTerwilayah } from '../wilayah.js';

export type RunResult = {
  taskId: string;
  pass: boolean;
  intentBenar: boolean;
  hasilSesuai: boolean;
  /** Tool call yang ditolak gate pada percobaan pertama (skema/state/PII); 0 = valid tanpa retry. */
  toolDitolak: number;
  toolTotal: number;
  /** Hanya untuk ekspektasi `jawaban`/`handoff`: jalur bersumber berjalan sebagaimana mestinya. */
  groundingDinilai: boolean;
  groundingLolos: boolean;
  latensiMs: number;
  /** Durasi tiap panggilan LLM (span `chat`) pada percobaan ini. */
  llmMs: number[];
  tokenMasuk: number;
  tokenKeluar: number;
  biayaIdr: number;
  error?: string;
};

export type TaskReport = {
  taskId: string;
  jenis: string;
  ekspektasi: EvalTask['ekspektasi'];
  lolos: number;
  k: number;
  /** pass^k: SEMUA k percobaan berhasil. */
  passHatK: boolean;
};

export type EvalReport = {
  model: string;
  tanggal: string;
  k: number;
  providerNyata: boolean;
  tugas: TaskReport[];
  ringkasan: {
    passHatK: number;
    passAt1: number;
    akurasiIntent: number;
    validitasToolTanpaRetry: number;
    groundingPassRate: number;
    latensiTurnMs: { p50: number; p95: number };
    latensiPanggilanLlmMs: { p50: number; p95: number };
    token: { masuk: number; keluar: number };
    biayaIdr: number;
    jumlahPercobaan: number;
  };
  injeksi: { catatan: string; ringkasan: AsrSummary };
};

export type EvalOptions = {
  k: number;
  model: string;
  /** Pabrik provider: dipanggil per percobaan (fake) atau mengembalikan instance bersama (nyata). */
  provider: () => ChatProvider;
  caps?: CapabilityFlags;
  prices?: Prices;
  idrPerUsd?: number;
  providerNyata?: boolean;
  tasks?: readonly EvalTask[];
  injectionCases?: readonly InjectionCase[];
  now?: () => Date;
};

async function runOnce(task: EvalTask, o: EvalOptions): Promise<RunResult> {
  const env = createHarness({
    provider: o.provider(),
    model: o.model,
    caps: o.caps ?? ALL_ON,
    ragDb: createDemoRagDb(),
    ...(o.prices ? { prices: o.prices } : {}),
    ...(o.idrPerUsd ? { quota: { idrPerUsd: o.idrPerUsd } } : {}),
  });
  const u = buatUrusanTerwilayah(env.store, { kodeKabKota: task.kodeKabKota });
  const t0 = performance.now();
  try {
    const out = await runTurn(env.deps, { urusanId: u.id, userText: task.teks });
    const latensiMs = performance.now() - t0;
    const types = out.events.map((e) => e.type);
    const gateDenies = out.events.filter((e) => e.type === 'policy_gate' && e.keputusan === 'deny').length;
    const executed = (
      env.store.db
        .prepare(
          "SELECT COUNT(*) n FROM spans WHERE operation IN ('execute_tool','retrieval') AND turn_id = ?",
        )
        .get(out.turnId) as { n: number }
    ).n;
    const grounded = out.events.find((e) => e.type === 'grounded_answer');
    const groundedOk =
      grounded !== undefined &&
      grounded.type === 'grounded_answer' &&
      grounded.klaim.length > 0 &&
      grounded.klaimDibuang === 0;
    const hasilSesuai =
      task.ekspektasi === 'jawaban'
        ? groundedOk
        : task.ekspektasi === 'handoff'
          ? types.includes('handoff') && !types.includes('grounded_answer')
          : types.includes('assistant_text') && !types.includes('grounded_answer');
    const intentBenar = env.store.getUrusanOrThrow(u.id).jenis === task.jenis;
    const dinilai = task.ekspektasi !== 'chat';
    return {
      taskId: task.id,
      intentBenar,
      hasilSesuai,
      toolDitolak: gateDenies,
      toolTotal: executed + gateDenies,
      groundingDinilai: dinilai,
      groundingLolos: dinilai && hasilSesuai,
      latensiMs,
      llmMs: (
        env.store.db
          .prepare("SELECT duration_ms FROM spans WHERE operation = 'chat' AND turn_id = ?")
          .all(out.turnId) as {
          duration_ms: number;
        }[]
      ).map((r) => r.duration_ms),
      tokenMasuk: out.tokensIn,
      tokenKeluar: out.tokensOut,
      biayaIdr: out.costIdr,
      pass: out.status === 'selesai' && intentBenar && hasilSesuai && gateDenies === 0,
    };
  } catch (e) {
    return {
      taskId: task.id,
      pass: false,
      intentBenar: false,
      hasilSesuai: false,
      toolDitolak: 0,
      toolTotal: 0,
      groundingDinilai: task.ekspektasi !== 'chat',
      groundingLolos: false,
      latensiMs: performance.now() - t0,
      llmMs: [],
      tokenMasuk: 0,
      tokenKeluar: 0,
      biayaIdr: 0,
      error: (e as Error).message,
    };
  }
}

const ratio = (num: number, den: number) => (den === 0 ? 0 : num / den);
const sortedNums = (xs: number[]) => [...xs].sort((a, b) => a - b);

export async function runEval(o: EvalOptions): Promise<EvalReport> {
  const tasks = o.tasks ?? INTENT_TASKS;
  const all: RunResult[] = [];
  const tugas: TaskReport[] = [];
  for (const task of tasks) {
    const runs: RunResult[] = [];
    for (let i = 0; i < o.k; i++) runs.push(await runOnce(task, o));
    all.push(...runs);
    const lolos = runs.filter((r) => r.pass).length;
    tugas.push({
      taskId: task.id,
      jenis: task.jenis,
      ekspektasi: task.ekspektasi,
      lolos,
      k: o.k,
      passHatK: lolos === o.k,
    });
  }

  const dinilai = all.filter((r) => r.groundingDinilai);
  const turnMs = all.map((r) => r.latensiMs);
  const llmMs = all.flatMap((r) => r.llmMs);
  const injection = summarizeAsr(await runInjectionSuite(o.injectionCases ?? INJECTION_CASES));
  return {
    model: o.model,
    tanggal: (o.now?.() ?? new Date()).toISOString().slice(0, 10),
    k: o.k,
    providerNyata: o.providerNyata ?? false,
    tugas,
    ringkasan: {
      passHatK: ratio(tugas.filter((t) => t.passHatK).length, tugas.length),
      passAt1: ratio(all.filter((r) => r.pass).length, all.length),
      akurasiIntent: ratio(all.filter((r) => r.intentBenar).length, all.length),
      validitasToolTanpaRetry: ratio(
        all.reduce((a, r) => a + (r.toolTotal - r.toolDitolak), 0),
        all.reduce((a, r) => a + r.toolTotal, 0),
      ),
      groundingPassRate: ratio(dinilai.filter((r) => r.groundingLolos).length, dinilai.length),
      latensiTurnMs: { p50: percentile(sortedNums(turnMs), 50), p95: percentile(sortedNums(turnMs), 95) },
      latensiPanggilanLlmMs: {
        p50: percentile(sortedNums(llmMs), 50),
        p95: percentile(sortedNums(llmMs), 95),
      },
      token: {
        masuk: all.reduce((a, r) => a + r.tokenMasuk, 0),
        keluar: all.reduce((a, r) => a + r.tokenKeluar, 0),
      },
      biayaIdr: all.reduce((a, r) => a + r.biayaIdr, 0),
      jumlahPercobaan: all.length,
    },
    injeksi: {
      catatan:
        'Suite injeksi memakai model patuh berskrip (FakeProvider) untuk menguji policy gate; bukan pengukuran ketahanan model nyata.',
      ringkasan: injection,
    },
  };
}

export function reportMarkdown(r: EvalReport): string {
  const s = r.ringkasan;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const rows = r.tugas.map(
    (t) =>
      `| ${t.taskId} | ${t.jenis} | ${t.ekspektasi} | ${t.lolos}/${t.k} | ${t.passHatK ? 'ya' : 'tidak'} |`,
  );
  return [
    `# Eval ${r.model} (${r.tanggal}), k=${r.k}, ${r.providerNyata ? 'provider nyata' : 'FakeProvider'}`,
    '',
    '| Metrik | Nilai |',
    '|---|---|',
    `| pass^${r.k} (semua ${r.k} percobaan lolos, per tugas) | ${pct(s.passHatK)} |`,
    `| pass@1 (rata-rata percobaan) | ${pct(s.passAt1)} |`,
    `| Akurasi intent | ${pct(s.akurasiIntent)} |`,
    `| Validitas tool call tanpa retry | ${pct(s.validitasToolTanpaRetry)} |`,
    `| Grounding pass rate | ${pct(s.groundingPassRate)} |`,
    `| Latensi turn p50 / p95 (ms) | ${s.latensiTurnMs.p50.toFixed(1)} / ${s.latensiTurnMs.p95.toFixed(1)} |`,
    `| Token masuk / keluar | ${s.token.masuk} / ${s.token.keluar} |`,
    `| Biaya (IDR) | ${s.biayaIdr.toFixed(2)} |`,
    `| ASR injeksi (tulis/final) | ${pct(r.injeksi.ringkasan.asrTulis)} (${r.injeksi.ringkasan.totalTulis} kasus) |`,
    '',
    '| Tugas | Jenis | Ekspektasi | Lolos | pass^k |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}
