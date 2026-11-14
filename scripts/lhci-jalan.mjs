#!/usr/bin/env node
/**
 * Lighthouse CI dengan pengukuran yang tahan kontensi host: `lhci collect` -> ulang run yang hostnya sibuk ->
 * `lhci assert`. Pengganti `lhci autorun` (job perf ci.yml dan `ci-docker pw perf`); ambang assertion di
 * lighthouserc.cjs TIDAK berubah, dan aturannya sama untuk semua rute.
 *
 * Mengapa: throttling simulasi mengalikan durasi task main-thread yang TERAMATI dengan cpuSlowdownMultiplier
 * yang dikalibrasi dari benchmarkIndex host saat job mulai (scripts/lhci-cpu.mjs). Di runner self-hosted
 * (VPS, berbagi CPU dengan layanan lain) host kadang sibuk di tengah job: task teramati memanjang lalu
 * dikalikan lagi, sehingga TBT satu rute melonjak (mis. 46 vs 384 ms pada kode yang sama) dan median 5 run ikut
 * gagal bila >= 3 run kena. Run seperti itu mengukur perangkat yang jauh lebih lambat dari target, bukan kodenya.
 *
 * Aturan (hanya bila multiplier hasil kalibrasi, yaitu runner self-hosted; jalur bawaan 4x = autorun biasa):
 * - Acuan = benchmarkIndex kalibrasi (median sampel), yaitu kecepatan host yang DIASUMSIKAN multiplier.
 * - Run sah bila `environment.benchmarkIndex` LHR-nya >= RASIO_SAH x acuan (Lighthouse mengukurnya di run itu).
 * - Per rute: bila run sah < numberOfRuns, rute itu diukur ulang sebanyak kekurangannya (paling banyak
 *   MAKS_RONDE ronde). Yang dinilai: numberOfRuns run sah PALING AWAL; bila tetap kurang, sisanya diisi run
 *   tidak sah dengan benchmarkIndex tertinggi (tidak pernah dibuang tanpa pengganti). Pemilihan hanya melihat
 *   benchmarkIndex, tidak pernah nilai metriknya. Total run ulang paling banyak numberOfRuns x jumlah rute (durasi
 *   job paling lama ~2x), supaya selisih sistematis host vs kalibrasi tidak membuat job berjalan tanpa akhir.
 * - Sebelum collect pertama dan sebelum tiap ulangan: tunggu load host 1 menit (/proc/loadavg tidak di-namespace,
 *   jadi di kontainer pun ini load seluruh host) < RASIO_LOAD x jumlah CPU host, paling lama MAKS_TUNGGU_MS
 *   untuk seluruh job; lewat batas itu jalan terus (run sibuk tetap tersaring oleh aturan di atas).
 * - Ringkasan per rute ditulis ke .lighthouseci/stabil.json (dibaca langkah "Ringkasan skor" di ci.yml).
 *
 * Pemakaian: `node scripts/lhci-jalan.mjs [--config=<rc>]` (bawaan lighthouserc.cjs). Exit = exit `lhci assert`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const RASIO_SAH = 0.85;
export const MAKS_RONDE = 2;
export const RASIO_LOAD = 1;
const MAKS_TUNGGU_MS = 5 * 60_000;
const JEDA_MS = 15_000;
const DIR = '.lighthouseci';

/** @param {number} load1 @param {number} cpu */
export const hostTenang = (load1, cpu) => load1 < RASIO_LOAD * cpu;

let sisaTunggu = MAKS_TUNGGU_MS;
function tungguHostTenang() {
  const cpu = os.availableParallelism();
  while (!hostTenang(os.loadavg()[0], cpu)) {
    if (sisaTunggu <= 0) {
      console.log(
        `lhci-jalan: load host ${os.loadavg()[0].toFixed(2)} masih >= ${RASIO_LOAD * cpu}; batas tunggu habis, lanjut`,
      );
      return;
    }
    console.log(
      `lhci-jalan: load host ${os.loadavg()[0].toFixed(2)} >= ${RASIO_LOAD * cpu} (${cpu} CPU), tunggu ${JEDA_MS / 1000} dtk`,
    );
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, JEDA_MS);
    sisaTunggu -= JEDA_MS;
  }
}

/**
 * Acuan benchmarkIndex dari hasil scripts/lhci-cpu.mjs, atau undefined bila tidak ada kalibrasi terukur.
 * @param {{ source?: string, samples?: number[], benchmarkIndex?: number }} cpu
 */
export function acuanBenchmark(cpu) {
  if (cpu?.source !== 'calibrated') return undefined;
  const bi = Number(cpu.benchmarkIndex);
  return Number.isFinite(bi) && bi > 0 ? bi : undefined;
}

/**
 * Pilih run yang dinilai untuk satu rute (fungsi murni). `runs` urut kronologis.
 * @template {{ bi: number }} R
 * @param {R[]} runs
 * @param {number} n numberOfRuns
 * @param {number | undefined} minBi batas sah; undefined = semua sah
 * @returns {{ pakai: R[], buang: R[], sah: number }}
 */
export function pilihRun(runs, n, minBi) {
  const sah = (r) => minBi === undefined || r.bi >= minBi;
  const pakai = runs.filter(sah).slice(0, n);
  if (pakai.length < n) {
    const cadangan = runs.filter((r) => !sah(r)).sort((a, b) => b.bi - a.bi);
    pakai.push(...cadangan.slice(0, n - pakai.length));
  }
  return { pakai, buang: runs.filter((r) => !pakai.includes(r)), sah: runs.filter(sah).length };
}

/** LHR yang tersimpan, dikelompokkan per URL yang diminta, urut kronologis (nama berkas = waktu simpan). */
function bacaRun() {
  const by = new Map();
  const files = fs.readdirSync(DIR).filter((f) => /^lhr-\d+-\d+\.json$/.test(f));
  files.sort((a, b) => {
    const [, ta, ha] = a.match(/^lhr-(\d+)-(\d+)/).map(Number);
    const [, tb, hb] = b.match(/^lhr-(\d+)-(\d+)/).map(Number);
    return ta - tb || ha - hb;
  });
  for (const f of files) {
    const lhr = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const url = lhr.requestedUrl;
    if (!by.has(url)) by.set(url, []);
    by.get(url).push({ file: f, bi: Number(lhr.environment?.benchmarkIndex) || 0 });
  }
  return by;
}

function lhci(cli, args) {
  const r = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' });
  return r.status ?? 1;
}

function main() {
  const rcArg = process.argv.find((a) => a.startsWith('--config='));
  const rcPath = path.resolve(rcArg ? rcArg.slice('--config='.length) : 'lighthouserc.cjs');
  const require = createRequire(import.meta.url);
  // Memuat rc = kalibrasi CPU sekali (URUSIN_LHCI_CPU), diwarisi semua proses lhci di bawah.
  const rc = require(rcPath);
  const cli = require.resolve('@lhci/cli/src/cli.js');
  const cfg = [`--config=${rcPath}`];
  const n = rc.ci.collect.numberOfRuns ?? 3;
  const cpu = JSON.parse(process.env.URUSIN_LHCI_CPU ?? '{}');
  const acuan = acuanBenchmark(cpu);
  const minBi = acuan === undefined ? undefined : Math.round(acuan * RASIO_SAH);

  if (minBi !== undefined) tungguHostTenang();
  if (lhci(cli, ['collect', ...cfg]) !== 0) process.exit(1);

  /** @type {Record<string, unknown>} */
  const ringkas = { acuan: acuan ?? null, minBenchmarkIndex: minBi ?? null, rasio: RASIO_SAH, rute: {} };
  if (minBi !== undefined) {
    let jatah = n * bacaRun().size;
    for (let ronde = 1; ronde <= MAKS_RONDE && jatah > 0; ronde++) {
      const kurang = [...bacaRun()].filter(([, runs]) => runs.filter((r) => r.bi >= minBi).length < n);
      if (!kurang.length) break;
      for (const [url, runs] of kurang) {
        const tambah = Math.min(jatah, n - runs.filter((r) => r.bi >= minBi).length);
        if (tambah <= 0) break;
        jatah -= tambah;
        const bis = runs.map((r) => r.bi).join(', ');
        console.log(
          `lhci-jalan: ${url}: host sibuk (benchmarkIndex ${bis}; sah >= ${minBi}), ulang ${tambah} run (ronde ${ronde})`,
        );
        tungguHostTenang();
        if (lhci(cli, ['collect', ...cfg, '--additive', `--url=${url}`, `--numberOfRuns=${tambah}`]) !== 0)
          process.exit(1);
      }
    }
  }
  for (const [url, runs] of bacaRun()) {
    const { pakai, buang, sah } = pilihRun(runs, n, minBi);
    for (const r of buang) {
      for (const ext of ['.json', '.html'])
        fs.rmSync(path.join(DIR, r.file.replace(/\.json$/, ext)), { force: true });
    }
    /** @type {Record<string, unknown>} */ (ringkas.rute)[url] = {
      run: runs.length,
      sah,
      dinilai: pakai.map((r) => r.bi),
      diganti: buang.map((r) => r.bi),
    };
    if (minBi !== undefined && sah < n) {
      console.log(
        `lhci-jalan: PERINGATAN ${url}: hanya ${sah}/${n} run sah setelah ${MAKS_RONDE} ronde; run sibuk ikut dinilai`,
      );
    }
  }
  fs.writeFileSync(path.join(DIR, 'stabil.json'), `${JSON.stringify(ringkas, null, 2)}\n`);
  process.exit(lhci(cli, ['assert', ...cfg]));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
