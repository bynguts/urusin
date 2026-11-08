import type { KeadaanKapabilitas, StoreKapabilitas } from '#lib/contracts.js';

type KemampuanServer = Partial<Pick<KeadaanKapabilitas, 'ai' | 'vision' | 'rag'>>;

/**
 * Kemampuan server dari `/api/kemampuan` (publik; /api/health 404 di balik Caddy). Sebelum dimuat, saat runtime
 * masih dirakit (503) atau saat gagal: anggap normal, jangan menyembunyikan fitur.
 */
export class CapabilitiesStore implements StoreKapabilitas {
  keadaan = $state<KeadaanKapabilitas>({ ai: 'normal', vision: true, rag: 'tidak_diketahui', dimuat: false });

  constructor(private readonly ambil: typeof fetch = (...a) => fetch(...a)) {}

  async muat(): Promise<void> {
    try {
      const res = await this.ambil('/api/kemampuan', { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const j = (await res.json()) as { kapabilitas?: KemampuanServer };
      const k = j.kapabilitas;
      this.keadaan = {
        ai: k?.ai ?? 'normal',
        vision: k?.vision ?? true,
        rag: k?.rag ?? 'tidak_diketahui',
        dimuat: true,
      };
    } catch {
      // offline: pertahankan keadaan sebelumnya
    }
  }
}
