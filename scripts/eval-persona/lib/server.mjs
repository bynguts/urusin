// Siapkan dan jalankan web app Urusin hasil build (node build/index.js) seperti produksi, dengan LLM nyata.
//
// Egress produksi hanya mengizinkan proxy LLM di 127.0.0.1:20128 (packages/egress/src/policy.ts LLM_PROXY);
// alamat Tailscale/privat diblokir. Bila LLM_BASE_URL bukan loopback, eval membuka relay TCP lokal
// 127.0.0.1:20128 -> host LLM sehingga server melihat alamat yang sama dengan produksi.
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, createWriteStream } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sensor } from './env.mjs';

const PROXY = { host: '127.0.0.1', port: 20128 };

/** Relay TCP lokal ke host LLM. Mengembalikan { baseUrl, tutup } atau baseUrl asli bila sudah loopback. */
export async function relayLlm(baseUrl) {
  const u = new URL(baseUrl);
  if (u.hostname === PROXY.host && Number(u.port) === PROXY.port) return { baseUrl, tutup: async () => {} };
  const target = { host: u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80) };
  if (u.protocol !== 'http:')
    throw new Error('relay LLM hanya untuk http; set LLM_BASE_URL ke proxy http://127.0.0.1:20128');
  const server = net.createServer((sock) => {
    const up = net.connect(target);
    sock.pipe(up).pipe(sock);
    const tutup = () => {
      sock.destroy();
      up.destroy();
    };
    sock.on('error', tutup);
    up.on('error', tutup);
  });
  await new Promise((ok, gagal) => {
    server.once('error', (e) =>
      gagal(
        e.code === 'EADDRINUSE'
          ? new Error(
              `port ${PROXY.port} lokal sudah dipakai; matikan proses itu atau arahkan LLM_BASE_URL ke sana`,
            )
          : e,
      ),
    );
    server.listen(PROXY.port, PROXY.host, ok);
  });
  const lokal = new URL(baseUrl);
  lokal.hostname = PROXY.host;
  lokal.port = String(PROXY.port);
  return {
    baseUrl: lokal.toString().replace(/\/$/, ''),
    tutup: () => new Promise((ok) => server.close(() => ok())),
  };
}

async function portBebas() {
  return new Promise((ok, gagal) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => ok(p));
    });
    s.on('error', gagal);
  });
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const jalankan = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

/**
 * Akar worktree yang dievaluasi. `--ref <git ref>` membuat worktree terpisah (detached) di folder cache lalu
 * install + build; `--worktree <path>` memakai worktree yang sudah ada; tanpa keduanya: repo ini.
 */
export function siapkanAkar({ akarRepo, ref, worktree, build, folderCache }) {
  let akar = akarRepo;
  if (ref) {
    const nama = `wt-${ref.replace(/[^A-Za-z0-9._-]/g, '_')}`;
    akar = join(folderCache, nama);
    if (!existsSync(akar)) {
      mkdirSync(folderCache, { recursive: true });
      execFileSync('git', ['fetch', '--quiet', 'origin'], { cwd: akarRepo, stdio: 'inherit' });
      execFileSync('git', ['worktree', 'add', '--detach', akar, ref], { cwd: akarRepo, stdio: 'inherit' });
      build = true;
    }
  } else if (worktree) {
    akar = resolve(worktree);
  }
  const indeks = join(akar, 'apps', 'web', 'build', 'index.js');
  if (build || !existsSync(indeks)) {
    jalankan(pnpm, ['install', '--frozen-lockfile'], akar);
    jalankan(pnpm, ['turbo', 'run', 'build', '--filter=@urusin/web...'], akar);
  }
  return akar;
}

/**
 * Jalankan server web. Env meniru deploy/compose.prod.yml + /opt/urusin/.env (nama variabel, model embed/rerank,
 * ambang abstain, batas biaya harian) dengan DB baru di folder sementara. Kunci PII acak per run.
 */
export async function mulaiServer({ akar, rahasia, llmBaseUrl, ragDb, logBerkas }) {
  const port = await portBebas();
  const origin = `http://localhost:${port}`;
  const dir = mkdtempSync(join(tmpdir(), 'urusin-eval-'));
  const dbPath = join(dir, 'urusin.sqlite');
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    PORT: String(port),
    HOST: '127.0.0.1',
    PROTOCOL_HEADER: 'x-forwarded-proto',
    ADDRESS_HEADER: 'x-forwarded-for',
    XFF_DEPTH: '1',
    BODY_SIZE_LIMIT: '10M',
    URUSIN_PUBLIC_ORIGIN: origin,
    URUSIN_DB_PATH: dbPath,
    URUSIN_EMAIL_MODE: 'log',
    URUSIN_EMAIL_OUTBOX: join(dir, 'outbox.jsonl'),
    URUSIN_SSE_HEARTBEAT_MS: '1000',
    // Batas laju dinaikkan: semua persona datang dari satu mesin (IP per persona tetap dibedakan lewat XFF).
    URUSIN_LIMIT_BUAT_IP_PER_JAM: '1000',
    URUSIN_LIMIT_TURN_IP_PER_MENIT: '1000',
    URUSIN_TAMU_PER_IP_HARI: '1000',
    URUSIN_DEMO_PER_IP_HARI: '1000',
    URUSIN_DEMO_AKTIF_MAKS: '1000',
    // "Masuk sebagai juri" butuh Turnstile; mode fixture (hanya di luar produksi) menerima token uji Cloudflare.
    URUSIN_TURNSTILE_FIXTURE: '1',
    LLM_BASE_URL: llmBaseUrl,
    LLM_API_KEY: rahasia.LLM_API_KEY,
    LLM_AGENT_MODEL: rahasia.LLM_AGENT_MODEL,
    URUSIN_PII_KEY: randomBytes(32).toString('base64'),
    URUSIN_DAILY_IDR_CAP: '50000',
    URUSIN_LLM_DISABLED: '0',
    ...(ragDb ? { URUSIN_RAG_DB: ragDb } : {}),
    ...(rahasia.JINA_API_KEY
      ? {
          LLM_EMBED_BASE_URL: 'https://api.jina.ai/v1',
          LLM_EMBED_API_KEY: rahasia.JINA_API_KEY,
          LLM_EMBED_MODEL: 'jina-embeddings-v5-omni-small',
          LLM_EMBED_TASK_QUERY: 'retrieval.query',
          LLM_EMBED_TASK_PASSAGE: 'retrieval.passage',
          RERANK_BASE_URL: 'https://api.jina.ai/v1',
          RERANK_API_KEY: rahasia.JINA_API_KEY,
          RERANK_MODEL: 'jina-reranker-v3',
        }
      : {}),
    RAG_ABSTAIN_MIN_COVERAGE: '0.1',
    RAG_ABSTAIN_MIN_RERANK_SCORE: '0.05',
  };
  const log = createWriteStream(logBerkas ?? join(dir, 'server.log'));
  const anak = spawn(process.execPath, [join(akar, 'apps', 'web', 'build', 'index.js')], {
    cwd: join(akar, 'apps', 'web'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tulis = (b) => log.write(sensor(b.toString(), rahasia));
  anak.stdout.on('data', tulis);
  anak.stderr.on('data', tulis);
  const mati = new Promise((ok) => anak.once('exit', (code) => ok(code)));

  const batas = Date.now() + 120_000;
  let siap = false;
  let info = {};
  while (Date.now() < batas) {
    const kode = await Promise.race([mati, new Promise((ok) => setTimeout(() => ok(undefined), 500))]);
    if (kode !== undefined) throw new Error(`server berhenti saat start (exit ${kode}); lihat ${log.path}`);
    try {
      // Runtime dirakit malas (probe LLM): /api/kemampuan menjawab 503 sampai siap, lalu `llm: 'llm'|'demo'`.
      const r = await fetch(`${origin}/api/kemampuan`);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.llm) {
        if (j.llm !== 'llm') throw new Error(`server berjalan di mode ${j.llm}, bukan llm`);
        const h = await (await fetch(`${origin}/api/health`)).json();
        info = { kemampuan: j, rag: h.rag, gitSha: h.gitSha };
        siap = true;
        break;
      }
    } catch (e) {
      if (String(e?.message).startsWith('server berjalan')) throw e;
      // belum mendengar
    }
  }
  if (!siap) {
    anak.kill();
    throw new Error(`server tidak siap dalam 120 detik; lihat ${log.path}`);
  }
  return {
    origin,
    dbPath,
    dir,
    logPath: log.path,
    info,
    async berhenti() {
      anak.kill();
      await mati;
      log.end();
    },
  };
}
