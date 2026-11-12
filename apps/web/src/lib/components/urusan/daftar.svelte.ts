import type { DaftarUrusanResponse, RingkasanUrusan } from '#lib/contracts.js';
import type { CatatanUrusan } from '#lib/stores/lokal.svelte.js';

export type UrusanBerjalan = CatatanUrusan & {
  ringkasan: RingkasanUrusan | null;
  /**
   * Server menjawab, tetapi urusan ini tidak ada untuk akun/sesi sekarang (mis. salinan demo juri lama yang
   * sudah dihapus setelah 24 jam, atau urusan akun lain di perangkat yang sama).
   */
  hilang?: true;
};

/**
 * Status terbaru urusan yang tercatat di perangkat ini (GET /api/urusan?ids=). Id yang tidak dikenal server
 * tetap tampil dengan ringkasan null (mis. server baru dipasang ulang).
 */
export class DaftarUrusan {
  isi = $state<UrusanBerjalan[]>([]);
  memuat = $state(false);
  galat = $state(false);
  private urutan = 0;
  /** Judul server (AI atau nama pilihan warga) per urusan; halaman meneruskannya ke catatan perangkat (sidebar). */
  onjudul?: (id: string, judul: string) => void;

  constructor(
    private readonly ambil: typeof fetch = (...a) => fetch(...a),
    /** Batas tunggu status: permintaan yang menggantung berakhir sebagai galat (ada "Coba lagi"), bukan memuat terus. */
    private readonly batasMs = 15_000,
  ) {}

  async muat(catatan: readonly CatatanUrusan[]): Promise<void> {
    const urutan = ++this.urutan;
    this.isi = catatan.map((c) => ({ ...c, ringkasan: null }));
    this.galat = false;
    this.memuat = catatan.length > 0;
    if (!catatan.length) return;
    try {
      const ids = catatan.map((c) => c.id).join(',');
      const res = await this.ambil(`/api/urusan?ids=${encodeURIComponent(ids)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.batasMs),
      });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as DaftarUrusanResponse;
      if (urutan !== this.urutan) return;
      const peta = Object.fromEntries(j.urusan.map((u) => [u.id, u]));
      this.isi = catatan.map((c) =>
        peta[c.id] ? { ...c, ringkasan: peta[c.id]! } : { ...c, ringkasan: null, hilang: true as const },
      );
      for (const u of j.urusan) if (u.judul) this.onjudul?.(u.id, u.judul);
    } catch {
      if (urutan === this.urutan) this.galat = true;
    } finally {
      if (urutan === this.urutan) this.memuat = false;
    }
  }
}
