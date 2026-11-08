/** Penyimpanan sesi di memori. Hanya data fiktif; hilang saat proses berhenti. */

export type Service = { id: number; name: string; requirements: string[] };

export const SERVICES: readonly Service[] = [
  { id: 1, name: 'Layanan Contoh A', requirements: ['Berkas contoh 1', 'Berkas contoh 2'] },
  { id: 2, name: 'Layanan Contoh B', requirements: ['Berkas contoh 3'] },
];

export type Application = { no: number; layanan: string; tanggal: string; status: string };

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
