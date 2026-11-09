import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, upsertChunks } from '@urusin/rag';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Init = Parameters<typeof import('#lib/server/runtime.js').createRuntime>[0];

/** Runtime uji (DB harness di memori) dipasang sebelum endpoint diimpor. */
async function withRuntime(init: Init = {}) {
  const rt = await import('#lib/server/runtime.js');
  const runtime = rt.createRuntime({ env: {}, ...init, config: { dbPath: ':memory:', ...init.config } });
  rt.setRuntimeForTests(runtime);
  return { runtime, ...(await import('./+server')) };
}

const get = async (GET: (e: never) => Promise<Response> | Response) => {
  const res = await GET({} as never);
  return { res, body: (await res.json()) as Record<string, unknown> };
};

describe('GET /api/kemampuan (publik)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.resetModules();
  });

  // Batas eksplisit: tes paling lambat di berkas ini (~1-2 dtk sendirian dan di turbo paralel penuh).
  it('mode demo: subset tidak sensitif saja, korpus demo = rag tidak_siap', async () => {
    vi.stubEnv('GIT_SHA', '');
    const { GET } = await withRuntime();
    const { res, body } = await get(GET);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({
      llm: 'demo',
      kapabilitas: { ai: 'normal', vision: true, rag: 'tidak_siap' },
      fitur: { pencarianHybrid: false, rerank: false },
      versi: { sha7: 'dev', commit: null },
    });
    // Tidak ada internal: model, jumlah chunk, biaya, turn berjalan (versi hanya stempel publik M11).
    const { versi: _versi, ...sisa } = body;
    expect(JSON.stringify(sisa)).not.toMatch(/sha|version|versi|model|chunk|idr|running/i);
  }, 20_000);

  it('korpus URUSIN_RAG_DB + env rerank: rag siap, flag rerank aktif, nama model tidak bocor', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'urusin-kemampuan-'));
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
      const env = {
        RERANK_BASE_URL: 'https://api.jina.ai/v1',
        RERANK_API_KEY: 'k',
        RERANK_MODEL: 'rahasia-rr',
      };
      const { GET, runtime } = await withRuntime({ config: { ragDbPath: path }, env });
      const { body } = await get(GET);
      expect(body['kapabilitas']).toMatchObject({ rag: 'siap' });
      expect(body['fitur']).toEqual({ pencarianHybrid: false, rerank: true });
      expect(JSON.stringify(body)).not.toContain('rahasia-rr');
      runtime.deps.ragDb?.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('kuota harian: >= 70% hemat, habis = tanpa_ai', async () => {
    const { GET, runtime } = await withRuntime({ harness: { quota: { dailyIdrCap: 1_000 } } });
    const spent = vi.spyOn(runtime.store, 'dailyCostIdr').mockReturnValue(699);
    expect((await get(GET)).body['kapabilitas']).toMatchObject({ ai: 'normal' });
    spent.mockReturnValue(700);
    expect((await get(GET)).body['kapabilitas']).toMatchObject({ ai: 'hemat' });
    spent.mockReturnValue(1_000);
    expect((await get(GET)).body['kapabilitas']).toMatchObject({ ai: 'tanpa_ai' });
  });

  it('probe: tanpa tool calling = tanpa_ai; vision mengikuti kapabilitas model', async () => {
    const { GET } = await withRuntime({ harness: { caps: { tools: false, vision: false } } });
    expect((await get(GET)).body['kapabilitas']).toEqual({
      ai: 'tanpa_ai',
      vision: false,
      rag: 'tidak_siap',
    });
  });

  it('runtime gagal dirakit: 200 dengan semua kemampuan mati', async () => {
    const rt = await import('#lib/server/runtime.js');
    rt.setRuntimeForTests(Promise.reject(new Error('URUSIN_PII_KEY wajib')));
    vi.stubEnv('GIT_SHA', '');
    const { GET } = await import('./+server');
    const { res, body } = await get(GET);
    expect(res.status).toBe(200);
    expect(body).toEqual({
      llm: null,
      kapabilitas: { ai: 'tanpa_ai', vision: false, rag: 'tidak_siap' },
      fitur: { pencarianHybrid: false, rerank: false },
      versi: { sha7: 'dev', commit: null },
    });
  });

  it('stempel versi M11: sha 40 heks = v<sha7> + tautan commit; nilai lain tanpa tautan', async () => {
    const sha = 'a1b2c3d'.repeat(5) + 'e4f5a';
    vi.stubEnv('GIT_SHA', sha);
    const { GET } = await withRuntime();
    expect((await get(GET)).body['versi']).toEqual({
      sha7: 'a1b2c3d',
      commit: `https://github.com/bynguts/urusin/commit/${sha}`,
    });
    vi.stubEnv('GIT_SHA', 'local"><script>');
    expect((await get(GET)).body['versi']).toEqual({ sha7: 'local">', commit: null });
  });

  it('runtime masih dirakit: 503 + retry-after dalam 2 detik (klien mempertahankan default)', async () => {
    vi.useFakeTimers();
    const rt = await import('#lib/server/runtime.js');
    rt.setRuntimeForTests(new Promise(() => {}));
    const { GET } = await import('./+server');
    const pending = GET({} as never);
    await vi.advanceTimersByTimeAsync(2_000);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('2');
  });
});
