import { UrusinEventSchema, parseFixture } from '@urusin/contracts';
import { describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import { createDemoRagDb, DemoProvider } from './demo.js';
import { toEvent } from './envelope.js';
import { INTENT_TASKS } from './eval/tasks.js';
import { makeEnv } from './testing.js';

/** Setiap event yang dipancarkan harness harus lolos skema zod di @urusin/contracts. */
describe('kontrak SSE: event harness lolos skema', () => {
  it.each(INTENT_TASKS.map((t) => [t.id, t] as const))('tugas eval %s', async (_id, task) => {
    const env = makeEnv({ provider: new DemoProvider(), ragDb: createDemoRagDb() });
    const u = env.store.createUrusan(task.kodeKabKota ? { kodeKabKota: task.kodeKabKota } : {});
    const out = await runTurn(env.deps, { urusanId: u.id, userText: task.teks });
    expect(out.events.length).toBeGreaterThan(1);
    for (const e of out.events) expect(UrusinEventSchema.safeParse(e).success, JSON.stringify(e)).toBe(true);
    // jalur replay (tabel events) menghasilkan event yang sama persis dengan yang disiarkan
    const replay = env.store.eventsAfter(u.id, 0).map(toEvent);
    expect(replay).toEqual(out.events);
    for (const e of replay) expect(UrusinEventSchema.parse(e)).toBeTruthy();
  });

  it('rekaman FakeProvider di packages/contracts/fixtures/rekaman lolos skema', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(import.meta.dirname, '..', '..', 'contracts', 'fixtures', 'rekaman');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const p = parseFixture(JSON.parse(readFileSync(join(dir, f), 'utf8')));
      expect(p.skema).toBe('sse');
    }
  });
});
