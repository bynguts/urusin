import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, upsertChunks } from '@urusin/rag';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Runtime uji (DB harness di memori) dipasang sebelum endpoint diimpor. */
async function withRuntime(ragDbPath?: string) {
  const rt = await import('#lib/server/runtime.js');
  rt.setRuntimeForTests(rt.createRuntime({ config: { dbPath: ':memory:', ragDbPath }, env: {} }));
  return import('./+server');
}

describe('GET /api/health', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.resetModules();
  });

  // Batas eksplisit: tes paling lambat di berkas ini (~1-2 dtk sendirian dan di turbo paralel penuh).
  it('mengembalikan status ok dan gitSha "dev" bila GIT_SHA kosong', async () => {
    vi.stubEnv('GIT_SHA', '');
    const { GET } = await withRuntime();
    const res = await GET({} as never);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      status: 'ok',
      gitSha: 'dev',
      version: '0.0.0',
      rag: { status: 'demo', chunks: body.rag.chunks },
      runningTurns: 0,
      csp: { violations: {} },
    });
    expect(body.rag.chunks).toBeGreaterThan(0);
  }, 20_000);

  it('mengembalikan GIT_SHA dari environment', async () => {
    vi.stubEnv('GIT_SHA', 'abcdef1234567890');
    const { GET } = await withRuntime();
    const body = await (await GET({} as never)).json();
    expect(body.gitSha).toBe('abcdef1234567890');
    expect(body.ok).toBe(true);
  });

  it('melaporkan status probe kapabilitas LLM (probe ulang di latar)', async () => {
    const { GET } = await withRuntime();
    const probe = await import('#lib/server/probe-ulang.js');
    const s = {
      status: 'mencoba_ulang',
      percobaan: 3,
      berikutnyaPada: '2026-11-11T00:01:00.000Z',
      galat: ['tools', 'streaming_tools'],
    } as const;
    probe.aturStatusProbe({ ...s, galat: [...s.galat] });
    expect((await (await GET({} as never)).json()).probe).toEqual(s);
    probe.aturStatusProbe({ status: 'ok', percobaan: 4 });
    expect((await (await GET({} as never)).json()).probe).toEqual({ status: 'ok', percobaan: 4 });
  });

  it('melaporkan jumlah turn yang sedang berjalan dari runtime', async () => {
    const { GET } = await withRuntime();
    const turns = await import('#lib/server/running-turns.js');
    turns.setRunningTurnsSource(() => 3);
    expect((await (await GET({} as never)).json()).runningTurns).toBe(3);
  });

  it('rag ready dari runtime: jumlah chunk, vektor, model dari URUSIN_RAG_DB (read-only)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'urusin-rag-'));
    try {
      const path = join(dir, 'rag.db');
      const db = openDb(path);
      upsertChunks(db, [
        {
          id: 'c1',
          text: 'Syarat akta kelahiran: surat keterangan lahir.',
          sourceRef: { url: 'https://disdukcapil.wonogirikab.go.id/layanan', judul: 'J', instansi: 'I' },
          verifiedAt: '2026-11-01T00:00:00.000Z',
          layanan: 'adminduk',
        },
      ]);
      db.close();
      const { GET } = await withRuntime(path);
      expect((await (await GET({} as never)).json()).rag).toEqual({
        status: 'ready',
        chunks: 1,
        vectors: 0,
        vectorModel: null,
        // Tanpa env penyedia: agen memakai BM25 saja (dilaporkan apa adanya).
        pencarian: { vektor: false, rerank: false, embedModel: null, rerankModel: null },
      });
      // Tutup handle read-only sebelum direktori dihapus (Windows menolak hapus berkas yang terbuka).
      (await (await import('#lib/server/runtime.js')).getRuntime()).deps.ragDb?.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runtime gagal dirakit -> rag error, health tetap menjawab', async () => {
    const rt = await import('#lib/server/runtime.js');
    rt.setRuntimeForTests(Promise.reject(new Error('URUSIN_PII_KEY wajib')));
    const { GET } = await import('./+server');
    const res = await GET({} as never);
    expect(res.status).toBe(200);
    expect((await res.json()).rag).toEqual({ status: 'error' });
  });

  it('runtime masih dirakit (probe LLM lambat) -> rag memuat, tanpa menunggu lebih dari 2 detik', async () => {
    vi.useFakeTimers();
    const rt = await import('#lib/server/runtime.js');
    rt.setRuntimeForTests(new Promise(() => {}));
    const { GET } = await import('./+server');
    const pending = GET({} as never);
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await (await pending).json()).rag).toEqual({ status: 'memuat' });
  });
});
