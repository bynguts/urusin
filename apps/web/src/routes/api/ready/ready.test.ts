import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

describe('GET /api/ready', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'urusin-ready-'));
    file = join(dir, '.active-color');
    vi.stubEnv('ACTIVE_COLOR_FILE', file);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('siap tanpa URUSIN_COLOR (dev/lokal)', async () => {
    vi.stubEnv('URUSIN_COLOR', '');
    expect((await GET({} as never)).status).toBe(200);
  });

  it('503 selama belum ada penanda', async () => {
    vi.stubEnv('URUSIN_COLOR', 'green');
    const res = await GET({} as never);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ready: false, color: 'green' });
  });

  it('200 hanya untuk warna yang dipromosikan', async () => {
    writeFileSync(file, 'green\n');
    vi.stubEnv('URUSIN_COLOR', 'green');
    expect((await GET({} as never)).status).toBe(200);
    vi.stubEnv('URUSIN_COLOR', 'blue');
    expect((await GET({} as never)).status).toBe(503);
  });
});
