import { createHash } from 'node:crypto';

/**
 * Gerbang tulis jaringan Navigator generik (ADR 0030, desain §2 "Firewall"). Lapis kedua setelah klasifikator
 * di halaman: permintaan yang DISEBABKAN aksi AI dan bisa menulis ke situs (metode non-GET, atau navigasi
 * dokumen yang tidak terduga) dibatalkan `route.abort` SEBELUM terkirim.
 *
 * AI vs warga dibedakan dari pemegang kendali, bukan dari isi permintaan: AI hanya bertindak lewat `el.click()`
 * sintetis di isolated world (runner op `aksi`) atau `Page.navigate`, sedangkan ketukan warga masuk lewat CDP
 * `Input.dispatch*` dan HANYA diteruskan saat warga memegang kendali (mode takeover). Jendela `warga` aktif
 * tepat selama itu; di luar itu jendela AI berlaku.
 */
export type Jendela =
  /** Warga memegang kendali: semua lolos (allowlist egress tetap berlaku). */
  | { jenis: 'warga' }
  /** AI memegang kendali tetapi tidak sedang beraksi: semua non-GET dan semua navigasi dokumen diblokir. */
  | { jenis: 'ai_diam' }
  /** Isi/pilih/unggah: XHR non-GET boleh sampai `sampai` (epoch ms, <= 3 detik); navigasi dokumen diblokir. */
  | { jenis: 'ai_isi'; sampai: number }
  /** Klik AI: hanya GET; navigasi dokumen hanya ke `navKe` (klik `navigasi` = Page.navigate(href)). */
  | { jenis: 'ai_klik'; navKe?: string | undefined };

export type JenisJendelaAi = Exclude<Jendela['jenis'], 'warga'>;

export type PermintaanGerbang = {
  metode: string;
  /** Navigasi dokumen bingkai utama (bukan subresource/iframe). */
  dokumen: boolean;
  url: string;
  /** URL awal rantai redirect (bila permintaan ini hasil redirect). */
  asal?: string | undefined;
};

export type Putusan = 'lanjut' | 'blokir';

/** Batas jendela `ai_isi` (desain: XHR non-GET boleh <= 3 detik setelah isi/pilih/unggah). */
export const JENDELA_ISI_MS = 3000;

/** Metode yang tidak mengubah keadaan server (preflight CORS ikut di sini). */
const AMAN: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

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
export function putuskan(j: Jendela, r: PermintaanGerbang, sekarang: number = Date.now()): Putusan {
  if (j.jenis === 'warga') return 'lanjut';
  const aman = AMAN.has(r.metode.toUpperCase());
  switch (j.jenis) {
    case 'ai_diam':
      return r.dokumen || !aman ? 'blokir' : 'lanjut';
    case 'ai_isi':
      if (r.dokumen) return 'blokir';
      return aman || sekarang <= j.sampai ? 'lanjut' : 'blokir';
    case 'ai_klik': {
      if (!aman) return 'blokir';
      if (!r.dokumen) return 'lanjut';
      const navKe = j.navKe;
      if (navKe === undefined) return 'blokir';
      return samaUrl(r.url, navKe) || (r.asal !== undefined && samaUrl(r.asal, navKe)) ? 'lanjut' : 'blokir';
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
  };
}

export type GerbangTulis = {
  /** Jendela yang berlaku sekarang (warga bila warga memegang kendali). */
  jendela(): Jendela;
  /** Jendela AI berikutnya (dipakai GenerikRun sebelum/sesudah setiap aksi). */
  setAi(j: Exclude<Jendela, { jenis: 'warga' }>): void;
  /** Dipanggil dari `context.route` SETELAH allowlist egress lolos. */
  periksa(r: PermintaanGerbang): Putusan;
};

/**
 * Pemegang jendela satu sesi. `wargaPegang` dibaca setiap permintaan (bukan di-cache) agar ambil alih
 * berlaku seketika. `onBlokir` menerima catatan tanpa nilai; eskalasi ke warga diputuskan pemanggil.
 */
export function createGerbangTulis(opts: {
  wargaPegang: () => boolean;
  onBlokir: (c: CatatanBlokir, j: Exclude<Jendela, { jenis: 'warga' }>) => void;
  now?: () => number;
}): GerbangTulis {
  const now = opts.now ?? Date.now;
  let ai: Exclude<Jendela, { jenis: 'warga' }> = { jenis: 'ai_diam' };
  const jendela = (): Jendela => (opts.wargaPegang() ? { jenis: 'warga' } : ai);
  return {
    jendela,
    setAi(j) {
      ai = j;
    },
    periksa(r) {
      const j = jendela();
      const p = putuskan(j, r, now());
      if (p === 'blokir' && j.jenis !== 'warga') opts.onBlokir(catatanBlokir(j, r), j);
      return p;
    },
  };
}
