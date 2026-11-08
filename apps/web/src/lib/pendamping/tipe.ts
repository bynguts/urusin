/**
 * Tipe Browser Pendamping untuk UI, disalin secara struktural dari `@urusin/contracts` (pendamping.ts) dan
 * `@urusin/pendamping-client` di branch feat/browser-pendamping. Setelah branch itu masuk ke main, ganti isi
 * berkas ini dengan `export type { ... } from '@urusin/contracts'` dan tipe viewer dari paket klien.
 */
export type PendampingMode = 'ai' | 'takeover' | 'done';

export type PendampingStatus =
  | 'antre'
  | 'memulai'
  | 'menunggu_data'
  | 'berjalan'
  | 'siaga'
  | 'selesai'
  | 'gagal'
  | 'dipandu'
  | 'kedaluwarsa'
  | 'dibatalkan';

export type PendampingHasil = 'berhasil' | 'gagal' | 'dibatalkan' | 'drift';

export type PendampingBukti = { nomor?: string | undefined; status?: string | undefined };

export type SesiPendamping = {
  sesiId: string;
  urusanId: string;
  executionId: string;
  status: PendampingStatus;
  mode: PendampingMode | null;
  antrean: { posisi: number; panjang: number } | null;
  dibuatPada: string;
  kedaluwarsaPada: string;
  pesan?: string | undefined;
  hasil?: PendampingHasil | undefined;
  bukti?: PendampingBukti | undefined;
};

export type AlasanGiliran =
  'login' | 'final' | 'diminta_warga' | 'periksa' | 'masuk_akun' | 'verifikasi_situs';

export type PendampingEvent =
  | { jenis: 'langkah'; indeks: number; total: number; label: string }
  | {
      jenis: 'giliran_anda';
      alasan: AlasanGiliran;
      pesan: string;
      sorot?: { x: number; y: number; lebar: number; tinggi: number } | undefined;
    }
  | { jenis: 'dipandu'; pesan: string }
  | { jenis: 'diblokir'; host: string }
  | { jenis: 'selesai'; hasil: PendampingHasil; pesan: string; bukti?: PendampingBukti | undefined };

export type KoneksiViewer = 'menyambung' | 'tersambung' | 'putus' | 'selesai';

export type JenisFokus = 'tidak_ada' | 'teks' | 'sandi' | 'otp' | 'angka';

export type ViewerEvents = {
  mode: { mode: PendampingMode; pesan?: string | undefined };
  fokus: JenisFokus;
  event: PendampingEvent;
  status: SesiPendamping;
  butuh_data: { placeholder: string[]; berkas: string[] };
  galat: { kode: string; pesanWarga: string };
  koneksi: KoneksiViewer;
  frame: { lebar: number; tinggi: number };
};

/** Bagian `PendampingViewer` yang dipakai UI. */
export type ViewerPendamping = {
  readonly mode: PendampingMode | null;
  readonly koneksi: KoneksiViewer;
  on<K extends keyof ViewerEvents>(type: K, cb: (v: ViewerEvents[K]) => void): () => void;
  ambilAlih(): void;
  kembalikan(): void;
  akhiri(): void;
  kirimVault(isian: Record<string, string>): void;
  kirimBerkas(nama: string, berkas: Blob, namaBerkas?: string): Promise<void>;
  tutup(): void;
};

export type OpsiViewer = {
  tiket: () => Promise<string>;
  inputTeks?: HTMLInputElement | HTMLTextAreaElement | undefined;
};

/** `createPendampingViewer` dari `@urusin/pendamping-client`. */
export type PabrikViewer = (canvas: HTMLCanvasElement, wsUrl: string, opsi: OpsiViewer) => ViewerPendamping;
