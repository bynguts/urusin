import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { isAllowedUrl } from './allowlist.js';

/** `data/kanal-resmi.json` di akar repo; src/ dan dist/ sama dalamnya. */
export const KANAL_PATH = new URL('../../../data/kanal-resmi.json', import.meta.url);

export const KanalSchema = z.object({
  /** Sama dengan id di data/glossary/luar-cakupan.json. */
  id: z.string().min(1),
  layanan: z.string().min(1),
  instansi: z.string().min(1),
  url: z.string().refine(isAllowedUrl, 'URL harus https dan berdomain resmi (.go.id)'),
  deskripsi: z.string().min(1),
  /** Regex (huruf kecil) yang harus muncul di halaman agar tautan dianggap benar saat verifikasi. */
  cek: z.string().min(1),
  /** Halaman resmi lain yang diambil untuk verifikasi bila `url` tak terjangkau dari lingkungan verifikasi (mis. memblokir bot). */
  verifikasiVia: z.string().refine(isAllowedUrl).optional(),
  verifiedAt: z.iso.datetime().nullable(),
});
export type Kanal = z.infer<typeof KanalSchema>;
export const KanalFileSchema = z.object({ catatan: z.string().optional(), kanal: z.array(KanalSchema) });

/** Yang ditampilkan ke agen: tautan dan tanggal hanya bila terverifikasi; selain itu hanya nama instansi. */
export type KanalResmi = {
  layanan: string;
  instansi: string;
  deskripsi: string;
  url?: string;
  verifiedAt?: string;
};

export function loadKanal(path: string = fileURLToPath(KANAL_PATH)): Kanal[] {
  return KanalFileSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).kanal;
}

let cached: readonly Kanal[] | undefined;
function defaultKanal(): readonly Kanal[] {
  if (!cached) {
    try {
      cached = loadKanal();
    } catch {
      cached = [];
    }
  }
  return cached;
}

/** Entri tampilan untuk satu layanan; tautan/tanggal dihilangkan bila belum terverifikasi. */
export function kanalFor(id: string, kanal: readonly Kanal[] = defaultKanal()): KanalResmi | undefined {
  const k = kanal.find((x) => x.id === id);
  if (!k) return undefined;
  const base = { layanan: k.layanan, instansi: k.instansi, deskripsi: k.deskripsi };
  return k.verifiedAt ? { ...base, url: k.url, verifiedAt: k.verifiedAt } : base;
}

export const KONTAK_PATH = new URL('../../../data/wilayah/kontak-dukcapil.json', import.meta.url);

export const KontakSchema = z.discriminatedUnion('status', [
  z.object({
    kode: z.string().regex(/^\d{4}$/),
    nama: z.string().min(1),
    status: z.literal('terverifikasi'),
    website: z.string().refine(isAllowedUrl),
    judulHalaman: z.string(),
    alamat: z.string().optional(),
    sourceUrl: z.string().refine(isAllowedUrl),
    verifiedAt: z.iso.datetime(),
  }),
  z.object({
    kode: z.string().regex(/^\d{4}$/),
    nama: z.string().min(1),
    status: z.literal('belum_terverifikasi'),
  }),
]);
export type KontakEntry = z.infer<typeof KontakSchema>;

/** Kontak Disdukcapil yang tampil ke agen; hanya yang terverifikasi dari halaman resmi. */
export type KontakDukcapil = {
  nama: string;
  website: string;
  alamat?: string;
  sourceUrl: string;
  verifiedAt: string;
};

export function loadKontak(path: string = fileURLToPath(KONTAK_PATH)): KontakEntry[] {
  return z.object({ kontak: z.array(KontakSchema) }).parse(JSON.parse(readFileSync(path, 'utf8'))).kontak;
}

let cachedKontak: readonly KontakEntry[] | undefined;
function defaultKontak(): readonly KontakEntry[] {
  if (!cachedKontak) {
    try {
      cachedKontak = loadKontak();
    } catch {
      cachedKontak = [];
    }
  }
  return cachedKontak;
}

/** Kontak Disdukcapil untuk kab/kota; undefined bila belum terverifikasi (jangan mengarang). */
export function kontakFor(
  kode: string,
  kontak: readonly KontakEntry[] = defaultKontak(),
): KontakDukcapil | undefined {
  const k = kontak.find((x) => x.kode === kode);
  if (!k || k.status !== 'terverifikasi') return undefined;
  return {
    nama: k.nama,
    website: k.website,
    ...(k.alamat ? { alamat: k.alamat } : {}),
    sourceUrl: k.sourceUrl,
    verifiedAt: k.verifiedAt,
  };
}
