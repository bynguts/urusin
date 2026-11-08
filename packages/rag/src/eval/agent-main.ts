import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { CliIo } from '../cli-io.js';
import { openDb } from '../db.js';
import { createRagSearcher } from '../searcher.js';
import { loadGold } from './gold.js';
import { mrrAtK, recallAtK, type RankedHit } from './metrics.js';

const pct = (v: number | null) => (v === null ? '-' : `${(v * 100).toFixed(1)}%`);

/**
 * `rag:eval-agent`: gold set lewat JALUR AGEN yang sama dengan produksi (`createRagSearcher`, env yang sama,
 * k sama dengan tool agen). Melaporkan recall/MRR, abstain P/R, serta mode dan status rerank per pertanyaan
 * agar fallback diam-diam (embedding/rerank gagal) terlihat. Exit 1 bila ada fallback dan `--strict`.
 */
export async function agentEvalMain(argv: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      gold: { type: 'string', multiple: true, default: ['../../data/gold/heldout.json'] },
      db: { type: 'string', default: '.cache/rag.db' },
      /** Sama dengan k tool agen (builtin-tools `retrieve`). */
      k: { type: 'string', default: '4' },
      strict: { type: 'boolean', default: false },
    },
  });
  const k = Number(values.k);
  const db = openDb(resolve(values.db), { readonly: true });
  const searcher = createRagSearcher(db, io.env, { fetch: io.fetch });
  const i = searcher.info;
  io.log(
    `Jalur agen: vektor=${i.vektor ? i.embedModel : 'mati'}, rerank=${i.rerank ? i.rerankModel : 'mati'}, k=${k}`,
  );
  io.log('');
  io.log('| Gold | n (dalam/luar) | recall@1 | recall@3 | MRR@k | abstain P | abstain R | mode | rerank |');
  io.log('|---|---|---:|---:|---:|---:|---:|---|---|');
  let fallbacks = 0;
  for (const path of values.gold) {
    const gold = loadGold(resolve(path));
    const s = { r1: 0, r3: 0, mrr: 0, abstained: 0, abstainedOos: 0 };
    const modes = new Map<string, number>();
    const rr = new Map<string, number>();
    const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);
    for (const g of gold) {
      const kode = g.kodeWilayah && /^\d{4}$/.test(g.kodeWilayah) ? g.kodeWilayah : undefined;
      const out = await searcher.search({ query: g.pertanyaan, ...(kode ? { kodeKabKota: kode } : {}), k });
      bump(modes, out.mode);
      const status = out.debug?.rerankStatus ?? 'off';
      bump(rr, status);
      if ((i.vektor && out.mode !== 'hybrid') || (i.rerank && status === 'fallback')) fallbacks++;
      if (out.tanpaHasil) {
        s.abstained++;
        if (g.luarCakupan) s.abstainedOos++;
      }
      if (g.luarCakupan) continue;
      const ranked: RankedHit[] = out.hasil.map((h) => ({ refs: [h.id, h.kutipan.url] }));
      s.r1 += recallAtK(ranked, g.relevan, 1);
      s.r3 += recallAtK(ranked, g.relevan, 3);
      s.mrr += mrrAtK(ranked, g.relevan, k);
    }
    const n = gold.filter((g) => !g.luarCakupan).length;
    const oos = gold.length - n;
    const fmt = (m: Map<string, number>) => [...m].map(([key, v]) => `${key}:${v}`).join(' ');
    io.log(
      `| ${path} | ${gold.length} (${n}/${oos}) | ${pct(n ? s.r1 / n : null)} | ${pct(n ? s.r3 / n : null)} | ` +
        `${n ? (s.mrr / n).toFixed(3) : '-'} | ${pct(s.abstained ? s.abstainedOos / s.abstained : null)} | ` +
        `${pct(oos ? s.abstainedOos / oos : null)} | ${fmt(modes)} | ${fmt(rr)} |`,
    );
  }
  db.close();
  if (fallbacks) io.error(`peringatan: ${fallbacks} pertanyaan jatuh ke fallback (embedding/rerank gagal)`);
  return values.strict && fallbacks ? 1 : 0;
}
