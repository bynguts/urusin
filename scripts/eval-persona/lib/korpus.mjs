// Korpus RAG eval: salinan /data/rag.db produksi belum tentu memuat teks pasal nasional. Sebelum run, sumber
// `*-pasal` dari data/sources.json repo yang DIUJI di-ingest ke salinan DB eval (bukan ke salinan produksi di .cache),
// memakai CLI repo itu sendiri seperti deploy/README.md: `pnpm rag:ingest --only <id> --db <path>`.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sensor } from './env.mjs';
import { envEmbed, pnpm } from './server.mjs';

/** Id sumber `*-pasal` yang ditandai ingest di sources.json. */
export function sumberPasal(sources) {
  const daftar = Array.isArray(sources) ? sources : (sources?.sources ?? []);
  return daftar.filter((s) => /-pasal$/.test(s.id) && s.ingest !== false).map((s) => s.id);
}

/** Jumlah chunk `<id>-pasal#...` di tabel chunks, total dan per sumber. */
export function hitungChunkPasal(db) {
  const baris = db.prepare("SELECT id FROM chunks WHERE id LIKE '%-pasal#%'").all();
  const perSumber = {};
  for (const { id } of baris) {
    const sumber = id.slice(0, id.indexOf('#'));
    perSumber[sumber] = (perSumber[sumber] ?? 0) + 1;
  }
  return { total: baris.length, perSumber };
}

/** Baris ringkasan untuk skor.md. */
export function barisKorpusPasal({ status, sumber, total, galat }) {
  if (status === 'dimatikan') return `- korpus pasal: dimatikan (--tanpa-pasal); ${total} chunk`;
  if (status === 'tanpa_sumber')
    return `- korpus pasal: repo yang diuji tidak punya sumber \`*-pasal\` (${total} chunk)`;
  const g = galat.length ? `; galat: ${galat.join(', ')}` : '';
  return `- korpus pasal: ${total} chunk dari ${sumber} sumber \`*-pasal\` di-ingest dari repo yang diuji${g}`;
}

/**
 * Salin DB korpus ke folder sementara lalu ingest sumber pasal repo yang diuji. Mengembalikan path DB yang dipakai
 * server dan ringkasan. `aktif=false` atau repo tanpa sumber pasal: DB asli dipakai apa adanya.
 */
export function siapkanKorpusPasal({ akar, ragDb, rahasia, aktif, log }) {
  const hitung = (path) => {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return hitungChunkPasal(db);
    } finally {
      db.close();
    }
  };
  if (!ragDb || !existsSync(ragDb))
    return { ragDb, status: 'tanpa_db', sumber: 0, total: 0, perSumber: {}, galat: [] };
  if (!aktif) return { ragDb, status: 'dimatikan', sumber: 0, galat: [], ...hitung(ragDb) };
  const berkasSumber = join(akar, 'data', 'sources.json');
  const ids = existsSync(berkasSumber) ? sumberPasal(JSON.parse(readFileSync(berkasSumber, 'utf8'))) : [];
  if (ids.length === 0) return { ragDb, status: 'tanpa_sumber', sumber: 0, galat: [], ...hitung(ragDb) };

  const folder = mkdtempSync(join(tmpdir(), 'urusin-eval-rag-'));
  const salinan = join(folder, 'rag.db');
  copyFileSync(ragDb, salinan);
  const env = { ...process.env, ...envEmbed(rahasia) };
  const galat = [];
  for (const id of ids) {
    log?.(`ingest korpus pasal: ${id}`);
    try {
      execFileSync(pnpm, ['rag:ingest', '--only', id, '--db', salinan], {
        cwd: akar,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
    } catch (e) {
      galat.push(id);
      // Alasan ada di stdout CLI ("error <id> (TimeoutError)"); stderr hanya gema perintah pnpm.
      const keluaran = `${e?.stdout ?? ''}\n${e?.stderr ?? e?.message ?? e}`;
      const alasan = keluaran.match(/^error\s.*$/m)?.[0] ?? keluaran.slice(-400);
      log?.(`ingest ${id} gagal: ${sensor(alasan, rahasia)}`);
    }
  }
  return {
    ragDb: salinan,
    status: 'diingest',
    sumber: ids.length,
    galat,
    ...hitung(salinan),
    /** Hapus salinan sementara (panggil setelah server berhenti). */
    hapus: () => rmSync(folder, { recursive: true, force: true }),
  };
}
