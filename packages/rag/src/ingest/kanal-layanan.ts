/**
 * Kontak layanan resmi per kab/kota (telepon, WhatsApp, email, jam layanan, layanan online) yang dibaca dari halaman
 * `.go.id` instansinya sendiri. Setiap nilai menyimpan URL halaman sumber dan tanggal cek. Hanya nilai yang tertulis
 * bersama labelnya (atau sebagai tautan tel:/WhatsApp) yang diambil; format yang tidak sah dibuang, bukan ditebak.
 */
export type LayananKanal = 'adminduk' | 'skck';
export type JenisKontak = 'telepon' | 'whatsapp' | 'email' | 'jam_layanan' | 'layanan_online';

export type EntriKanal = {
  kode: string;
  layanan: LayananKanal;
  instansi: string;
  jenis: JenisKontak;
  /** Nilai seperti tertulis (dirapikan): nomor, alamat email, jadwal, atau nama layanan online. */
  nilai: string;
  /** Hanya `layanan_online`: alamat layanannya. */
  url?: string;
  /** Halaman resmi tempat nilai ini dibaca. */
  sumberUrl: string;
  /** Tanggal cek (YYYY-MM-DD). */
  dicekPada: string;
};

export type KontakHalaman = { telepon: string[]; whatsapp: string[]; email: string[]; jamLayanan?: string };

const MAKS_PER_JENIS = 3;

/** Email yang disamarkan Cloudflare (`data-cfemail`): byte pertama = kunci XOR. */
export function decodeCfEmail(hex: string): string {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i + 1 < hex.length; i += 2)
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

/** Teks tampak halaman: tanpa komentar HTML, skrip, gaya; email Cloudflare dibuka; entitas umum diganti. */
export function teksHalaman(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(
      /<[^>]*data-cfemail=["']([0-9a-f]+)["'][^>]*>[\s\S]*?<\/[a-z]+>/gi,
      (_, hex: string) => ` ${decodeCfEmail(hex)} `,
    )
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#8211;|&ndash;/gi, '–')
    .replace(/&#8212;|&mdash;/gi, '—')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const digit = (s: string) => s.replace(/\D/g, '');
/** 62xxxx / +62xxxx menjadi 0xxxx. */
const nasional = (d: string) => (d.startsWith('62') ? `0${d.slice(2)}` : d);
/** Nomor contoh templat situs ((021) 12345678) dan deret satu angka bukan nomor sungguhan. */
const nomorContoh = (d: string) => /1234567|^0(\d)\1+$/.test(d);
const sahTelepon = (d: string) => /^0[2-9]\d{6,11}$/.test(d) && !nomorContoh(d);
const sahSeluler = (d: string) => /^08[1-9]\d{7,10}$/.test(d) && !nomorContoh(d);

/** Nomor rapi: seluler dikelompokkan 4-4-sisa digit; telepon tetap dibiarkan seperti tertulis. */
function rapiNomor(d: string): string {
  if (d.startsWith('08')) return [d.slice(0, 4), d.slice(4, 8), d.slice(8)].filter(Boolean).join('-');
  return d;
}

function tambah(daftar: string[], nilai: string): void {
  if (!daftar.includes(nilai) && daftar.length < MAKS_PER_JENIS) daftar.push(nilai);
}

const HARI = /\b(senin|selasa|rabu|kamis|jum'?at|sabtu|minggu)\b/i;
const RENTANG_JAM =
  /\d{1,2}[.:]\d{2}\s*(?:wib|wita|wit)?\s*(?:-|–|—|s\.?\s*d\.?|sampai)\s*\d{1,2}[.:]\d{2}(?:\s*(?:wib|wita|wit)\b)?/gi;

/** Jadwal setelah label "Jam Pelayanan/Layanan/Operasional/Kerja": hanya bila memuat hari dan rentang jam. */
export function ekstrakJam(teks: string): string | undefined {
  for (const m of teks.matchAll(/\bjam\s+(?:pelayanan|layanan|operasional|kerja|buka)\b/gi)) {
    const awal = m.index + m[0].length;
    const potong = teks.slice(awal, awal + 260);
    let akhir = -1;
    let sebelum = 0;
    for (const r of potong.matchAll(RENTANG_JAM)) {
      if (r.index - sebelum > 90) break;
      akhir = r.index + r[0].length;
      sebelum = akhir;
    }
    if (akhir < 0) continue;
    akhir += /^\s*(?:wib|wita|wit)?\s*\)?/i.exec(potong.slice(akhir))?.[0].length ?? 0;
    // "Sabtu : Libur" / "Sabtu Tutup" sesudah rentang terakhir ikut dibawa.
    const sisa =
      /^(?:\s*[,;]?\s*(?:hari\s+)?(?:sabtu|minggu|sabtu\s*[-–,&]\s*minggu)(?:\s*(?:dan|&)\s*(?:minggu|hari libur(?: nasional)?))?\s*:?\s*(?:libur|tutup))+/i.exec(
        potong.slice(akhir),
      );
    const jadwal = potong
      .slice(0, akhir + (sisa?.[0].length ?? 0))
      .replace(/^[\s:=•-]+/, '')
      .trim();
    // Hari harus disebut sebelum jam pertama, agar rentang jam tidak lepas dari harinya.
    const jamPertama = jadwal.search(/\d{1,2}[.:]\d{2}/);
    if (HARI.test(jadwal.slice(0, jamPertama)) && jadwal.length <= 220) return jadwal;
  }
  return undefined;
}

/** Kontak dari satu halaman resmi. */
export function ekstrakKontak(html: string): KontakHalaman {
  const out: KontakHalaman = { telepon: [], whatsapp: [], email: [] };
  for (const m of html.matchAll(
    /href=["'](?:https?:\/\/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?(?:[^"']*&)?phone=)(\+?\d{9,15}))/gi,
  )) {
    const d = nasional(digit(m[1] ?? ''));
    if (sahSeluler(d)) tambah(out.whatsapp, rapiNomor(d));
  }
  const teks = teksHalaman(html).replace(/\s*(?:\[\s*@\s*\]|\(\s*at\s*\)|\[\s*at\s*\])\s*/gi, '@');
  for (const m of teks.matchAll(
    /\b(?:whats\s?app|wa)\b(?:\s*\/\s*sms)?[^\d+]{0,40}((?:\+\s?62|62|0)\s?8[\d\s.-]{7,16}\d)/gi,
  )) {
    const d = nasional(digit(m[1] ?? ''));
    if (sahSeluler(d)) tambah(out.whatsapp, rapiNomor(d));
  }
  for (const m of html.matchAll(/href=["']tel:([+\d\s().-]{7,24})["']/gi)) {
    const d = nasional(digit(m[1] ?? ''));
    if (sahTelepon(d) && !out.whatsapp.includes(rapiNomor(d))) tambah(out.telepon, rapiNomor(d));
  }
  for (const m of teks.matchAll(
    /\b(?:no\.?\s*)?(?:telp\.?|telepon|tlp\.?|phone|call\s?cent(?:er|re)|hotline)(?![a-z])[^\d+(]{0,24}(\(?\+?\d[\d\s().-]{5,18}\d)/gi,
  )) {
    const tulis = (m[1] ?? '').trim();
    const d = nasional(digit(tulis));
    if (!sahTelepon(d) || out.whatsapp.includes(rapiNomor(d))) continue;
    tambah(out.telepon, d.startsWith('08') ? rapiNomor(d) : tulis.replace(/\s+/g, ' '));
  }
  for (const m of teks.matchAll(
    /\b(?:e-?mail|surel)\b\s*[:：]?\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/gi,
  )) {
    tambah(out.email, (m[1] ?? '').toLowerCase());
  }
  // mailto tanpa label hanya bila alamatnya sendiri berdomain pemerintah.
  for (const m of html.matchAll(/href=["']mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.go\.id)\b/gi)) {
    tambah(out.email, (m[1] ?? '').toLowerCase());
  }
  const jam = ekstrakJam(teks);
  if (jam) out.jamLayanan = jam;
  return out;
}

/** Tautan halaman kontak di host yang sama ("kontak", "hubungi kami", "contact"), paling banyak `maks`. */
export function tautanKontak(html: string, baseUrl: string, maks = 2): string[] {
  const base = new URL(baseUrl);
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1] ?? '';
    const label = (m[2] ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      continue;
    }
    // Menu kontak, bukan artikel yang kebetulan memuat kata "hubungi" (mis. berita tentang CS bank).
    const segmen = u.pathname.split('/').filter(Boolean).at(-1) ?? '';
    const menu = label.length <= 30 && /kontak|hubungi|contact/i.test(label);
    if (!menu && !/^(?:kontak|hubungi|contact)(?:[-_]?(?:kami|us))?(?:\.html?|\.php)?$/i.test(segmen))
      continue;
    if (u.hostname !== base.hostname || !/^https?:$/.test(u.protocol)) continue;
    u.hash = '';
    const s = u.toString();
    if (s !== base.toString() && !out.includes(s)) out.push(s);
    if (out.length >= maks) break;
  }
  return out;
}

const EMAIL_INSTANSI: Record<LayananKanal, RegExp> = {
  adminduk: /capil|duk|penduduk|sipil/i,
  skck: /polri|polres|polsek|skck/i,
};

/** Entri kanal dari kontak satu halaman. */
export function entriDariHalaman(
  k: { kode: string; layanan: LayananKanal; instansi: string },
  kontak: KontakHalaman,
  sumberUrl: string,
  dicekPada: string,
): EntriKanal[] {
  const e = (jenis: JenisKontak, nilai: string): EntriKanal => ({ ...k, jenis, nilai, sumberUrl, dicekPada });
  return [
    ...kontak.telepon.map((v) => e('telepon', v)),
    ...kontak.whatsapp.map((v) => e('whatsapp', v)),
    // Email pengelola situs (kominfo, webmaster) bukan kontak layanan: hanya alamat yang menyebut instansinya.
    ...kontak.email.filter((v) => EMAIL_INSTANSI[k.layanan].test(v)).map((v) => e('email', v)),
    ...(kontak.jamLayanan ? [e('jam_layanan', kontak.jamLayanan)] : []),
  ];
}

/** Gabung entri: satu nilai per (kode, layanan, jenis); yang pertama (halaman paling spesifik) menang. */
export function gabungEntri(entri: readonly EntriKanal[]): EntriKanal[] {
  const out: EntriKanal[] = [];
  const kunci = (x: EntriKanal) =>
    `${x.kode}|${x.layanan}|${x.jenis}|${x.jenis === 'jam_layanan' ? '' : digit(x.nilai) || x.nilai.toLowerCase()}`;
  const ada = new Set<string>();
  const perJenis = new Map<string, number>();
  for (const x of entri) {
    const kj = `${x.kode}|${x.layanan}|${x.jenis}`;
    if (ada.has(kunci(x)) || (perJenis.get(kj) ?? 0) >= MAKS_PER_JENIS) continue;
    ada.add(kunci(x));
    perJenis.set(kj, (perJenis.get(kj) ?? 0) + 1);
    out.push(x);
  }
  return out.sort((a, b) => a.kode.localeCompare(b.kode) || a.layanan.localeCompare(b.layanan));
}
