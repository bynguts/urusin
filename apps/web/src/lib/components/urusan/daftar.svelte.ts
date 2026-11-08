import type { DaftarUrusanResponse, RingkasanUrusan } from '#lib/contracts.js';
import type { CatatanUrusan } from '#lib/stores/lokal.svelte.js';

export type UrusanBerjalan = CatatanUrusan & { ringkasan: RingkasanUrusan | null };

/**
 * Status terbaru urusan yang tercatat di perangkat ini (GET /api/urusan?ids=). Id yang tidak dikenal server
 * tetap tampil dengan ringkasan null (mis. server baru dipasang ulang).
 */
export class DaftarUrusan {
  isi = $state<UrusanBerjalan[]>([]);
  memuat = $state(false);
  galat = $state(false);

  constructor(private readonly ambil: typeof fetch = (...a) => fetch(...a)) {}

  async muat(catatan: readonly CatatanUrusan[]): Promise<void> {
    this.isi = catatan.map((c) => ({ ...c, ringkasan: null }));
    if (!catatan.length) return;
    this.memuat = true;
    this.galat = false;
    try {
      const ids = catatan.map((c) => c.id).join(',');
      const res = await this.ambil(`/api/urusan?ids=${encodeURIComponent(ids)}`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as DaftarUrusanResponse;
      const peta = Object.fromEntries(j.urusan.map((u) => [u.id, u]));
      this.isi = catatan.map((c) => ({ ...c, ringkasan: peta[c.id] ?? null }));
    } catch {
      this.galat = true;
    } finally {
      this.memuat = false;
    }
  }
}
