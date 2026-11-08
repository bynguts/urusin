import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  OpenAIProvider,
  applyForcedOff,
  loadLlmConfig,
  probeCapabilities,
  type CapabilityFlags,
} from '@urusin/llm';
import { DemoProvider } from '../demo.js';
import { runEval, reportMarkdown } from './run.js';

/**
 * `pnpm eval --k 5 --model <nama>` : jalankan set tugas k kali, tulis `evals/out/<model>-<tanggal>.json` + `.md`.
 * Provider NYATA hanya bila env LLM_BASE_URL, LLM_API_KEY, dan LLM_AGENT_MODEL terisi (dan tidak ada --fake);
 * selain itu FakeProvider (cepat, deterministik, tanpa jaringan). Tes tidak pernah memakai provider nyata.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function repoRoot(from: string): string {
  let dir = resolve(from);
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const up = dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
  return dir;
}

async function main(): Promise<number> {
  const k = Number(arg('k') ?? 5);
  if (!Number.isInteger(k) || k < 1) {
    console.error('--k harus bilangan bulat >= 1');
    return 2;
  }
  const env = process.env;
  const real =
    !process.argv.includes('--fake') && Boolean(env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_AGENT_MODEL);
  const num = (v: string | undefined, d: number) => (v && v.trim() !== '' ? Number(v) : d);

  let model = arg('model') ?? env.LLM_AGENT_MODEL ?? 'fake-demo';
  let makeProvider: () => import('@urusin/llm').ChatProvider = () => new DemoProvider();
  let caps: CapabilityFlags | undefined;
  let prices = {
    inputPerMTok: num(env.LLM_PRICE_INPUT_PER_MTOK, 0),
    outputPerMTok: num(env.LLM_PRICE_OUTPUT_PER_MTOK, 0),
    audioPerMin: 0,
  };
  if (real) {
    const cfg = loadLlmConfig(env);
    model = arg('model') ?? cfg.models.agent;
    const provider = new OpenAIProvider(cfg);
    makeProvider = () => provider;
    prices = cfg.prices;
    const report = await probeCapabilities({ provider, models: { ...cfg.models, agent: model } });
    caps = applyForcedOff(report, cfg.forcedOff).flags;
    console.log(`Provider nyata: ${cfg.baseURL} model ${model}`);
  } else {
    console.log('FakeProvider (env LLM_* tidak lengkap atau --fake).');
  }

  const report = await runEval({
    k,
    model,
    provider: makeProvider,
    ...(caps ? { caps } : {}),
    prices,
    idrPerUsd: num(env.IDR_PER_USD, 16_500),
    providerNyata: real,
  });

  const outDir = resolve(arg('out') ?? join(repoRoot(import.meta.dirname), 'evals', 'out'));
  mkdirSync(outDir, { recursive: true });
  const safe = model.replace(/[^\w.-]+/g, '_');
  const base = join(outDir, `${safe}-${report.tanggal}`);
  writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
  const md = reportMarkdown(report);
  writeFileSync(`${base}.md`, `${md}\n`);
  console.log(md);
  console.log(`\nDitulis: ${base}.json`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
