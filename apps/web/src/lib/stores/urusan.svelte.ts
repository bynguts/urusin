import type { KeadaanUrusan, StoreUrusan, UrusinEvent } from '#lib/contracts.js';
import { keadaanAwal, mulaiTurnBaru, terapkanEvent } from './reduksi.js';

/** Tipe event SSE yang didengarkan; `heartbeat` ikut agar koneksi yang hidup terdeteksi. */
const TIPE = [
  'progress',
  'assistant_text',
  'grounded_answer',
  'handoff',
  'plan_card',
  'wilayah',
  'checklist',
  'eligibility',
  'execution_request',
  'gate',
  'state',
  'degraded',
  'error',
  'timeout',
  'heartbeat',
  'done',
  'policy_gate',
] as const;

/** Bagian EventSource yang dipakai; memudahkan tes dan pemutar fixture. */
export type SumberEvent = {
  addEventListener(type: string, fn: (e: { data: string }) => void): void;
  close(): void;
  onerror: ((e: unknown) => void) | null;
  readyState: number;
};
export type PabrikSumber = (url: string) => SumberEvent;

const CLOSED = 2;
const JEDA_ULANG_MS = [1000, 2000, 4000, 8000, 15000];

/**
 * Store urusan: event SSE → state turunan, dengan sambung ulang dan resume `Last-Event-ID`
 * (`?lastEventId=` karena EventSource baru tidak mewarisi id lama). UI hanya membaca `keadaan` dan memanggil method.
 */
export class UrusanStore implements StoreUrusan {
  keadaan = $state<KeadaanUrusan>(keadaanAwal());

  private sumber: SumberEvent | null = null;
  private percobaan = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly pabrik: PabrikSumber = (url) => new EventSource(url) as unknown as SumberEvent,
    private readonly ambil: typeof fetch = (...a) => fetch(...a),
  ) {}

  sambung(id: string): void {
    this.putus();
    if (this.keadaan.id !== id) this.keadaan = { ...keadaanAwal(), id };
    this.keadaan.status = 'menghubungkan';
    this.buka(id);
  }

  private buka(id: string): void {
    const url = `/api/urusan/${encodeURIComponent(id)}/stream?lastEventId=${this.keadaan.lastSeq}`;
    const es = this.pabrik(url);
    this.sumber = es;
    for (const tipe of TIPE) {
      es.addEventListener(tipe, (m) => {
        this.percobaan = 0;
        this.keadaan.status = 'tersambung';
        try {
          this.terapkan(JSON.parse(m.data) as UrusinEvent);
        } catch {
          // frame rusak diabaikan; sumber kebenaran tetap tabel events di server
        }
      });
    }
    es.onerror = () => {
      // EventSource menyambung ulang sendiri selama CLOSED belum terjadi; bila server menutup (CLOSED), kita ulang manual.
      if (es.readyState !== CLOSED || this.sumber !== es) return;
      this.keadaan.status = 'terputus';
      const jeda = JEDA_ULANG_MS[Math.min(this.percobaan++, JEDA_ULANG_MS.length - 1)]!;
      this.timer = setTimeout(() => this.keadaan.id && this.buka(this.keadaan.id), jeda);
    };
  }

  putus(): void {
    clearTimeout(this.timer);
    this.sumber?.close();
    this.sumber = null;
    if (this.keadaan.status !== 'diam') this.keadaan.status = 'diam';
  }

  terapkan(e: UrusinEvent): void {
    this.keadaan = terapkanEvent(this.keadaan, e);
  }

  reset(): void {
    this.putus();
    this.keadaan = keadaanAwal();
  }

  async buat(opsi: { kodeKabKota?: string; pesan?: string } = {}): Promise<string | null> {
    try {
      const res = await this.ambil('/api/urusan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(opsi),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { id: string };
      if (opsi.pesan) this.keadaan = mulaiTurnBaru({ ...keadaanAwal(), id: j.id });
      this.sambung(j.id);
      return j.id;
    } catch {
      return null;
    }
  }

  async kirim(teks: string): Promise<'ok' | 'konflik' | 'galat'> {
    const id = this.keadaan.id;
    if (!id) return 'galat';
    try {
      let res = await this.kirimTurn(id, teks);
      if (res.status === 409) {
        // Versi basi (klaim turn menaikkan versi tanpa event state) atau turn masih berjalan: ambil status terbaru.
        const st = await this.statusTerbaru(id);
        if (!st || st.berjalan) return st ? 'konflik' : 'galat';
        this.keadaan.version = st.version;
        res = await this.kirimTurn(id, teks);
        if (res.status === 409) return 'konflik';
      }
      if (!res.ok) return 'galat';
      // Turn cepat bisa selesai (event `done` sudah tiba lewat stream) sebelum respons 202 ini sampai: jangan
      // menghapus hasilnya dan menandai berjalan lagi, nanti UI menunggu selamanya.
      const j = (await res.json().catch(() => null)) as { turnId?: unknown } | null;
      const sudahSelesai =
        typeof j?.turnId === 'string' &&
        this.keadaan.events.some((e) => e.type === 'done' && e.turnId === j.turnId);
      if (!sudahSelesai) this.keadaan = mulaiTurnBaru(this.keadaan);
      if (this.keadaan.status === 'diam' || this.keadaan.status === 'terputus') this.sambung(id);
      return 'ok';
    } catch {
      return 'galat';
    }
  }

  /**
   * "Setujui rencana": aksi terstruktur (bukan pesan chat yang ditafsirkan model). Hasilnya (state, permintaan
   * Browser Pendamping, kartu konfirmasi) mengalir lewat stream.
   */
  setujuiRencana(): Promise<'ok' | 'konflik' | 'galat'> {
    return this.aksi('rencana/setujui', {});
  }

  /**
   * "Ya, betul" di kartu wilayah: warga memastikan kab/kota KTP (aksi terstruktur). Bila jenis urusan sudah
   * diketahui, rencana untuk wilayah itu menyusul lewat stream.
   */
  tetapkanWilayah(kodeKabKota: string): Promise<'ok' | 'konflik' | 'galat'> {
    // Tanpa versi dan tanpa kirim ulang otomatis: server hanya menetapkan bila belum ada wilayah KTP (wilayah
    // lain yang sudah dipastikan → 409), jadi kartu basi tidak pernah menimpa pilihan warga.
    return this.aksi('wilayah', { kodeKabKota }, { versi: false, ulang: false });
  }

  /**
   * Aksi terstruktur POST /api/urusan/[id]/<jalur>, bawaannya dengan versi terbaru; 409 → ambil status lalu coba
   * sekali lagi (kecuali `ulang: false`).
   */
  private async aksi(
    jalur: string,
    isi: Record<string, unknown>,
    opsi: { versi: boolean; ulang: boolean } = { versi: true, ulang: true },
  ): Promise<'ok' | 'konflik' | 'galat'> {
    const id = this.keadaan.id;
    if (!id) return 'galat';
    const kirim = () =>
      this.ambil(`/api/urusan/${encodeURIComponent(id)}/${jalur}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(opsi.versi ? { ...isi, expectedVersion: this.keadaan.version } : isi),
      });
    try {
      let res = await kirim();
      if (res.status === 409 && !opsi.ulang) return 'konflik';
      if (res.status === 409) {
        const st = await this.statusTerbaru(id);
        if (!st || st.berjalan) return st ? 'konflik' : 'galat';
        this.keadaan.version = st.version;
        res = await kirim();
        if (res.status === 409) return 'konflik';
      }
      if (!res.ok) return 'galat';
      // Versi baru langsung dari respons (event `state` di stream membawa versi yang sama), agar pesan
      // berikutnya tidak memakai versi basi dan memicu 409.
      const j = (await res.json().catch(() => null)) as { version?: unknown; turnId?: unknown } | null;
      if (typeof j?.version === 'number' && j.version > this.keadaan.version)
        this.keadaan.version = j.version;
      // Aksi yang melanjutkan giliran agen (mis. "Ya, betul" tanpa rencana): tandai berjalan kecuali sudah selesai.
      if (
        typeof j?.turnId === 'string' &&
        !this.keadaan.events.some((e) => e.type === 'done' && e.turnId === j.turnId)
      )
        this.keadaan = mulaiTurnBaru(this.keadaan);
      if (this.keadaan.status === 'diam' || this.keadaan.status === 'terputus') this.sambung(id);
      return 'ok';
    } catch {
      return 'galat';
    }
  }

  private kirimTurn(id: string, teks: string): Promise<Response> {
    return this.ambil(`/api/urusan/${encodeURIComponent(id)}/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teks, expectedVersion: this.keadaan.version }),
    });
  }

  private async statusTerbaru(id: string): Promise<{ version: number; berjalan: boolean } | null> {
    const res = await this.ambil(`/api/urusan/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const j = (await res.json()) as { version?: unknown; berjalan?: unknown };
    return typeof j.version === 'number' && typeof j.berjalan === 'boolean'
      ? { version: j.version, berjalan: j.berjalan }
      : null;
  }
}
