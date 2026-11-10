import { RegistryError } from './errors.js';
import { CityEntrySchema, type CityEntry } from './schema.js';
import { SEED_ENTRIES } from './seed.js';
import { NAMA_WILAYAH, kontakDukcapil } from './wilayah.js';

export type Route = {
  kodeKabKota: string;
  entry: CityEntry;
  /** false = tidak ada entri eksplisit, memakai default dipandu. */
  terdaftar: boolean;
};

export type RouterOptions = {
  entries?: readonly CityEntry[];
  /** kode 4 digit -> nama resmi (dari data/wilayah/kabkota.json); opsional. */
  namaWilayah?: ReadonlyMap<string, string>;
};

/** Ambil kode kab/kota dari NIK. Hanya digit 1-4 yang dikembalikan; NIK tidak disimpan. */
export function kodeFromNik(nik: string): string {
  if (typeof nik !== 'string' || !/^\d{16}$/.test(nik)) throw new RegistryError('NIK_INVALID');
  return nik.slice(0, 4);
}

export function createRouter(opts: RouterOptions = {}) {
  const entries = (opts.entries ?? SEED_ENTRIES).map((e) => CityEntrySchema.parse(e));
  const byKode = new Map(entries.map((e) => [e.kodeKabKota, e]));
  if (byKode.size !== entries.length) throw new Error('Registry memuat kode kab/kota ganda.');

  function routeByKode(kode: string): Route {
    if (typeof kode !== 'string' || !/^\d{4}$/.test(kode)) throw new RegistryError('KODE_INVALID');
    const found = byKode.get(kode);
    if (found) return { kodeKabKota: kode, entry: found, terdaftar: true };
    const nama = opts.namaWilayah?.get(kode) ?? `Kab/Kota ${kode}`;
    // Situs Disdukcapil terverifikasi (kontak-dukcapil.json) menjadi kanal resmi kota tanpa entri khusus.
    const kontak = kontakDukcapil(kode);
    return {
      kodeKabKota: kode,
      terdaftar: false,
      entry: {
        kodeKabKota: kode,
        nama,
        tier: 'dipandu',
        validasi: 'tidak-ada-portal',
        sourceRef: kontak
          ? [
              {
                url: kontak.website.endsWith('/') ? kontak.website : `${kontak.website}/`,
                judul: `Situs Disdukcapil ${nama}`,
                instansi: `Dinas Kependudukan dan Pencatatan Sipil ${nama}`,
              },
            ]
          : [],
        verifiedAt: null,
        catatan: 'Belum ada entri khusus; gunakan langkah dipandu dari korpus nasional dan kanal resmi.',
      },
    };
  }

  function routeByNik(nik: string): Route {
    return routeByKode(kodeFromNik(nik));
  }

  return { routeByKode, routeByNik, entries };
}

/** Router default: seed + nama resmi 514 kab/kota (kode di luar seed tetap bernama benar, bukan "Kab/Kota XXXX"). */
const defaultRouter = createRouter({ namaWilayah: NAMA_WILAYAH });
export const routeByNik = defaultRouter.routeByNik;
export const routeByKode = defaultRouter.routeByKode;
