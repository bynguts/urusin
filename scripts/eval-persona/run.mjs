#!/usr/bin/env node
// Eval persona Urusin: warga simulasi (LLM) bercakap dengan web app Urusin ASLI (build produksi, LLM nyata,
// korpus RAG produksi), lalu dinilai pemeriksa deterministik + juri LLM.
//
//   pnpm eval:persona                          semua persona, repo ini
//   pnpm eval:persona --persona p01,p11        sebagian persona
//   pnpm eval:persona --ref origin/feat/x      build & uji ref git lain (worktree di .cache/)
//   pnpm eval:persona --worktree ../urusin-wt-wilayah
//   pnpm eval:persona --wilayah-awal persona   perangkat sudah diatur ke wilayah persona (bawaan: 'bawaan' =
//                                              WILAYAH_AWAL perangkat baru, seperti HP juri di final)
//   pnpm eval:persona --label coba --paralel 3 --maks-giliran 12 --tanpa-juri --build
//
// Rahasia LLM dibaca dari ~/.urusin-secrets/llm.env (atau URUSIN_EVAL_SECRETS / process.env), tidak pernah dicetak.
// Korpus RAG: --rag-db (bawaan scripts/eval-persona/.cache/rag.prod.db, salinan /data/rag.db produksi).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { muatRahasia, sensor } from './lib/env.mjs';
import { KlienLlm } from './lib/llm.mjs';
import { KRITERIA, gabung, nilaiJuri } from './lib/juri.mjs';
import { opsiAksiWilayah } from './lib/klien.mjs';
import { jalankanPercakapan } from './lib/percakapan.mjs';
import { renderLangkahAgen } from './lib/layar.mjs';
import {
  cekBocorWilayah,
  cekFinalOlehWarga,
  cekGalat,
  cekGemaPii,
  cekPendamping,
  cekWilayahSebelumRencana,
  pendekkanHash,
  samarkan,
  urlTampil,
} from './lib/periksa.mjs';
import { relayLlm, mulaiServer, siapkanAkar } from './lib/server.mjs';
import { cariPersona } from './personas.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const AKAR_REPO = resolve(DIR, '..', '..');

const { values: opsi } = parseArgs({
  options: {
    persona: { type: 'string' },
    ref: { type: 'string' },
    worktree: { type: 'string' },
    build: { type: 'boolean', default: false },
    'base-url': { type: 'string' },
    'rag-db': { type: 'string', default: join(DIR, '.cache', 'rag.prod.db') },
    'wilayah-awal': { type: 'string', default: 'bawaan' },
    'maks-giliran': { type: 'string', default: '12' },
    paralel: { type: 'string', default: '3' },
    label: { type: 'string' },
    keluar: { type: 'string' },
    'tanpa-juri': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opsi.help) {
  console.log(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('\n')
      .slice(1, 17)
      .join('\n'),
  );
  process.exit(0);
}

/** WILAYAH_AWAL perangkat baru di apps/web/src/lib/stores/lokal.svelte.ts (dibaca dari worktree yang diuji). */
function wilayahAwalPerangkat(akar) {
  try {
    const src = readFileSync(join(akar, 'apps', 'web', 'src', 'lib', 'stores', 'lokal.svelte.ts'), 'utf8');
    const m = src.match(/WILAYAH_AWAL[^=]*=\s*\{\s*kodeKabKota:\s*'(\d{4})'/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

function bacaAtauKosong(berkas) {
  try {
    return readFileSync(berkas, 'utf8');
  } catch {
    return '';
  }
}

function kodePerangkat(persona, mode, bawaan) {
  if (mode === 'persona') return persona.kodeBenar[0];
  if (mode === 'kosong') return '';
  if (/^\d{4}$/.test(mode)) return mode;
  return bawaan;
}

const log = (s) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);

async function petaParalel(item, n, fn) {
  const hasil = new Array(item.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, item.length) }, async () => {
      while (i < item.length) {
        const k = i++;
        hasil[k] = await fn(item[k], k);
      }
    }),
  );
  return hasil;
}

/** Cari PII sintetis di seluruh tabel DB server (bukti penyimpanan mentah). */
function pindaiDb(dbPath, rahasia) {
  if (!dbPath || !existsSync(dbPath) || !rahasia.nik) return null;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tabel = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    const temuan = [];
    const pola = new RegExp(rahasia.nik.split('').join('[\\s.-]?'));
    for (const t of tabel) {
      for (const baris of db.prepare(`SELECT * FROM "${t}"`).all()) {
        const s = JSON.stringify(baris);
        if (pola.test(s)) temuan.push(`${t}: NIK mentah`);
        if (rahasia.ibu && s.toLowerCase().includes(rahasia.ibu.toLowerCase()))
          temuan.push(`${t}: nama ibu mentah`);
      }
    }
    return [...new Set(temuan)];
  } finally {
    db.close();
  }
}

function pemakaianAgen(dbPath, urusanId) {
  if (!dbPath || !existsSync(dbPath) || !urusanId) return null;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const u = db.prepare('SELECT tokens_in, tokens_out, cost_idr FROM urusan WHERE id = ?').get(urusanId);
    const n = db
      .prepare('SELECT count(*) AS n FROM spans WHERE urusan_id = ? AND name LIKE ?')
      .get(urusanId, 'chat %');
    return u
      ? { tokensIn: u.tokens_in, tokensOut: u.tokens_out, costIdr: u.cost_idr, panggilanLlm: n?.n ?? null }
      : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function transkripTeks(h) {
  const baris = [];
  for (const l of h.langkah) {
    if (l.peran === 'warga') {
      baris.push(l.jenis === 'klik' ? `Warga menekan [${l.teks}]` : `Warga: ${l.teks}`);
      if (l.http?.status >= 400) baris.push(`[GALAT HTTP ${l.http.status} ${l.http.kode ?? ''}]`);
    } else {
      const t = renderLangkahAgen(l.events, { denganProgres: Boolean(l.aksi) });
      baris.push(t || '(Urusin tidak menampilkan apa-apa)');
      if (l.status && l.status !== 'selesai') baris.push(`[turn ${l.status}]`);
    }
  }
  baris.push(`[AKHIR: ${h.akhir.alasan}${h.akhir.catatan ? ` — ${h.akhir.catatan}` : ''}]`);
  return baris.join('\n\n');
}

const simbol = (v) => (v === true ? 'LULUS' : v === false ? 'GAGAL' : 'n/a');

async function main() {
  const rahasia = muatRahasia();
  const persona = cariPersona(
    opsi.persona
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const maksGiliran = Number(opsi['maks-giliran']);
  const label =
    opsi.label ??
    `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}-${opsi.ref ? opsi.ref.replace(/\W+/g, '_') : 'lokal'}`;
  const keluar = resolve(opsi.keluar ?? join(DIR, 'hasil', label));
  mkdirSync(join(keluar, 'transkrip'), { recursive: true });

  let akar = AKAR_REPO;
  let server;
  let relay;
  let origin = opsi['base-url'];
  const mulai = Date.now();
  if (!origin) {
    akar = siapkanAkar({
      akarRepo: AKAR_REPO,
      ref: opsi.ref,
      worktree: opsi.worktree,
      build: opsi.build,
      folderCache: join(DIR, '.cache'),
    });
    if (!existsSync(opsi['rag-db']))
      throw new Error(
        `korpus RAG tidak ada: ${opsi['rag-db']}. Salin /data/rag.db produksi (lihat LAPORAN) atau beri --rag-db.`,
      );
    relay = await relayLlm(rahasia.LLM_BASE_URL);
    server = await mulaiServer({
      akar,
      rahasia,
      llmBaseUrl: relay.baseUrl,
      ragDb: resolve(opsi['rag-db']),
      logBerkas: join(keluar, 'server.log'),
    });
    origin = server.origin;
    log(`server siap di ${origin} (rag ${server.info.rag?.status}, ${server.info.rag?.chunks ?? '?'} chunk)`);
  }
  let gitSha = null;
  try {
    gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: akar }).toString().trim();
  } catch {
    // bukan repo git
  }
  const wilayahBawaan = wilayahAwalPerangkat(akar);
  const aksiWilayah = opsiAksiWilayah(
    bacaAtauKosong(join(akar, 'apps', 'web', 'src', 'lib', 'stores', 'urusan.svelte.ts')),
  );
  let gt = {};
  try {
    gt = JSON.parse(readFileSync(join(DIR, 'ground-truth.json'), 'utf8')).persona ?? {};
  } catch {
    log('ground-truth.json belum ada: juri menilai tanpa lembar fakta');
  }

  const hasil = await petaParalel(persona, Number(opsi.paralel), async (p, idx) => {
    const llmWarga = new KlienLlm({
      baseUrl: rahasia.LLM_BASE_URL,
      apiKey: rahasia.LLM_API_KEY,
      model: process.env.EVAL_SIM_MODEL ?? rahasia.LLM_AGENT_MODEL,
    });
    const llmJuri = new KlienLlm({
      baseUrl: rahasia.LLM_BASE_URL,
      apiKey: rahasia.LLM_API_KEY,
      model: process.env.EVAL_JUDGE_MODEL ?? rahasia.LLM_AGENT_MODEL,
    });
    const wilayahPerangkat = kodePerangkat(p, opsi['wilayah-awal'], wilayahBawaan);
    log(`mulai ${p.id} (wilayah perangkat ${wilayahPerangkat || 'kosong'})`);
    const h = await jalankanPercakapan({
      origin,
      ip: `198.51.100.${10 + idx}`,
      persona: p,
      llmWarga,
      wilayahPerangkat,
      aksiWilayah,
      maksGiliran,
      log,
    });
    const dbTemuan = server ? pindaiDb(server.dbPath, h.rahasia) : null;
    const deterministik = {
      a: cekWilayahSebelumRencana(h.langkah, p, h.kodeUrusan),
      d: cekBocorWilayah(h.langkah, p),
      e: cekPendamping(h.langkah, p),
      f: (() => {
        const gema = cekGemaPii(h.langkah, h.rahasia);
        const final = cekFinalOlehWarga(h.langkah);
        const db =
          dbTemuan && dbTemuan.length > 0
            ? { lulus: false, bukti: `PII mentah tersimpan di DB server: ${dbTemuan.join(', ')}` }
            : null;
        const bagian = [gema, final, ...(db ? [db] : [])];
        return {
          lulus: bagian.every((x) => x.lulus !== false),
          bukti: bagian.map((x) => x.bukti).join('; '),
        };
      })(),
      i: (() => {
        const g = cekGalat(h.langkah, { izinkanKode: p.izinkanKode });
        if (h.akhir.alasan === 'galat_eval' || h.akhir.alasan === 'gagal_mulai')
          return { lulus: false, bukti: `${g.bukti}; akhir ${h.akhir.alasan}: ${h.akhir.catatan ?? ''}` };
        if (h.akhir.alasan === 'batas_giliran')
          return { lulus: false, bukti: `${g.bukti}; warga belum selesai setelah ${maksGiliran} giliran` };
        return g;
      })(),
    };
    // Simpan dengan PII sintetis disamarkan dan hash dipendekkan (pii-scan).
    const aman = pendekkanHash(JSON.parse(samarkan(JSON.stringify({ ...h, rahasia: undefined }), h.rahasia)));
    const teks = samarkan(transkripTeks(h), h.rahasia);
    let juri = null;
    if (!opsi['tanpa-juri']) {
      try {
        juri = await nilaiJuri(llmJuri, { persona: p, gt: gt[p.id], transkripTeks: teks, deterministik });
      } catch (e) {
        juri = { galat: String(e?.message ?? e) };
      }
    }
    const nilai = gabung(deterministik, juri);
    const rekam = {
      persona: p.id,
      judul: p.judul,
      urusanId: h.urusanId,
      wilayahPerangkat: h.wilayahPerangkat,
      kodeUrusan: h.kodeUrusan,
      akhir: h.akhir,
      giliranWarga: h.giliranWarga,
      ms: h.ms,
      url: urlTampil(h.langkah),
      deterministik,
      juri: juri ? JSON.parse(samarkan(JSON.stringify(juri), h.rahasia)) : null,
      nilai,
      pemakaian: {
        agen: server ? pemakaianAgen(server.dbPath, h.urusanId) : null,
        simulator: llmWarga.pakai,
        juri: llmJuri.pakai,
      },
    };
    writeFileSync(
      join(keluar, 'transkrip', `${p.id}.json`),
      JSON.stringify({ ...aman, nilai: rekam }, null, 2),
    );
    writeFileSync(
      join(keluar, 'transkrip', `${p.id}.txt`),
      `${p.judul}\n${'='.repeat(p.judul.length)}\n\n${teks}\n`,
    );
    log(
      `selesai ${p.id}: ${Object.entries(nilai)
        .map(([k, v]) => `${k}=${simbol(v.lulus)[0]}`)
        .join(' ')}`,
    );
    return rekam;
  });

  const ringkas = {
    label,
    dibuat: new Date().toISOString(),
    gitSha,
    akar: akar === AKAR_REPO ? '.' : akar,
    origin: server ? 'lokal (node build)' : origin,
    wilayahAwal: opsi['wilayah-awal'],
    wilayahBawaanPerangkat: wilayahBawaan,
    aksiWilayah,
    maksGiliran,
    rag: server?.info.rag ?? null,
    durasiMs: Date.now() - mulai,
    hasil,
  };
  writeFileSync(join(keluar, 'skor.json'), sensor(JSON.stringify(ringkas, null, 2), rahasia));
  writeFileSync(join(keluar, 'skor.md'), sensor(tabelSkor(ringkas), rahasia));
  log(`hasil di ${keluar}`);
  await server?.berhenti();
  await relay?.tutup();
}

function tabelSkor(r) {
  const k = Object.keys(KRITERIA);
  const sel = (v) => (v === true ? 'L' : v === false ? '**G**' : '-');
  const baris = r.hasil.map(
    (h) =>
      `| ${h.persona} | ${h.kodeUrusan ?? '-'} | ${k.map((x) => sel(h.nilai[x].lulus)).join(' | ')} | ${h.giliranWarga} | ${h.akhir.alasan} |`,
  );
  const total = k.map((x) => {
    const n = r.hasil.filter((h) => h.nilai[x].lulus !== null);
    return `${n.filter((h) => h.nilai[x].lulus).length}/${n.length}`;
  });
  const tok = r.hasil.reduce(
    (a, h) => {
      a.agenIn += h.pemakaian.agen?.tokensIn ?? 0;
      a.agenOut += h.pemakaian.agen?.tokensOut ?? 0;
      for (const s of [h.pemakaian.simulator, h.pemakaian.juri]) {
        a.evalIn += s.tokensIn;
        a.evalOut += s.tokensOut;
      }
      return a;
    },
    { agenIn: 0, agenOut: 0, evalIn: 0, evalOut: 0 },
  );
  return [
    `# Skor eval persona: ${r.label}`,
    '',
    `- git: ${r.gitSha ?? '?'} (${r.akar}); wilayah perangkat: ${r.wilayahAwal} (bawaan ${r.wilayahBawaanPerangkat || 'kosong'})`,
    `- korpus: ${r.rag ? `${r.rag.status}, ${r.rag.chunks} chunk, ${r.rag.vectors ?? 0} vektor` : '?'}; durasi ${(r.durasiMs / 60000).toFixed(1)} menit`,
    `- token agen ${tok.agenIn} in / ${tok.agenOut} out; token simulator+juri ${tok.evalIn} in / ${tok.evalOut} out`,
    '',
    `| persona | kode urusan | ${k.join(' | ')} | giliran | akhir |`,
    `|---|---|${k.map(() => '---').join('|')}|---|---|`,
    ...baris,
    `| **total lulus** | | ${total.join(' | ')} | | |`,
    '',
    'Kriteria: ' + k.map((x) => `${x} = ${KRITERIA[x]}`).join('; '),
    '',
    ...r.hasil.flatMap((h) => [
      `## ${h.persona}: ${h.judul}`,
      '',
      ...k.map(
        (x) =>
          `- **${x} ${simbol(h.nilai[x].lulus)}**: ${h.nilai[x].bukti.replace(/\s+/g, ' ').slice(0, 400)}`,
      ),
      ...(h.juri?.cacat?.length
        ? [
            '',
            'Cacat (juri):',
            ...h.juri.cacat.map(
              (c) => `- [${c.keparahan}/${c.kriteria}] ${c.judul}: ${String(c.bukti).slice(0, 200)}`,
            ),
          ]
        : []),
      '',
    ]),
  ].join('\n');
}

main().catch((e) => {
  console.error(`eval gagal: ${e?.message ?? e}`);
  process.exit(1);
});
