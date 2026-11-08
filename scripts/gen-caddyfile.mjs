#!/usr/bin/env node
// Membangkitkan snippet Caddy Urusin dari deploy/hosts.json dengan hostname LITERAL (tanpa `{$…}`).
// Placeholder env dibaca Caddy dari environment prosesnya sendiri; mengubahnya berarti mengubah unit
// Caddy sistem dan me-restart Caddy milik pengguna (melanggar aturan do-no-harm). Snippet literal cukup
// disalin, `caddy validate`, lalu `caddy reload` dengan izin per kejadian.
//
//   node scripts/gen-caddyfile.mjs            # tulis ulang semua snippet yang di-commit
//   node scripts/gen-caddyfile.mjs --check    # gagal (exit 1) bila snippet yang di-commit menyimpang
//   node scripts/gen-caddyfile.mjs --set fallback [--fixtures] [--out <berkas>]   # satu set, ke stdout/berkas
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const HOSTS_FILE = resolve(ROOT, 'deploy/hosts.json');
/** Berkas yang di-commit per set. Primary = catatan utama; fallback = sslip (tanpa DNS sendiri). */
export const COMMITTED = { primary: 'deploy/Caddyfile.urusin.primary', fallback: 'deploy/Caddyfile.urusin.fallback' };
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

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

/** Render snippet untuk satu set. `fixtures` true = blok fixtures aktif (default: dikomentari). */
export function render(setName, set, { fixtures = false } = {}) {
  const { app, verify, fixtures: fx } = validateSet(setName, set);
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
  return `# DIBANGKITKAN dari deploy/hosts.json (set "${setName}") oleh scripts/gen-caddyfile.mjs. JANGAN DIEDIT
# MANUAL: ubah hosts.json lalu jalankan \`node scripts/gen-caddyfile.mjs\`. CI menolak snippet yang menyimpang.
#
# Dipasang ke Caddy sistem (yang sudah memegang 80/443 dan situs lain) lewat SATU baris di Caddyfile host:
#
#   import /etc/caddy/urusin/Caddyfile.urusin
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
\timport urusin_common
}

# Fixture publik (portal palsu untuk demo), profil \`public\`, 127.0.0.1:4320. Nonaktif secara bawaan:
# bangkitkan dengan \`--fixtures\` setelah DNS ${fx} ada dan \`COMPOSE_PROFILES=fixtures\` +
# FIXTURES_IMAGE diset (lihat deploy/README.md).
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
  const set = arg('--set');
  if (set) {
    if (!Object.hasOwn(COMMITTED, set)) {
      console.error('gen-caddyfile: --set harus primary atau fallback');
      return 2;
    }
    const text = render(set, hosts[set], { fixtures: argv.includes('--fixtures') });
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
