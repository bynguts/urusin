import { daftarWrite, labelPlaceholder } from './isi-data.js';
import type {
  KoneksiViewer,
  PabrikViewer,
  PendampingBukti,
  PendampingEvent,
  PendampingMode,
  SesiPendamping,
  ViewerPendamping,
} from './tipe.js';

/** Keadaan layar Browser Pendamping (papan "Browser Pendamping · Keadaan", 11 keadaan). */
export type KeadaanLayar =
  | 'mati'
  | 'antre'
  | 'menyiapkan'
  | 'ai'
  | 'giliran'
  | 'dijeda'
  | 'selesai'
  | 'kedaluwarsa'
  | 'terputus'
  | 'dipandu'
  | 'galat'
  | 'tidak_tersedia';

export type GiliranAnda = Extract<PendampingEvent, { jenis: 'giliran_anda' }>;

export type DataPendamping = {
  keadaan: KeadaanLayar;
  mode: PendampingMode | null;
  antrean: { posisi: number; panjang: number } | null;
  giliran: GiliranAnda | null;
  langkah: { indeks: number; total: number; label: string } | null;
  pesan: string | null;
  bukti: PendampingBukti | null;
  koneksi: KoneksiViewer | null;
  butuhData: { placeholder: string[]; berkas: string[]; origin?: string | undefined } | null;
};

export function dataAwal(): DataPendamping {
  return {
    keadaan: 'mati',
    mode: null,
    antrean: null,
    giliran: null,
    langkah: null,
    pesan: null,
    bukti: null,
    koneksi: null,
    butuhData: null,
  };
}

/** Status sesi server → keadaan layar. */
export function keadaanDariSesi(s: Pick<SesiPendamping, 'status' | 'mode'>, giliran: boolean): KeadaanLayar {
  switch (s.status) {
    case 'antre':
      return 'antre';
    case 'memulai':
    case 'menunggu_data':
      return 'menyiapkan';
    case 'berjalan':
    case 'siaga':
      if (s.mode === 'takeover') return giliran ? 'giliran' : 'dijeda';
      return 'ai';
    case 'selesai':
      return 'selesai';
    case 'dipandu':
      return 'dipandu';
    case 'kedaluwarsa':
      return 'kedaluwarsa';
    case 'gagal':
      return 'galat';
    case 'dibatalkan':
      return 'mati';
  }
}

type Ambil = typeof fetch;

/**
 * Pengendali sesi Browser Pendamping untuk satu urusan: memulai sesi (POST /pendamping), menyambungkan viewer
 * lewat tiket sekali pakai, dan menerjemahkan pesan viewer menjadi `data` reaktif untuk layar.
 */
export class SesiPendampingUi {
  data = $state<DataPendamping>(dataAwal());
  private viewer: ViewerPendamping | null = null;
  private lepas: (() => void)[] = [];

  constructor(
    private readonly urusanId: string,
    private readonly pabrik: () => Promise<PabrikViewer | null>,
    private readonly ambil: Ambil = (...a) => fetch(...a),
  ) {}

  private get dasar() {
    return `/api/urusan/${encodeURIComponent(this.urusanId)}/pendamping`;
  }

  /** Mulai sesi untuk `executionId` yang sudah disetujui warga, lalu sambungkan layar ke canvas. */
  async mulai(
    executionId: string,
    canvas: () => HTMLCanvasElement | null,
    inputTeks: () => HTMLTextAreaElement | null,
  ) {
    this.data = { ...dataAwal(), keadaan: 'menyiapkan' };
    const pabrik = await this.pabrik();
    let res: Response;
    try {
      res = await this.ambil(this.dasar, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ executionId, viewport: viewportPerangkat() }),
      });
    } catch {
      this.data = { ...this.data, keadaan: 'terputus', pesan: 'Koneksi terputus. Periksa internet Anda.' };
      return;
    }
    if (res.status === 404 || !pabrik) {
      this.data = {
        ...this.data,
        keadaan: 'tidak_tersedia',
        pesan:
          'Browser Pendamping belum aktif di server ini. Ikuti panduan untuk mengisi sendiri di situs resmi.',
      };
      return;
    }
    const j = (await res.json().catch(() => null)) as (SesiPendamping & { pesanWarga?: string }) | null;
    if (!res.ok || !j) {
      this.data = {
        ...this.data,
        keadaan: 'galat',
        pesan: j?.pesanWarga ?? 'Browser Pendamping tidak bisa dibuka sekarang. Coba lagi sebentar lagi.',
      };
      return;
    }
    this.terapkanSesi(j);
    const tiket = await this.tiket();
    const c = canvas();
    if (!tiket || !c) return;
    this.sambung(pabrik, c, tiket.wsUrl, inputTeks() ?? undefined);
  }

  private async tiket(): Promise<{ wsUrl: string; tiket: string } | null> {
    try {
      const r = await this.ambil(`${this.dasar}/tiket`, { method: 'POST' });
      if (!r.ok) return null;
      return (await r.json()) as { wsUrl: string; tiket: string };
    } catch {
      return null;
    }
  }

  private sambung(
    pabrik: PabrikViewer,
    canvas: HTMLCanvasElement,
    wsUrl: string,
    inputTeks?: HTMLTextAreaElement,
  ) {
    this.tutup();
    const v = pabrik(canvas, wsUrl, {
      tiket: async () => (await this.tiket())?.tiket ?? '',
      inputTeks,
    });
    this.viewer = v;
    this.lepas = [
      v.on('status', (s) => this.terapkanSesi(s)),
      v.on('mode', ({ mode, pesan }) => {
        const giliran = mode === 'takeover' ? this.data.giliran : null;
        this.data = {
          ...this.data,
          mode,
          giliran,
          keadaan:
            mode === 'done'
              ? this.data.keadaan
              : mode === 'takeover'
                ? giliran
                  ? 'giliran'
                  : 'dijeda'
                : 'ai',
          pesan: pesan ?? this.data.pesan,
        };
      }),
      v.on('event', (e) => this.terapkanEvent(e)),
      v.on('butuh_data', (b) => (this.data = { ...this.data, butuhData: b })),
      v.on('galat', (g) => (this.data = { ...this.data, pesan: g.pesanWarga })),
      v.on('koneksi', (k) => {
        const keadaan =
          k === 'putus' ? 'terputus' : this.data.keadaan === 'terputus' ? 'ai' : this.data.keadaan;
        this.data = { ...this.data, koneksi: k, keadaan };
      }),
    ];
  }

  terapkanSesi(s: SesiPendamping): void {
    this.data = {
      ...this.data,
      mode: s.mode,
      antrean: s.antrean,
      keadaan: keadaanDariSesi(s, this.data.giliran !== null),
      pesan: s.pesan ?? this.data.pesan,
      bukti: s.bukti ?? this.data.bukti,
    };
  }

  terapkanEvent(e: PendampingEvent): void {
    switch (e.jenis) {
      case 'langkah':
        this.data = { ...this.data, langkah: { indeks: e.indeks, total: e.total, label: e.label } };
        return;
      case 'giliran_anda':
        this.data = {
          ...this.data,
          giliran: e.alasan === 'diminta_warga' ? null : e,
          keadaan: e.alasan === 'diminta_warga' ? 'dijeda' : 'giliran',
          pesan: e.pesan,
        };
        return;
      case 'dipandu':
        this.data = { ...this.data, keadaan: 'dipandu', pesan: e.pesan };
        return;
      case 'selesai':
        this.data = {
          ...this.data,
          keadaan: e.hasil === 'berhasil' ? 'selesai' : e.hasil === 'drift' ? 'dipandu' : 'galat',
          pesan: e.pesan,
          bukti: e.bukti ?? this.data.bukti,
          giliran: null,
        };
        return;
      case 'diblokir':
        return;
    }
  }

  ambilAlih(): void {
    this.viewer?.ambilAlih();
  }

  kembalikan(): void {
    this.data = { ...this.data, giliran: null };
    this.viewer?.kembalikan();
  }

  /**
   * "Izinkan isi" (A-M1): kirim HANYA daftar write yang ditampilkan di lembar + origin tujuan dari
   * `butuh_data` (POST /api/urusan/[id]/izinkan-isi). Server menyimpan persetujuan, lalu mengambil nilai Data
   * Diri/Dokumen dan mengirimnya ke sesi lewat kanal internal; peramban tidak pernah memegang nilainya.
   * Mengembalikan pesan untuk warga (yang harus diisi sendiri, atau galat), atau undefined bila lengkap.
   */
  async izinkanIsi(): Promise<string | undefined> {
    const butuh = this.data.butuhData;
    if (!butuh) return undefined;
    const writeList = daftarWrite(butuh.placeholder, butuh.berkas);
    if (writeList.length === 0) {
      const sendiri = [...new Set(butuh.placeholder.map(labelPlaceholder))];
      return `Isi sendiri di layar: ${sendiri.join(', ')}.`;
    }
    if (!butuh.origin) return 'Situs tujuan belum diketahui. Isi sendiri di layar.';
    let res: Response;
    try {
      res = await this.ambil(`/api/urusan/${encodeURIComponent(this.urusanId)}/izinkan-isi`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ writeList, targetOrigin: butuh.origin }),
      });
    } catch {
      return 'Koneksi terputus. Coba lagi atau isi sendiri.';
    }
    const j = (await res.json().catch(() => null)) as { pesanWarga?: string; kurang?: string[] } | null;
    if (!res.ok) return j?.pesanWarga ?? 'Izin belum tercatat. Coba lagi atau isi sendiri.';
    const kurang = j?.kurang ?? [];
    if (kurang.length === 0) this.data = { ...this.data, butuhData: null };
    return kurang.length ? `Isi sendiri di layar: ${kurang.join(', ')}.` : undefined;
  }

  /** Hentikan: browser server dihancurkan, tidak ada yang tersimpan. */
  async hentikan(): Promise<void> {
    this.viewer?.akhiri();
    try {
      await this.ambil(this.dasar, { method: 'DELETE' });
    } catch {
      // sesi tetap kedaluwarsa sendiri di server
    }
    this.tutup();
    this.data = { ...dataAwal() };
  }

  tutup(): void {
    for (const f of this.lepas) f();
    this.lepas = [];
    this.viewer?.tutup();
    this.viewer = null;
  }
}

function viewportPerangkat() {
  if (typeof window === 'undefined') return undefined;
  const lebar = Math.min(1280, Math.max(320, Math.round(window.innerWidth)));
  const tinggi = Math.min(1600, Math.max(480, Math.round(window.innerHeight)));
  return {
    lebar,
    tinggi,
    dpr: Math.min(4, Math.max(1, window.devicePixelRatio || 1)),
    seluler: lebar < 768,
  };
}
