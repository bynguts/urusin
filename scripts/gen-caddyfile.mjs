#!/usr/bin/env node
// Membangkitkan snippet Caddy Urusin dari deploy/hosts.json dengan hostname LITERAL (tanpa `{$…}`).
// Placeholder env dibaca Caddy dari environment prosesnya sendiri; mengubahnya berarti mengubah unit
// Caddy sistem dan me-restart Caddy milik pengguna (melanggar aturan do-no-harm). Snippet literal cukup
// disalin, `caddy validate`, lalu `caddy reload` dengan izin per kejadian.
//
//   node scripts/gen-caddyfile.mjs            # tulis ulang semua snippet yang di-commit
//   node scripts/gen-caddyfile.mjs --check    # gagal (exit 1) bila snippet yang di-commit menyimpang
//   node scripts/gen-caddyfile.mjs --set fallback [--fixtures] [--pendamping [--worker <id>=<ip>:<port>]...]
//                                  [--import <path>] [--out <berkas>]
//   node scripts/gen-caddyfile.mjs --check --set primary [flag yang sama] --file <berkas>
//                                             # gagal (exit 1) bila <berkas> (mis. snippet terpasang) menyimpang
//
// `--worker laptop-a=100.64.0.10:4330` (boleh berulang, butuh --pendamping): rute WebSocket worker Pendamping
// tambahan lewat Tailscale, `wss://<app>/pendamping/w/<id>/ws/<uuid>` (HANYA upgrade WebSocket GET; cookie hanya
// `__Host-urusin_sid`) -> edge worker `/ws/<uuid>`; jalur lain di bawah /pendamping/w/<id>/ 404. Sama dengan
// `wsUrl` worker itu di PENDAMPING_WORKERS (web).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const HOSTS_FILE = resolve(ROOT, 'deploy/hosts.json');
/** Berkas yang di-commit per set. Primary = catatan utama; fallback = sslip (tanpa DNS sendiri). */
export const COMMITTED = {
  primary: 'deploy/Caddyfile.urusin.primary',
  fallback: 'deploy/Caddyfile.urusin.fallback',
};
/** Path import bawaan (DEFAULT_TARGET deploy/caddy-install.sh). */
const DEFAULT_IMPORT = '/etc/caddy/urusin/Caddyfile.urusin';
const IMPORT_RE = /^(\/[A-Za-z0-9._-]+)+\/Caddyfile\.urusin$/;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** Id worker sama dengan skema `PENDAMPING_WORKERS` di web (apps/web/src/lib/server/pendamping.ts). */
/** Oktet IPv4 desimal 0-255 TANPA nol di depan (`064` ditolak: sebagian parser membacanya sebagai oktal). */
const OKTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const WORKER_RE = new RegExp(`^([a-z0-9][a-z0-9-]{0,31})=(${OKTET}(?:\\.${OKTET}){3}):(\\d{1,5})$`);

/**
 * `<id>=<ip>:<port>` -> worker. IP WAJIB IPv4 literal Tailscale (100.64.0.0/10), sama dengan pengecualian egress
 * web (@urusin/egress `pendampingInternalOrigins`): Caddy tidak pernah meneruskan ke LAN, internet, atau nama DNS.
 */
export function parseWorker(spec) {
  const m = WORKER_RE.exec(spec ?? '');
  const okt = m ? m[2].split('.').map(Number) : [];
  const port = m ? Number(m[3]) : 0;
  if (
    !m ||
    okt.some((o) => o > 255) ||
    okt[0] !== 100 ||
    okt[1] < 64 ||
    okt[1] > 127 ||
    port < 1 ||
    port > 65535
  )
    throw new Error(`--worker harus <id>=<IP Tailscale 100.64.0.0/10>:<port>: ${JSON.stringify(spec)}`);
  return { id: m[1], ip: m[2], port };
}

/** Validasi satu set host: harus hostname DNS polos huruf kecil (tanpa skema, port, wildcard, `{`). */
export function validateSet(name, set) {
  if (!set || typeof set !== 'object') throw new Error(`hosts.json: set "${name}" tidak ada`);
  for (const role of ['app', 'verify', 'fixtures']) {
    const h = set[role];
    if (typeof h !== 'string' || !HOST_RE.test(h))
      throw new Error(`hosts.json: ${name}.${role} bukan hostname literal yang valid: ${JSON.stringify(h)}`);
  }
  return set;
}

const ENCODE_TYPES = [
  'text/html*',
  'text/css*',
  'text/plain*',
  'text/javascript*',
  'text/xml*',
  'text/csv*',
  'application/atom+xml*',
  'application/font*',
  'application/geo+json*',
  'application/graphql+json*',
  'application/javascript*',
  'application/json*',
  'application/ld+json*',
  'application/manifest+json*',
  'application/rss+xml*',
  'application/vnd.api+json*',
  'application/wasm*',
  'application/x-javascript*',
  'application/xhtml+xml*',
  'application/xml*',
  'font/*',
  'image/svg+xml*',
  'image/x-icon*',
];

/**
 * Render snippet untuk satu set. `fixtures` true = blok fixtures aktif; `pendamping` true = blok
 * `handle /pendamping/ws/*` aktif (keduanya default: dikomentari). `workers` = spesifikasi `--worker` (butuh
 * `pendamping`). `importPath` = path snippet yang disebut komentar baris import (VPS saat ini:
 * /opt/urusin/Caddyfile.urusin; lihat deploy/README.md "Caddy").
 */
export function render(
  setName,
  set,
  { fixtures = false, pendamping = false, workers = [], importPath = DEFAULT_IMPORT } = {},
) {
  const { app, verify, fixtures: fx } = validateSet(setName, set);
  if (!IMPORT_RE.test(importPath))
    throw new Error(`--import bukan path absolut .../Caddyfile.urusin: ${importPath}`);
  const ws = workers.map(parseWorker);
  if (ws.length > 0 && !pendamping) throw new Error('--worker butuh --pendamping');
  if (new Set(ws.map((w) => w.id)).size !== ws.length) throw new Error('--worker: id ganda');
  const fxLines = [
    `${fx} {`,
    `\tencode zstd gzip`,
    `\theader {`,
    `\t\tStrict-Transport-Security "max-age=31536000"`,
    `\t\tX-Content-Type-Options "nosniff"`,
    `\t\t# Situs uji: jangan diindeks dan tandai jelas bukan situs pemerintah (nilai header ASCII).`,
    `\t\tX-Robots-Tag "noindex, nofollow"`,
    `\t\tX-Site-Notice "Situs uji - bukan situs pemerintah"`,
    `\t\t-Server`,
    `\t}`,
    `\treverse_proxy 127.0.0.1:4320`,
    `}`,
  ];
  const fxBlock = fixtures ? fxLines.join('\n') : fxLines.map((l) => (l ? `# ${l}` : '#')).join('\n');
  const pdLines = [
    'handle /pendamping/ws/* {',
    '\turi strip_prefix /pendamping',
    '\treverse_proxy 127.0.0.1:4330',
    '}',
  ];
  // Worker tambahan: HANYA upgrade WebSocket GET ke /pendamping/w/<id>/ws/* yang diteruskan; jalur lain di bawah
  // /pendamping/w/<id>/ (termasuk /internal/*, /health, /debug edge worker, dan GET biasa ke /ws/*) dijawab 404.
  // Laptop anggota bukan host tepercaya penuh: ke sana hanya cookie `__Host-urusin_sid` (pendamping memakainya
  // untuk mencocokkan pemilik sesi); cookie lain (sesi akun, dll.) dan Authorization tidak pernah dikirim.
  // Tanpa cookie sid yang berbentuk sah, permintaan berhenti di 404 (placeholder cookie yang tidak ada dibiarkan
  // Caddy apa adanya, jadi tanpa syarat ini teks `{http.request.cookie...}` yang akan sampai ke laptop).
  // `method GET` + Connection/Upgrade cukup: Caddy 2.11 tidak mengiklankan WebSocket HTTP/2 (RFC 8441,
  // SETTINGS_ENABLE_CONNECT_PROTOCOL=0), jadi peramban selalu memakai upgrade HTTP/1.1.
  for (const w of ws)
    pdLines.push(
      `# Worker Pendamping "${w.id}" lewat Tailscale (wsUrl wss://${app}/pendamping/w/${w.id}/ws).`,
      `@w_${w.id} {`,
      `\tpath /pendamping/w/${w.id}/ws/*`,
      '\theader Connection *Upgrade*',
      '\theader Upgrade websocket',
      '\theader_regexp Cookie `(?:^|; *)__Host-urusin_sid=[0-9a-f]{32}(?:;|$)`',
      '\tmethod GET',
      '}',
      `handle @w_${w.id} {`,
      `\turi strip_prefix /pendamping/w/${w.id}`,
      `\treverse_proxy ${w.ip}:${w.port} {`,
      '\t\theader_up Cookie "__Host-urusin_sid={http.request.cookie.__Host-urusin_sid}"',
      '\t\theader_up -Authorization',
      '\t}',
      '}',
      `handle /pendamping/w/${w.id}/* {`,
      '\trespond 404',
      '}',
    );
  const pdBlock = pdLines.map((l) => (pendamping ? `\t${l}` : `\t# ${l}`)).join('\n');
  return `# DIBANGKITKAN dari deploy/hosts.json (set "${setName}") oleh scripts/gen-caddyfile.mjs. JANGAN DIEDIT
# MANUAL: ubah hosts.json lalu jalankan \`node scripts/gen-caddyfile.mjs\`. CI menolak snippet yang menyimpang.
#
# Dipasang ke Caddy sistem (yang sudah memegang 80/443 dan situs lain) lewat SATU baris di Caddyfile host:
#
#   import ${importPath}
#
# Berkas itu salinan snippet set yang aktif (lihat deploy/README.md "Caddy"). Pasang tepat satu set:
# nama snippet (urusin_common) sama di kedua set. Hostname ditulis literal; snippet ini tidak memakai
# placeholder env sehingga environment proses Caddy tidak perlu diubah. Snippet hanya mendefinisikan
# blok situs Urusin (tanpa opsi global), jadi blok situs lain di Caddyfile host tidak tersentuh.
# Satu-satunya Content-Security-Policy dikirim aplikasi (SvelteKit); jangan menambah CSP di sini.

(urusin_common) {
\t# Kompresi hanya untuk tipe yang aman dikompres. Matcher bawaan Caddy menyertakan \`text/*\`
\t# (https://caddyserver.com/docs/caddyfile/directives/encode) sehingga \`text/event-stream\` (SSE)
\t# ikut terkompres dan tertahan di buffer encoder. Matcher respons Caddy tidak punya negasi
\t# nilai, jadi daftarnya ditulis eksplisit: bawaan Caddy dikurangi \`text/*\`, ditambah tipe
\t# teks yang memang dilayani aplikasi.
\tencode zstd gzip {
\t\tmatch {
${ENCODE_TYPES.map((t) => `\t\t\theader Content-Type ${t}`).join('\n')}
\t\t}
\t}

\theader {
\t\t# TANPA includeSubDomains: domain induk bisa dipakai bersama layanan lain, dan sub-domain
\t\t# milik layanan itu belum tentu siap HTTPS-only.
\t\tStrict-Transport-Security "max-age=31536000"
\t\tX-Content-Type-Options "nosniff"
\t\tReferrer-Policy "strict-origin-when-cross-origin"
\t\t# Kamera dipakai untuk foto dokumen, mikrofon untuk suara.
\t\tPermissions-Policy "camera=(self), microphone=(self), geolocation=()"
\t\tCross-Origin-Opener-Policy "same-origin"
\t\tCross-Origin-Resource-Policy "same-origin"
\t\t# Tujuan \`report-to\` pada CSP aplikasi (endpoint relatif terhadap origin).
\t\tReporting-Endpoints \`csp-endpoint="/api/csp-report"\`
\t\t-Server
\t}

\t# /api/health (liveness: gitSha, versi, runningTurns) tidak untuk publik. deploy.sh membacanya langsung
\t# lewat 127.0.0.1:4310/4311; smoke publik dan monitor memakai /api/ready.
\trespond /api/health* 404

\t# Blue/green: lalu lintas hanya ke warna AKTIF. Kedua port didaftarkan, tetapi \`/api/ready\` hanya 200
\t# pada warna yang dipromosikan deploy.sh (setelah smoke lulus), jadi health check aktif menandai warna
\t# lain tidak sehat dan \`lb_policy first\` memilih warna aktif. Pergantian warna tidak butuh reload Caddy.
\t# \`lb_try_duration\` mengulang permintaan yang gagal tersambung sehingga tidak ada 502 selama
\t# pergantian. flush_interval -1: teruskan SSE tanpa buffering.
\treverse_proxy 127.0.0.1:4310 127.0.0.1:4311 {
\t\tlb_policy first
\t\tlb_try_duration 5s
\t\tlb_try_interval 250ms
\t\thealth_uri /api/ready
\t\thealth_interval 2s
\t\thealth_timeout 2s
\t\thealth_status 200
\t\tfail_duration 10s
\t\tflush_interval -1
\t}
}

# Aplikasi memilih rute /verify dari header Host mentah, jadi kedua host ke upstream yang sama.
${app}, ${verify} {
\t# Browser Pendamping (WebSocket layar). Nonaktif sampai disetujui lead: butuh port 127.0.0.1:4330 dan
\t# \`COMPOSE_PROFILES=pendamping\` (lihat deploy/compose.prod.yml). HANYA /pendamping/ws/* yang
\t# diteruskan; /internal/* dan /debug pendamping tidak pernah diekspos. Pendamping memeriksa Origin
\t# persis, cookie urusin_sid pemilik, dan tiket sekali pakai.
\t#
${pdBlock}
\timport urusin_common
}

# Fixture publik (portal palsu untuk demo), profil \`public\`, 127.0.0.1:4320. Nonaktif secara bawaan:
# bangkitkan ulang snippet dengan \`node scripts/gen-caddyfile.mjs --set ${setName} --fixtures\` setelah
# DNS ${fx} ada dan \`COMPOSE_PROFILES=fixtures\` + FIXTURES_IMAGE diset (lihat deploy/README.md).
${fxBlock}
`;
}

export function loadHosts(file = HOSTS_FILE) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Daftar set yang snippet ter-commit-nya menyimpang dari hosts.json. */
export function drift(root = ROOT, hosts = loadHosts()) {
  const out = [];
  for (const [name, rel] of Object.entries(COMMITTED)) {
    let cur = '';
    try {
      cur = readFileSync(resolve(root, rel), 'utf8').replace(/\r\n/g, '\n');
    } catch {
      /* berkas belum ada = menyimpang */
    }
    if (cur !== render(name, hosts[name])) out.push(rel);
  }
  return out;
}

function main(argv) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i === -1 ? undefined : argv[i + 1];
  };
  const hosts = loadHosts();
  const set = arg('--set');
  const opsi = {
    fixtures: argv.includes('--fixtures'),
    pendamping: argv.includes('--pendamping'),
    workers: argv.flatMap((k, i) => (k === '--worker' ? [argv[i + 1]] : [])),
    importPath: arg('--import') ?? DEFAULT_IMPORT,
  };
  if (set && !Object.hasOwn(COMMITTED, set)) {
    console.error('gen-caddyfile: --set harus primary atau fallback');
    return 2;
  }
  if (argv.includes('--check') && set) {
    const file = arg('--file');
    if (!file) {
      console.error('gen-caddyfile: --check --set butuh --file <berkas>');
      return 2;
    }
    let cur = '';
    try {
      cur = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    } catch {
      /* berkas tidak ada = menyimpang */
    }
    if (cur !== render(set, hosts[set], opsi)) {
      console.error(`gen-caddyfile: ${file} menyimpang dari keluaran --set ${set}`);
      return 1;
    }
    console.log(`gen-caddyfile: ${file} cocok dengan keluaran --set ${set}`);
    return 0;
  }
  if (argv.includes('--check')) {
    const bad = drift(ROOT, hosts);
    if (bad.length) {
      console.error(`gen-caddyfile: menyimpang dari deploy/hosts.json: ${bad.join(', ')}`);
      console.error('Jalankan: node scripts/gen-caddyfile.mjs');
      return 1;
    }
    console.log('gen-caddyfile: snippet cocok dengan deploy/hosts.json');
    return 0;
  }
  if (set) {
    const text = render(set, hosts[set], opsi);
    const out = arg('--out');
    if (out) writeFileSync(out, text);
    else process.stdout.write(text);
    return 0;
  }
  for (const [name, rel] of Object.entries(COMMITTED)) {
    writeFileSync(resolve(ROOT, rel), render(name, hosts[name]));
    console.log(`gen-caddyfile: ${rel} (${name})`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  process.exitCode = main(process.argv.slice(2));
