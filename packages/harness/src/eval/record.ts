import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_ON } from '@urusin/llm';
import { runTurn } from '../agent.js';
import { createDemoRagDb, DemoProvider } from '../demo.js';
import { createHarness } from '../runtime.js';
import { INTENT_TASKS } from './tasks.js';
import { buatUrusanTerwilayah } from '../wilayah.js';

/**
 * Rekam alur DemoProvider (tanpa jaringan) menjadi fixture SSE untuk pemilik UI:
 * `packages/contracts/fixtures/rekaman/<nama>.json`. Jalankan: `pnpm --filter @urusin/harness record:fixtures`.
 */
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'contracts',
  'fixtures',
  'rekaman',
);

const PILIHAN = [
  { nama: 'jawaban-bersumber', ekspektasi: 'jawaban' },
  { nama: 'handoff-tanpa-sumber', ekspektasi: 'handoff' },
  { nama: 'obrolan-ringan', ekspektasi: 'chat' },
] as const;

mkdirSync(OUT, { recursive: true });
for (const p of PILIHAN) {
  const task = INTENT_TASKS.find((t) => t.ekspektasi === p.ekspektasi)!;
  const env = createHarness({
    provider: new DemoProvider(),
    model: 'fake-demo',
    caps: ALL_ON,
    ragDb: createDemoRagDb(),
  });
  const u = buatUrusanTerwilayah(env.store, { kodeKabKota: task.kodeKabKota });
  const out = await runTurn(env.deps, { urusanId: u.id, userText: task.teks });
  const data = { skema: 'sse', catatan: `Rekaman DemoProvider: "${task.teks}"`, data: out.events };
  writeFileSync(join(OUT, `${p.nama}.json`), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`rekaman/${p.nama}: ${out.events.length} event`);
}
