/** Penyimpanan sesi di memori. Hanya data fiktif; hilang saat proses berhenti. */

export type Service = { id: number; name: string; requirements: string[] };

export const SERVICES: readonly Service[] = [
  { id: 1, name: 'Layanan Contoh A', requirements: ['Berkas contoh 1', 'Berkas contoh 2'] },
  { id: 2, name: 'Layanan Contoh B', requirements: ['Berkas contoh 3'] },
  // Id sama dengan portal asli (pendaftaran/uploadberkas/23) agar alur demo juri memakai parameter yang sama.
  {
    id: 23,
    name: 'Akta Kelahiran (replika uji)',
    requirements: ['Kartu Keluarga (KK) Orang Tua', 'KTP orang tua', 'Surat keterangan kelahiran'],
  },
  // Layanan KTP-el dengan id portal asli (8 baru, 9 perubahan data, 10 hilang, 11 rusak): demo cetak ulang KTP-el.
  { id: 8, name: 'KTP Baru (replika uji)', requirements: ['Fotokopi Kartu Keluarga terbaru'] },
  {
    id: 9,
    name: 'KTP Perubahan Data (replika uji)',
    requirements: ['Fotokopi Kartu Keluarga terbaru', 'KTP-el lama', 'Data dukung perubahan data'],
  },
  {
    id: 10,
    name: 'KTP Hilang (replika uji)',
    requirements: ['Fotokopi Kartu Keluarga terbaru', 'Surat kehilangan dari kepolisian'],
  },
  {
    id: 11,
    name: 'KTP Rusak (replika uji)',
    requirements: ['Fotokopi Kartu Keluarga terbaru', 'KTP-el yang rusak'],
  },
];

export type Application = { no: number; layanan: string; tanggal: string; status: string };

/** Nomor registrasi fiktif yang tampil di Daftar Permohonan (dibaca adapter sebagai bukti). */
export const nomorRegistrasi = (no: number) => `FX-REG-${String(no).padStart(4, '0')}`;

export type Session = {
  uploads: Map<number, { name: string; size: number }[]>;
  applications: Application[];
};

export function createStore() {
  const sessions = new Map<string, Session>();
  return {
    create(): string {
      const id = crypto.randomUUID();
      sessions.set(id, {
        uploads: new Map(),
        // Baris awal tetap supaya tes status-read deterministik.
        applications: [
          { no: 1, layanan: 'Layanan Contoh A', tanggal: '2026-01-02', status: 'Diproses (data uji)' },
        ],
      });
      return id;
    },
    get(id: string | undefined): Session | undefined {
      return id ? sessions.get(id) : undefined;
    },
    delete(id: string | undefined): void {
      if (id) sessions.delete(id);
    },
  };
}
