#!/usr/bin/env node
/**
 * Kalibrasi CPU Lighthouse CI: target perangkat tetap SAMA ("Moto G Power-class" = 4x pada mesin
 * referensi), hanya multiplier yang disesuaikan dengan kecepatan host yang terukur.
 *
 * Mengapa: throttling simulasi (bawaan) mengalikan durasi task main-thread yang TERAMATI dengan
 * `cpuSlowdownMultiplier` (lantern Simulator). Bawaan 4x dikalibrasi untuk desktop kelas atas; di host
 * lambat (runner self-hosted ARM, CPU dibatasi kontainer) hasilnya jadi terlalu pesimis. Dokumentasi resmi
 * menyarankan kalibrasi dari `benchmarkIndex` host:
 *   https://github.com/GoogleChrome/lighthouse/blob/2b8caf21a3e9d03633b52e43e35e97291ae6553d/docs/throttling.md#L112-L139
 * Rumus = kalkulator resmi yang ditautkan dokumen itu (computeMultiplierMessages):
 *   https://github.com/patrickhulce/lighthouse-cpu-throttling-calculator/blob/a9c67dc1c58c972a0673bef05756290105334af1/pages/index.js#L9-L43
 *
 * Kebijakan (ambang assertion di lighthouserc.cjs TIDAK diubah):
 * - `LHCI_CPU_SLOWDOWN=<angka>` override debugging, harus di [1, 4]; `LHCI_CPU_SLOWDOWN=auto` paksa kalibrasi.
 * - Runner GitHub-hosted (`RUNNER_ENVIRONMENT=github-hosted`) dan lokal (tanpa `CI`): bawaan Lighthouse 4x,
 *   settings tidak disentuh sama sekali.
 * - Selain itu dengan `CI` (kontainer `ci-docker pw` runner self-hosted): median benchmarkIndex dari
 *   SAMPLES run Lighthouse pada halaman kosong -> rumus resmi -> dibulatkan KE ATAS ke 0,1 -> clamp [1, 4].
 *   Gagal mengukur -> 4x (paling ketat), dengan peringatan.
 *
 * Pemakaian: `node scripts/lhci-cpu.mjs '<chromeFlags>'` mencetak JSON hasil ke stdout dan menyimpannya di
 * .lighthouseci/cpu-calibration.json (dibaca langkah "Ringkasan skor" di ci.yml).
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_MULTIPLIER = 4; // constants.defaultSettings.throttling.cpuSlowdownMultiplier
export const MIN_MULTIPLIER = 1;
export const SAMPLES = 3;
/** benchmarkIndex di bawah ini: kalkulator resmi menyatakan host terlalu lambat untuk emulasi akurat. */
export const TOO_SLOW_INDEX = 150;

/**
 * Rumus kalkulator resmi Lighthouse (tanpa pembulatan/clamp): 150 = 1x, 800 = 2x, 1300 = 3x, 1533 = 4x.
 * @param {number} benchmarkIndex
 * @returns {number | undefined} undefined bila host terlalu lambat (< 150) atau nilai tidak valid
 */
export function officialMultiplier(benchmarkIndex) {
  if (!Number.isFinite(benchmarkIndex)) return undefined;
  if (benchmarkIndex >= 1300) return 3 + (benchmarkIndex - 1300) / 233;
  if (benchmarkIndex >= 800) return 2 + (benchmarkIndex - 800) / 500;
  if (benchmarkIndex >= TOO_SLOW_INDEX) return 1 + (benchmarkIndex - 150) / 650;
  return undefined;
}

/**
 * Multiplier yang dipakai: rumus resmi, dibulatkan ke atas ke 0,1 (tidak pernah lebih longgar dari rumus),
 * lalu clamp [1, 4] (target tidak pernah lebih berat dari jalur GitHub 4x).
 * @param {number} benchmarkIndex
 */
export function calibratedMultiplier(benchmarkIndex) {
  const raw = officialMultiplier(benchmarkIndex);
  if (raw === undefined) return MIN_MULTIPLIER;
  const up = Math.ceil(Number((raw * 10).toFixed(6))) / 10;
  return Math.min(DEFAULT_MULTIPLIER, Math.max(MIN_MULTIPLIER, up));
}

/** @param {number[]} values */
export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Mode dari env. Override tidak valid melempar galat (job gagal, bukan diam-diam memakai nilai lain).
 * @param {Record<string, string | undefined>} env
 * @returns {{ mode: 'default' } | { mode: 'calibrate' } | { mode: 'override', multiplier: number }}
 */
export function resolveMode(env) {
  const raw = env.LHCI_CPU_SLOWDOWN?.trim();
  if (raw) {
    if (raw === 'auto') return { mode: 'calibrate' };
    const n = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
    if (!(n >= MIN_MULTIPLIER && n <= DEFAULT_MULTIPLIER)) {
      throw new Error(`LHCI_CPU_SLOWDOWN harus angka di [1, 4] atau "auto", bukan '${raw}'`);
    }
    return { mode: 'override', multiplier: n };
  }
  if (env.RUNNER_ENVIRONMENT === 'github-hosted') return { mode: 'default' };
  if (env.CI && env.CI !== 'false' && env.CI !== '0') return { mode: 'calibrate' };
  return { mode: 'default' };
}

/**
 * Hasil akhir dari mode + sampel benchmarkIndex (fungsi murni; pengukuran disuntikkan).
 * @param {ReturnType<typeof resolveMode>} mode
 * @param {() => Promise<number[]>} measure
 */
export async function resolveCpu(mode, measure) {
  if (mode.mode === 'default') return { source: 'default', multiplier: DEFAULT_MULTIPLIER };
  if (mode.mode === 'override') return { source: 'override', multiplier: mode.multiplier };
  let samples;
  try {
    samples = (await measure()).filter((v) => Number.isFinite(v) && v > 0);
  } catch (e) {
    // Baris terakhir pesan (stderr Lighthouse) saja, agar ringkasan job tetap terbaca.
    const msg = (e instanceof Error ? e.message : String(e)).trim().split('\n').at(-1) ?? '';
    return fallback(`pengukuran gagal: ${msg.slice(0, 300)}`);
  }
  if (samples.length === 0) return fallback('tidak ada sampel benchmarkIndex');
  const benchmarkIndex = median(samples);
  const raw = officialMultiplier(benchmarkIndex);
  return {
    source: 'calibrated',
    multiplier: calibratedMultiplier(benchmarkIndex),
    benchmarkIndex,
    samples,
    officialMultiplier: raw === undefined ? null : Number(raw.toFixed(3)),
    ...(raw === undefined
      ? { warning: `benchmarkIndex < ${TOO_SLOW_INDEX}: host terlalu lambat untuk emulasi akurat` }
      : {}),
  };
}

/** @param {string} warning */
function fallback(warning) {
  return { source: 'calibrated', multiplier: DEFAULT_MULTIPLIER, warning: `${warning}; memakai 4x` };
}

/** Jalur CLI Lighthouse yang SAMA dengan yang dipakai lhci collect (node-runner.js). */
function lighthouseCli() {
  const lhciRequire = createRequire(createRequire(import.meta.url).resolve('@lhci/cli/package.json'));
  return path.join(lhciRequire.resolve('lighthouse'), '../../cli/index.js');
}

/**
 * benchmarkIndex host dari `count` run Lighthouse (Chrome yang sama: CHROME_PATH, flag yang sama) pada
 * halaman kosong lokal. Hanya audit `viewport`, throttling `provided`: benchmark tetap dihitung saat gather.
 * @param {string} chromeFlags
 * @param {number} count
 */
async function measureBenchmarkIndexes(chromeFlags, count) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    // Harus ada konten terlihat; tanpa paint Lighthouse gagal NO_FCP.
    res.end(
      '<!doctype html><html lang="id"><meta name="viewport" content="width=device-width"><title>k</title><p>kalibrasi</p>',
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
  const cli = lighthouseCli();
  const out = [];
  try {
    for (let i = 0; i < count; i++) {
      const stdout = await new Promise((resolve, reject) =>
        execFile(
          process.execPath,
          [
            cli,
            `http://127.0.0.1:${addr.port}/`,
            '--output=json',
            '--output-path=stdout',
            '--only-audits=viewport',
            '--throttling-method=provided',
            `--chrome-flags=${chromeFlags}`,
            '--quiet',
          ],
          { maxBuffer: 64 * 1024 * 1024, timeout: 180_000 },
          (err, so) => (err ? reject(err) : resolve(so)),
        ),
      );
      out.push(Number(JSON.parse(/** @type {string} */ (stdout)).environment?.benchmarkIndex));
    }
  } finally {
    server.close();
  }
  return out;
}

async function main() {
  const chromeFlags = process.argv[2] ?? '--headless=new';
  const result = await resolveCpu(resolveMode(process.env), () =>
    measureBenchmarkIndexes(chromeFlags, SAMPLES),
  );
  fs.mkdirSync('.lighthouseci', { recursive: true });
  fs.writeFileSync('.lighthouseci/cpu-calibration.json', `${JSON.stringify(result, null, 2)}\n`);
  process.stderr.write(`lhci-cpu: ${JSON.stringify(result)}\n`);
  process.stdout.write(JSON.stringify(result));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    process.stderr.write(`lhci-cpu: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
