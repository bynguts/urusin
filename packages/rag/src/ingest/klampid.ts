import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * Adapter katalog layanan publik Klampid New Generation (Dispendukcapil Surabaya). Endpoint GraphQL
 * publik menerima GET tanpa login; yang dibaca hanya nama, kategori, deskripsi dan judul panduan
 * (tanpa data pribadi). Hasil mentah tidak dipercaya: disanitasi sebelum jadi chunk.
 */
export const KLAMPID_QUERY =
  '{allPublicFrontServices{_id name description category visibilityStatus availabilityStatus guides{index title description attachmentUrl}}}';

export function klampidEndpoint(sourceUrl: string): string {
  const u = new URL('/new-api', sourceUrl);
  u.searchParams.set('query', KLAMPID_QUERY);
  return u.toString();
}

const ServiceSchema = z.object({
  _id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  visibilityStatus: z.string().nullish(),
  availabilityStatus: z.string().nullish(),
  guides: z.array(z.object({ title: z.string().nullish() })).nullish(),
});
const ResponseSchema = z.object({ data: z.object({ allPublicFrontServices: z.array(ServiceSchema) }) });

export type KlampidService = {
  id: string;
  name: string;
  category: string;
  description: string;
  guides: string[];
};

/** Kategori layanan warga yang dimasukkan ke korpus. */
export const KLAMPID_CATEGORIES: ReadonlySet<string> = new Set([
  'PENDAFTARAN PENDUDUK',
  'PENCATATAN SIPIL',
  'PEMUTAKHIRAN DATA PENDUDUK',
  'PELAYANAN UMUM',
]);

/** Baris uji/iseng yang ditemukan di katalog produksi (recon 2026-11-08). */
const DENYLIST = /\b(test|tes|tester|uji coba|lontong|kolak|dummy|contoh|puntadewa|kalimasada)\b/i;

const clean = (s: string | null | undefined, max: number) =>
  (s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** Parse + sanitasi: Tersedia/Dipublikasikan, allowlist kategori, buang baris uji, dedupe nama+kategori. */
export function sanitizeKlampid(json: unknown): KlampidService[] {
  const parsed = ResponseSchema.parse(json).data.allPublicFrontServices;
  const byKey = new Map<string, KlampidService>();
  for (const s of parsed) {
    if (s.availabilityStatus !== 'Tersedia' || s.visibilityStatus !== 'Dipublikasikan') continue;
    const category = clean(s.category, 80).toUpperCase();
    const name = clean(s.name, 120);
    if (!KLAMPID_CATEGORIES.has(category) || name.length < 3 || DENYLIST.test(name)) continue;
    const key = `${category}|${name.toLowerCase()}`;
    const guides = (s.guides ?? []).map((g) => clean(g.title, 120)).filter(Boolean);
    const prev = byKey.get(key);
    if (prev) {
      prev.guides = [...new Set([...prev.guides, ...guides])];
      continue;
    }
    byKey.set(key, { id: s._id, name, category, description: clean(s.description, 400), guides });
  }
  return [...byKey.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
}

const titleCase = (t: string) =>
  t.toLowerCase().replace(/(^|\s)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());

/** Satu chunk per layanan; teks tampil dan header konteks dibuat oleh pemanggil. */
const CAT_KEY: Record<string, string> = {
  'PENDAFTARAN PENDUDUK': 'daftar',
  'PENCATATAN SIPIL': 'sipil',
  'PEMUTAKHIRAN DATA PENDUDUK': 'mutakhir',
  'PELAYANAN UMUM': 'umum',
};

/** Kunci chunk stabil (tidak bergantung urutan katalog): kategori-nama-layanan. */
export function klampidKey(s: KlampidService): string {
  const slug = s.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${CAT_KEY[s.category] ?? 'lain'}-${slug}`.slice(0, 80);
}

export function klampidChunkText(s: KlampidService): { heading: string; text: string } {
  const desc =
    s.description && s.description.toLowerCase() !== s.name.toLowerCase() ? ` ${s.description}.` : '';
  const guide = s.guides.length ? ` Panduan resmi tersedia: ${s.guides.join('; ')}.` : '';
  return {
    heading: s.name,
    text: `Layanan ${s.name} tersedia di Klampid New Generation Dispendukcapil Kota Surabaya, kategori ${titleCase(s.category)}.${desc}${guide}`,
  };
}

/** Hash stabil atas hasil sanitasi (dipakai rag:verify; tidak peka urutan/ID baris yang tidak dipakai). */
export function klampidHash(services: readonly KlampidService[]): string {
  return createHash('sha256')
    .update(JSON.stringify(services.map((s) => [s.category, s.name, s.description, s.guides])))
    .digest('hex');
}
