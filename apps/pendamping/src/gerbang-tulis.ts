import { createHash } from 'node:crypto';
import { EGRESS_ASET_UMUM, PLATFORM_WILAYAH, PORTAL_WILAYAH } from '@urusin/core';
import { jalurTulis } from '@urusin/executor';

/**
 * Gerbang tulis jaringan Navigator generik (ADR 0030, desain §2 "Firewall"). Lapis kedua setelah klasifikator
 * di halaman: permintaan yang DISEBABKAN aksi AI dan bisa menulis ke situs (metode non-GET, atau navigasi
 * dokumen yang tidak terduga) dibatalkan `route.abort` SEBELUM terkirim.
 *
 * AI vs warga dibedakan dari INPUT warga, bukan dari isi permintaan: AI hanya bertindak lewat `el.click()`
 * sintetis di isolated world (runner op `aksi`) atau `Page.navigate`, sedangkan ketukan warga masuk lewat CDP
 * `Input.dispatch*` dan HANYA diteruskan saat warga memegang kendali (mode takeover). Jendela `warga` terbuka
 * hanya sesaat setelah input warga yang nyata (`JENDELA_WARGA_MS`); serah terima tanpa input = `ai_diam`
 * dengan `tungguWarga` (baca lolos, tulis hanya ke tantangan pihak ketiga), sehingga retry/callback yang
 * dipicu klik AI tidak ikut lolos begitu kendali berpindah.
 */
export type Jendela =
  /** Warga memegang kendali: semua lolos (allowlist egress tetap berlaku). */
  | { jenis: 'warga' }
  /**
   * AI tidak sedang beraksi: semua non-GET dan navigasi bingkai utama diblokir (GET lain, termasuk iframe,
   * setara subresource GET). `tungguWarga` = warga memegang kendali tetapi belum menyentuh layar: semua GET
   * lolos (warga bisa sedang menunggu login lambat), non-GET hanya ke tantangan pihak ketiga (Cloudflare dsb.).
   */
  | { jenis: 'ai_diam'; tungguWarga?: true }
  /**
   * Isi/pilih/centang/unggah: hanya XHR/fetch non-GET sampai `sampai` (epoch ms, <= 3 detik). Navigasi di bingkai
   * MANA PUN (form POST ke iframe) dan tulis non-XHR (sendBeacon, keepalive ping) diblokir.
   */
  | { jenis: 'ai_isi'; sampai: number }
  /**
   * Klik AI: hanya GET. Navigasi bingkai utama hanya ke `navKe` (klik `navigasi` = Page.navigate(href)); navigasi
   * iframe hanya saat memuat halaman `navKe` (tanpa `navKe`, form GET ke iframe = diblokir).
   */
  | { jenis: 'ai_klik'; navKe?: string | undefined };

export type JenisJendelaAi = Exclude<Jendela['jenis'], 'warga'>;

export type PermintaanGerbang = {
  metode: string;
  /** Navigasi dokumen di bingkai mana pun (bingkai utama atau iframe). */
  dokumen: boolean;
  /** Navigasi dokumen bingkai UTAMA. */
  utama: boolean;
  /** XHR/fetch (bukan dokumen, beacon, ping, gambar, ...). */
  xhr: boolean;
  url: string;
  /** URL awal rantai redirect (bila permintaan ini hasil redirect). */
  asal?: string | undefined;
  /**
   * Host permintaan pernah membalas dengan header `cf-ray` (Cloudflare nyata): syarat jalur
   * `/cdn-cgi/challenge-platform/` di host portal dianggap tantangan (review L3).
   */
  hostCloudflare?: boolean | undefined;
};

export type Putusan = 'lanjut' | 'blokir';

/** Batas jendela `ai_isi` (desain: XHR non-GET boleh <= 3 detik setelah isi/pilih/unggah). */
export const JENDELA_ISI_MS = 3000;

/** Jendela `warga` sesudah input warga nyata (pointer/key/teks lewat CDP Input). */
export const JENDELA_WARGA_MS = 3000;

const RE_HOST_TANTANGAN = /(^|\.)(challenges\.cloudflare\.com|hcaptcha\.com|recaptcha\.net)$/;

/**
 * Permintaan ke tantangan pihak ketiga (Turnstile, hCaptcha, reCAPTCHA) atau platform tantangan Cloudflare di
 * host portal sendiri (hanya host yang terbukti di belakang Cloudflare, `hostCloudflare`). Allowlist egress tetap
 * berlaku lebih dulu.
 */
export function urlTantangan(url: string, hostCloudflare = false): boolean {
  const u = URL.parse(url);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  return (
    RE_HOST_TANTANGAN.test(host) ||
    (host === 'www.google.com' && u.pathname.startsWith('/recaptcha/')) ||
    (hostCloudflare && u.pathname.startsWith('/cdn-cgi/challenge-platform/'))
  );
}

/** www.google.com ada di allowlist sesi hanya untuk reCAPTCHA: jalur lain ditolak (review L3). */
export function jalurPihakKetigaBoleh(url: string): boolean {
  const u = URL.parse(url);
  return !u || u.hostname.toLowerCase() !== 'www.google.com' || u.pathname.startsWith('/recaptcha/');
}

const HOST_ASET_UMUM: ReadonlySet<string> = new Set(EGRESS_ASET_UMUM);

/**
 * Host aset umum (CDN pustaka, fon) yang ikut bawaan sesi: hanya untuk subresource. CDN seperti unpkg/jsdelivr
 * menyajikan HTML dari paket siapa saja, jadi tidak pernah boleh menjadi dokumen (bingkai mana pun) atau tujuan
 * navigasi AI/tautan/pop-up (re-review LOW).
 */
export function hostAsetUmum(url: string): boolean {
  const h = URL.parse(url)?.hostname.toLowerCase().replace(/\.$/, '');
  return h !== undefined && HOST_ASET_UMUM.has(h);
}

/**
 * Host aset .go.id milik portal (`hostAset` registry wilayah: CDN/API pemda, probe gel4 3310/3404), kecuali yang
 * juga host portal/info/platform di wilayah mana pun.
 */
const HOST_ASET_WILAYAH: ReadonlySet<string> = (() => {
  const portal = new Set([
    ...Object.values(PORTAL_WILAYAH).flatMap((p) => [...p.hosts, ...p.hostInfo]),
    ...Object.values(PLATFORM_WILAYAH).flatMap((p) => p.hosts),
  ]);
  return new Set(
    Object.values(PORTAL_WILAYAH)
      .flatMap((p) => p.hostAset ?? [])
      .filter((h) => !portal.has(h)),
  );
})();

/** Host aset pemda (`hostAset`): sama seperti aset umum, bukan dokumen dan bukan tujuan navigasi (re-review LOW). */
export function hostAsetWilayah(url: string): boolean {
  const h = URL.parse(url)?.hostname.toLowerCase().replace(/\.$/, '');
  return h !== undefined && HOST_ASET_WILAYAH.has(h);
}

/** Host yang hanya melayani subresource: aset umum (CDN/fon) atau aset pemda (`hostAset`). */
export function hostAset(url: string): boolean {
  return hostAsetUmum(url) || hostAsetWilayah(url);
}

/** Jenis sumber daya yang boleh diambil dari host aset umum (Playwright `resourceType`). */
const TIPE_ASET_UMUM: ReadonlySet<string> = new Set(['script', 'stylesheet', 'font', 'image']);

/**
 * Host aset umum hanya melayani subresource script/stylesheet/font/image; navigasi dokumen (bingkai mana pun),
 * XHR/fetch, dan jenis lain ke host itu ditolak (re-review MEDIUM: unpkg menyajikan HTML paket npm sebagai
 * text/html sementara bilah atas tetap menampilkan origin portal). Host aset pemda (`hostAset`) diperlakukan
 * sama (re-review LOW). Host lain tidak terpengaruh.
 */
export function asetUmumBoleh(r: { url: string; resourceType: string; dokumen: boolean }): boolean {
  return !hostAset(r.url) || (!r.dokumen && TIPE_ASET_UMUM.has(r.resourceType));
}

/** Metode yang tidak mengubah keadaan server (preflight CORS ikut di sini). */
export const AMAN: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** URL tanpa fragmen (fragmen tidak pernah dikirim ke server). */
function tanpaFragmen(u: string): string | undefined {
  const x = URL.parse(u);
  if (!x) return undefined;
  x.hash = '';
  return x.href;
}

function samaUrl(a: string, b: string): boolean {
  const x = tanpaFragmen(a);
  return x !== undefined && x === tanpaFragmen(b);
}

/**
 * Putusan murni satu permintaan terhadap jendela saat ini. `sekarang` hanya dipakai jendela `ai_isi`.
 * Default tolak: metode tidak dikenal = non-GET.
 */
export function putuskan(
  j: Jendela,
  r: PermintaanGerbang,
  sekarang: number = Date.now(),
  /** Dokumen kotor (N2) atau halaman akhir: GET bingkai utama di luar navKe (redirect halaman) diblokir. */
  ketat = false,
): Putusan {
  // Dokumen dari host aset (CDN/fon, aset pemda) tidak pernah lolos, di jendela mana pun termasuk warga.
  if (r.dokumen && hostAset(r.url)) return 'blokir';
  if (j.jenis === 'warga') return 'lanjut';
  // Telemetri/verifikasi tantangan (Turnstile flow, reCAPTCHA reload) bukan tulis ke portal: lolos di semua
  // jendela AI agar widget tidak gagal karena balapan dengan klik AI (probe #14). Navigasi dokumen tidak.
  const tantangan = urlTantangan(r.url, r.hostCloudflare === true);
  if (!r.dokumen && tantangan) return 'lanjut';
  const aman = AMAN.has(r.metode.toUpperCase());
  switch (j.jenis) {
    case 'ai_diam':
      if (j.tungguWarga) {
        if (ketat && r.utama && !tantangan) return 'blokir';
        return aman || tantangan ? 'lanjut' : 'blokir';
      }
      if (!aman) return 'blokir';
      if (ketat && r.utama) return 'blokir';
      // Redirect JS/meta halaman sendiri (probe 3674 ?p=close_form): GET bingkai utama boleh bila jalur/kuerinya
      // tidak berbunyi tulis (aturan jalur yang sama dengan tautan yang boleh diklik AI). Host tetap dibatasi
      // allowlist egress sesi.
      return r.utama && jalurTulis(r.url) ? 'blokir' : 'lanjut';
    case 'ai_isi':
      if (r.dokumen) return 'blokir';
      if (aman) return 'lanjut';
      return r.xhr && sekarang <= j.sampai ? 'lanjut' : 'blokir';
    case 'ai_klik': {
      if (!aman) return 'blokir';
      if (!r.dokumen) return 'lanjut';
      const navKe = j.navKe;
      if (navKe === undefined) return 'blokir';
      if (!r.utama) return 'lanjut';
      if (samaUrl(r.url, navKe) || (r.asal !== undefined && samaUrl(r.asal, navKe))) return 'lanjut';
      // Redirect JS/meta halaman tujuan sesudah navigasi AI ke navKe (probe 3674 pilih_layanan -> ?p=close_form):
      // aturan yang sama dengan ai_diam. Klik tombol tanpa navKe tetap tidak boleh memicu navigasi apa pun.
      return ketat || jalurTulis(r.url) ? 'blokir' : 'lanjut';
    }
  }
}

/** Catatan blokir untuk audit `jejak_pendamping`: metode, host, sha256(path). Tanpa query, isi, atau nilai. */
export type CatatanBlokir = {
  metode: string;
  host: string;
  jalurSha256: string;
  jendela: JenisJendelaAi;
  dokumen: boolean;
  xhr: boolean;
};

export function catatanBlokir(j: Exclude<Jendela, { jenis: 'warga' }>, r: PermintaanGerbang): CatatanBlokir {
  const u = URL.parse(r.url);
  const metode = r.metode.toUpperCase();
  return {
    metode: /^[A-Z]{3,7}$/.test(metode) ? metode : 'LAINNYA',
    host: (u?.host || 'tidak-dikenal').slice(0, 253),
    jalurSha256: createHash('sha256')
      .update(u?.pathname ?? '')
      .digest('hex'),
    jendela: j.jenis,
    dokumen: r.dokumen,
    xhr: r.xhr,
  };
}

export type GerbangTulis = {
  /** Jendela yang berlaku sekarang (warga hanya sesaat setelah input warga). */
  jendela(): Jendela;
  /** Jendela AI berikutnya (dipakai GenerikRun sebelum/sesudah setiap aksi). */
  setAi(j: Exclude<Jendela, { jenis: 'warga' }>): void;
  /** Dipanggil dari `context.route` SETELAH allowlist egress lolos. */
  periksa(r: PermintaanGerbang): Putusan;
  /**
   * Kanal yang tidak bisa diperiksa per permintaan (WebSocket): selalu ditolak; dicatat seperti blokir lain
   * bila jendela bukan `warga`.
   */
  tolak(r: PermintaanGerbang): 'blokir';
};

/**
 * Pemegang jendela satu sesi. `wargaPegang` (warga memegang kendali DAN baru saja memberi input) dan
 * `wargaTunggu` (warga memegang kendali) dibaca setiap permintaan (bukan di-cache). `onBlokir` menerima catatan
 * tanpa nilai; eskalasi ke warga diputuskan pemanggil.
 */
export function createGerbangTulis(opts: {
  wargaPegang: () => boolean;
  wargaTunggu?: () => boolean;
  onBlokir: (c: CatatanBlokir, j: Exclude<Jendela, { jenis: 'warga' }>) => void;
  /** Tulis non-GET yang lolos di jendela `warga` (warga mengirim sendiri); tanpa catatan apa pun. */
  onTulisWarga?: () => void;
  /** Mode ketat (dokumen kotor / halaman akhir), dibaca setiap permintaan. */
  ketat?: () => boolean;
  now?: () => number;
}): GerbangTulis {
  const now = opts.now ?? Date.now;
  let ai: Exclude<Jendela, { jenis: 'warga' }> = { jenis: 'ai_diam' };
  const jendela = (): Jendela =>
    opts.wargaPegang()
      ? { jenis: 'warga' }
      : opts.wargaTunggu?.()
        ? { jenis: 'ai_diam', tungguWarga: true }
        : ai;
  return {
    jendela,
    setAi(j) {
      ai = j;
    },
    periksa(r) {
      const j = jendela();
      const p = putuskan(j, r, now(), opts.ketat?.() === true);
      if (p === 'blokir' && j.jenis !== 'warga') opts.onBlokir(catatanBlokir(j, r), j);
      if (p === 'lanjut' && j.jenis === 'warga' && !AMAN.has(r.metode.toUpperCase())) opts.onTulisWarga?.();
      return p;
    },
    tolak(r) {
      const j = jendela();
      if (j.jenis !== 'warga') opts.onBlokir(catatanBlokir(j, r), j);
      return 'blokir';
    },
  };
}
