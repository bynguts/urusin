#!/usr/bin/env node
// Bangkitkan packages/core/src/registry-wilayah.ts dari:
// - data/wilayah/kontak-dukcapil.json: situs informasi Disdukcapil yang terverifikasi (host persis);
// - data/wilayah/portal-dukcapil.json: kanal daring per kab/kota hasil recon (kelas A-F, host portal persis).
// Host masuk ke OFFICIAL_DOMAINS (union edge Browser Pendamping). Tanpa wildcard; host bukan .go.id wajib punya
// `sumber` berupa halaman .go.id. Data ditanam sebagai modul TS agar ikut ter-build ke dist.
// Pakai: `node scripts/gen-registry-wilayah.mjs` (tulis) atau `--check` (gagal bila berkas hasil usang).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import prettier from 'prettier';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'packages/core/src/registry-wilayah.ts');
const baca = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

const KELAS_KE_JENIS = {
  A: 'web',
  B: 'web',
  C: 'aplikasi',
  D: 'whatsapp',
  E: 'nasional',
  F: 'tidak_diketahui',
};
const LOGIN = [
  'nik_sandi',
  'email_sandi',
  'hp_sandi',
  'username_sandi',
  'google',
  'akun_kota',
  'otp_email',
  'otp_wa',
  'tanpa_akun',
];
const PROTEKSI = [
  'captcha_gambar',
  'captcha_hitung',
  'recaptcha',
  'turnstile',
  'hcaptcha',
  'slider',
  'cloudflare',
  'waf',
  'honeypot',
];
const DOMISILI = ['khusus_penduduk', 'tidak_dibatasi', 'tidak_diketahui'];
/** Syarat jaringan portal (OfficialDomain.aksesWilayah): `id-only` = IP luar negeri ditolak keras. */
const AKSES = ['id-only', 'id-utama'];
const HOST = /^(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/;
const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

/** Host .go.id resmi (bukan sekadar berakhiran "go.id"). */
export const hostGoId = (h) => h.endsWith('.go.id');

export function susun(kabkota, kontak, portal) {
  const galat = [];
  const nama = new Map(kabkota.kabkota.map((k) => [k.kode, k.nama]));
  const cekHost = (h, konteks) => {
    if (!HOST.test(h)) galat.push(`${konteks}: host tidak persis/valid "${h}"`);
  };
  const cekUrl = (u, konteks) => {
    try {
      const x = new URL(u);
      if (x.protocol !== 'https:') galat.push(`${konteks}: bukan https "${u}"`);
      return x;
    } catch {
      galat.push(`${konteks}: URL tidak valid "${u}"`);
      return null;
    }
  };

  /** kode -> host situs info dari kontak terverifikasi. */
  const info = new Map();
  for (const k of kontak.kontak) {
    if (k.status !== 'terverifikasi') continue;
    if (!nama.has(k.kode)) galat.push(`kontak ${k.kode}: kode kab/kota tidak dikenal`);
    const u = cekUrl(k.website, `kontak ${k.kode}`);
    if (u) {
      cekHost(u.hostname, `kontak ${k.kode}`);
      info.set(k.kode, { host: u.hostname, sumber: k.sourceUrl, verifiedAt: k.verifiedAt.slice(0, 10) });
    }
  }

  const platform = {};
  for (const [id, p] of Object.entries(portal.platform ?? {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) galat.push(`platform ${id}: id tidak valid`);
    const u = cekUrl(p.sumber, `platform ${id}`);
    if (u && !hostGoId(u.hostname)) galat.push(`platform ${id}: sumber harus halaman .go.id`);
    for (const h of p.hosts) {
      cekHost(h, `platform ${id}`);
      if (!hostGoId(h)) galat.push(`platform ${id}: host bukan .go.id "${h}"`);
    }
    platform[id] = { ...p, hosts: [...p.hosts] };
  }

  const wilayah = {};
  const kodeSemua = [...new Set([...info.keys(), ...Object.keys(portal.wilayah)])].sort();
  for (const kode of kodeSemua) {
    const p = portal.wilayah[kode];
    const i = info.get(kode);
    const ctx = `wilayah ${kode}`;
    if (!nama.has(kode)) {
      galat.push(`${ctx}: kode kab/kota tidak dikenal`);
      continue;
    }
    if (!p) {
      // Hanya situs info terverifikasi: kanal daring belum di-recon.
      wilayah[kode] = {
        kode,
        nama: nama.get(kode),
        kelas: 'F',
        jenis: 'tidak_diketahui',
        hosts: [],
        hostInfo: [i.host],
        sumber: i.sumber,
        login: [],
        proteksi: [],
        domisili: 'tidak_diketahui',
        bukti: 'OBS',
        verifiedAt: i.verifiedAt,
        catatan: 'Kanal daring belum di-recon; hanya situs informasi terverifikasi.',
      };
      continue;
    }
    if (!(p.kelas in KELAS_KE_JENIS)) galat.push(`${ctx}: kelas tidak dikenal "${p.kelas}"`);
    if (KELAS_KE_JENIS[p.kelas] !== p.jenis)
      galat.push(`${ctx}: jenis "${p.jenis}" tidak cocok dengan kelas ${p.kelas}`);
    if ((p.jenis === 'web') !== p.hosts.length > 0)
      galat.push(`${ctx}: host portal wajib ada untuk jenis web dan hanya untuk jenis web`);
    for (const l of p.login) if (!LOGIN.includes(l)) galat.push(`${ctx}: login tidak dikenal "${l}"`);
    for (const x of p.proteksi)
      if (!PROTEKSI.includes(x)) galat.push(`${ctx}: proteksi tidak dikenal "${x}"`);
    if (!DOMISILI.includes(p.domisili)) galat.push(`${ctx}: domisili tidak dikenal "${p.domisili}"`);
    if (!['OBS', 'PRI'].includes(p.bukti)) galat.push(`${ctx}: bukti harus OBS/PRI`);
    if (!TANGGAL.test(p.verifiedAt)) galat.push(`${ctx}: verifiedAt bukan YYYY-MM-DD`);
    if (p.platform && !platform[p.platform]) galat.push(`${ctx}: platform tidak dikenal "${p.platform}"`);
    if (p.aksesWilayah !== undefined && (!AKSES.includes(p.aksesWilayah) || p.jenis !== 'web'))
      galat.push(
        `${ctx}: aksesWilayah "${p.aksesWilayah}" tidak sah (hanya ${AKSES.join('/')} untuk jenis web)`,
      );
    if (p.url) {
      const u = cekUrl(p.url, ctx);
      if (u && !p.hosts.includes(u.hostname)) galat.push(`${ctx}: host url tidak ada di hosts`);
    }
    const hostInfo = [...new Set([...(i ? [i.host] : []), ...(p.hostInfo ?? [])])];
    // Host aset portal (CDN/API .go.id yang dimuat halaman portal): ikut egress sesi, bukan tujuan AI/vault.
    const hostAset = [...new Set(p.hostAset ?? [])];
    for (const h of [...p.hosts, ...hostInfo, ...hostAset]) cekHost(h, ctx);
    for (const h of hostInfo) if (!hostGoId(h)) galat.push(`${ctx}: host info bukan .go.id "${h}"`);
    for (const h of hostAset) {
      if (!hostGoId(h)) galat.push(`${ctx}: host aset bukan .go.id "${h}"`);
      if (p.hosts.includes(h) || hostInfo.includes(h)) galat.push(`${ctx}: host aset ganda "${h}"`);
    }
    if (hostAset.length > 0 && p.jenis !== 'web') galat.push(`${ctx}: hostAset hanya untuk jenis web`);
    const sumber = p.sumber ?? i?.sumber;
    const su = sumber ? cekUrl(sumber, ctx) : null;
    if (p.hosts.some((h) => !hostGoId(h))) {
      // Host resmi di luar .go.id hanya bila ditautkan dari halaman .go.id.
      if (!su || !hostGoId(su.hostname)) galat.push(`${ctx}: host bukan .go.id tanpa sumber halaman .go.id`);
    }
    wilayah[kode] = {
      kode,
      nama: nama.get(kode),
      kelas: p.kelas,
      jenis: p.jenis,
      ...(p.url ? { url: p.url } : {}),
      hosts: [...p.hosts],
      hostInfo,
      ...(hostAset.length ? { hostAset } : {}),
      ...(sumber ? { sumber } : {}),
      login: [...p.login],
      proteksi: [...p.proteksi],
      domisili: p.domisili,
      ...(p.jamLayanan ? { jamLayanan: p.jamLayanan } : {}),
      ...(p.platform ? { platform: p.platform } : {}),
      ...(p.aksesWilayah ? { aksesWilayah: p.aksesWilayah } : {}),
      bukti: p.bukti,
      verifiedAt: p.verifiedAt,
      catatan: p.catatan,
    };
  }

  // Domain untuk OFFICIAL_DOMAINS: satu baris per host persis (host pertama yang muncul menang).
  const domain = new Map();
  const tambah = (host, d) => {
    if (domain.has(host)) {
      const ada = domain.get(host);
      if (ada.wilayah !== d.wilayah)
        galat.push(`host ${host} dipakai dua wilayah (${ada.wilayah}, ${d.wilayah})`);
      return;
    }
    domain.set(host, { host, ...d });
  };
  for (const [id, p] of Object.entries(platform))
    for (const h of p.hosts)
      tambah(h, {
        instansi: p.pemilik,
        layanan: p.nama,
        wilayah: kodeProvinsiPlatform(kabkota, wilayah, id),
        verifiedAt: p.verifiedAt,
      });
  for (const w of Object.values(wilayah)) {
    const instansi = `Disdukcapil ${w.nama}`;
    for (const h of w.hostInfo)
      tambah(h, {
        instansi,
        layanan: 'Situs informasi Disdukcapil',
        wilayah: w.kode,
        verifiedAt: w.verifiedAt,
      });
    for (const h of w.hostAset ?? [])
      tambah(h, {
        instansi,
        layanan: 'Aset portal layanan (CDN/API)',
        wilayah: w.kode,
        verifiedAt: w.verifiedAt,
      });
    for (const h of w.hosts)
      tambah(h, {
        instansi,
        layanan: `Portal layanan adminduk daring (kelas ${w.kelas})`,
        wilayah: w.kode,
        verifiedAt: w.verifiedAt,
        ...(w.aksesWilayah ? { aksesWilayah: w.aksesWilayah } : {}),
      });
  }

  return {
    galat,
    wilayah,
    platform,
    domain: [...domain.values()],
    kanalNasional: portal.kanalNasional ?? {},
    urutanKanal: portal.urutanKanal ?? [],
    pindah: portal.pindah ?? null,
  };
}

/** Platform dipakai banyak wilayah: kodekan ke provinsi bila semua pemakainya satu provinsi. */
function kodeProvinsiPlatform(kabkota, wilayah, id) {
  const prov = new Set(
    Object.values(wilayah)
      .filter((w) => w.platform === id)
      .map((w) => w.kode.slice(0, 2)),
  );
  return prov.size === 1 ? [...prov][0] : undefined;
}

export function render(h) {
  const j = (v) => JSON.stringify(v);
  const web = Object.values(h.wilayah).filter((w) => w.jenis === 'web').length;
  return `// BERKAS HASIL GENERATOR (scripts/gen-registry-wilayah.mjs). Jangan diubah tangan.
// Sumber: data/wilayah/kontak-dukcapil.json (situs info terverifikasi) dan data/wilayah/portal-dukcapil.json
// (kanal daring hasil recon). ${Object.keys(h.wilayah).length} wilayah, ${web} berjenis web, ${h.domain.length} host persis.
import type { OfficialDomain } from './registry.js';

/** A portal akun, B formulir web tanpa akun, C aplikasi saja, D WhatsApp/chatbot, E kanal nasional/kantor, F tidak diketahui. */
export type KelasKanal = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
/** Routing Navigator: hanya \`web\` yang boleh dikerjakan Browser Pendamping generik. */
export type JenisPortal = 'web' | 'aplikasi' | 'whatsapp' | 'nasional' | 'tidak_diketahui';
export type LoginPortal = ${LOGIN.map((x) => j(x)).join(' | ')};
export type ProteksiPortal = ${PROTEKSI.map((x) => j(x)).join(' | ')};

export type PortalWilayah = {
  kode: string;
  nama: string;
  kelas: KelasKanal;
  jenis: JenisPortal;
  /** URL masuk portal (bila jenis web). */
  url?: string;
  /** Host portal persis (hanya jenis web). */
  hosts: readonly string[];
  /** Host situs informasi Disdukcapil (.go.id). */
  hostInfo: readonly string[];
  /**
   * Host aset .go.id yang dimuat halaman portal (CDN/API, probe nyata): ikut egress sesi (\`hostsWilayah\`),
   * bukan host portal (vault/AI tidak ke sana).
   */
  hostAset?: readonly string[];
  /** Halaman bukti; wajib .go.id untuk host di luar .go.id. */
  sumber?: string;
  login: readonly LoginPortal[];
  proteksi: readonly ProteksiPortal[];
  domisili: 'khusus_penduduk' | 'tidak_dibatasi' | 'tidak_diketahui';
  jamLayanan?: string;
  /** Platform bersama (mis. \`sidak-aceh\`), lihat \`PLATFORM_WILAYAH\`. */
  platform?: string;
  /** Syarat jaringan host portal (diteruskan ke \`OfficialDomain.aksesWilayah\`); \`id-only\` = IP luar negeri ditolak. */
  aksesWilayah?: 'id-only' | 'id-utama';
  /** OBS diamati langsung, PRI recon sebelumnya. */
  bukti: 'OBS' | 'PRI';
  verifiedAt: string;
  catatan: string;
};

export type PlatformWilayah = {
  nama: string;
  pemilik: string;
  sumber: string;
  hosts: readonly string[];
  catatan: string;
  verifiedAt: string;
};

export const PLATFORM_WILAYAH: Readonly<Record<string, PlatformWilayah>> = ${j(h.platform)};

export const PORTAL_WILAYAH: Readonly<Record<string, PortalWilayah>> = ${j(h.wilayah)};

/** Kanal nasional (IKD): aplikasi, dipandu; tidak pernah dikendalikan Browser Pendamping. */
export const KANAL_NASIONAL: Readonly<Record<string, { nama: string; jenis: JenisPortal; sumber: string; catatan: string }>> = ${j(h.kanalNasional)};

/** Urutan kanal saat routing: portal web daerah, IKD terpandu, draf WhatsApp, kantor. */
export const URUTAN_KANAL: readonly ('portal_web' | 'ikd' | 'whatsapp' | 'kantor')[] = ${j(h.urutanKanal)};

/** Pindah: dalam satu kab/kota 1 langkah; antar kab/kota 2 langkah (SKPWNI di asal, lalu datang di tujuan). */
export const ATURAN_PINDAH = ${j(h.pindah)} as const;

/** Baris OFFICIAL_DOMAINS dari data wilayah (digabung di registry.ts; seed tangan menang bila host sama). */
export const DOMAIN_WILAYAH: readonly OfficialDomain[] = ${j(h.domain)};

/**
 * Host pihak ketiga yang ikut sesi wilayah HANYA bersama host wilayah (tantangan Cloudflare yang diselesaikan
 * warga sendiri). Bagian dari \`EGRESS_PIHAK_KETIGA\` global.
 */
export const EGRESS_PIHAK_KETIGA_WILAYAH: readonly string[] = ['challenges.cloudflare.com'];

/** Host persis yang boleh dibuka sesi untuk kab/kota \`kode\`; kosong bila wilayah tidak punya host terdaftar. */
export function hostsWilayah(kode: string): string[] {
  const p = Object.hasOwn(PORTAL_WILAYAH, kode) ? PORTAL_WILAYAH[kode] : undefined;
  if (!p) return [];
  const sendiri = [...p.hostInfo, ...p.hosts, ...(p.hostAset ?? [])];
  if (p.platform && Object.hasOwn(PLATFORM_WILAYAH, p.platform)) sendiri.push(...PLATFORM_WILAYAH[p.platform]!.hosts);
  if (sendiri.length === 0) return [];
  return [...new Set([...sendiri, ...EGRESS_PIHAK_KETIGA_WILAYAH])];
}
`;
}

async function main() {
  const check = process.argv.includes('--check');
  const h = susun(
    baca('data/wilayah/kabkota.json'),
    baca('data/wilayah/kontak-dukcapil.json'),
    baca('data/wilayah/portal-dukcapil.json'),
  );
  if (h.galat.length) {
    for (const g of h.galat) console.error(`gen-registry-wilayah: ${g}`);
    return 1;
  }
  const opsi = (await prettier.resolveConfig(OUT)) ?? {};
  const isi = await prettier.format(render(h), { ...opsi, filepath: OUT });
  const web = Object.values(h.wilayah).filter((w) => w.jenis === 'web').length;
  if (check) {
    let lama = '';
    try {
      lama = readFileSync(OUT, 'utf8');
    } catch {
      // belum ada
    }
    if (lama.replace(/\r\n/g, '\n') !== isi) {
      console.error(
        'gen-registry-wilayah: registry-wilayah.ts usang; jalankan node scripts/gen-registry-wilayah.mjs',
      );
      return 1;
    }
    console.log(`gen-registry-wilayah: mutakhir (${Object.keys(h.wilayah).length} wilayah, ${web} web).`);
    return 0;
  }
  writeFileSync(OUT, isi);
  console.log(
    `registry-wilayah.ts: ${Object.keys(h.wilayah).length} wilayah, ${web} web, ${h.domain.length} host persis.`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
