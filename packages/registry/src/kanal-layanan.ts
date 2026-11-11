import { DATA_KANAL_LAYANAN } from './wilayah-data.js';

/**
 * Kontak layanan resmi per kab/kota dari data/wilayah/kanal-layanan.json (dibaca dari halaman .go.id instansinya,
 * tiap nilai dengan URL sumber dan tanggal cek). Wilayah tanpa data mengembalikan undefined: jangan mengarang.
 */
export type LayananKontak = 'adminduk' | 'skck';

export type KontakLayanan = {
  instansi: string;
  telepon: string[];
  whatsapp: string[];
  email: string[];
  jamLayanan?: string;
  layananOnline: { nama: string; url: string }[];
  /** Halaman sumber berikut tanggal cek, urut kemunculan (halaman pertama = paling spesifik). */
  sumber: { url: string; dicekPada: string }[];
};

export function kontakLayanan(kode: string, layanan: LayananKontak): KontakLayanan | undefined {
  const entri = DATA_KANAL_LAYANAN.filter((e) => e.kode === kode && e.layanan === layanan);
  if (entri.length === 0) return undefined;
  const k: KontakLayanan = {
    instansi: entri[0]!.instansi,
    telepon: [],
    whatsapp: [],
    email: [],
    layananOnline: [],
    sumber: [],
  };
  for (const e of entri) {
    if (e.jenis === 'telepon') k.telepon.push(e.nilai);
    else if (e.jenis === 'whatsapp') k.whatsapp.push(e.nilai);
    else if (e.jenis === 'email') k.email.push(e.nilai);
    else if (e.jenis === 'jam_layanan') k.jamLayanan ??= e.nilai;
    else if (e.jenis === 'layanan_online' && e.url) k.layananOnline.push({ nama: e.nilai, url: e.url });
    if (!k.sumber.some((s) => s.url === e.sumberUrl))
      k.sumber.push({ url: e.sumberUrl, dicekPada: e.dicekPada });
  }
  return k;
}

/** Satu baris untuk warga/agen: "Telepon (0273) 321468 · WhatsApp 0823-... · Email ... · Jam layanan ...". */
export function ringkasKontak(k: KontakLayanan): string {
  return [
    k.telepon.length ? `Telepon ${k.telepon.join(' / ')}` : '',
    k.whatsapp.length ? `WhatsApp ${k.whatsapp.join(' / ')}` : '',
    k.email.length ? `Email ${k.email.join(' / ')}` : '',
    k.jamLayanan ? `Jam layanan ${k.jamLayanan}` : '',
    ...k.layananOnline.map((l) => `${l.nama} ${l.url}`),
  ]
    .filter(Boolean)
    .join(' · ');
}

const digit = (s: string) => s.replace(/\D/g, '').replace(/^62/, '0');

const RESMI = new Set(
  DATA_KANAL_LAYANAN.flatMap((e) =>
    e.jenis === 'telepon' || e.jenis === 'whatsapp'
      ? [digit(e.nilai)]
      : e.jenis === 'email'
        ? [e.nilai.toLowerCase()]
        : [],
  ),
);

/**
 * True bila nomor/email ini kontak resmi instansi yang tercatat (bukan data pribadi warga), sehingga interseptor PII
 * tidak menggantinya dengan placeholder. Nomor dibandingkan per digit (62 = 0).
 */
export function kontakResmiTercatat(nilai: string): boolean {
  return nilai.includes('@') ? RESMI.has(nilai.trim().toLowerCase()) : RESMI.has(digit(nilai));
}
