import { daftarWrite, labelPlaceholder } from './isi-data.js';
import type {
  KolomButuh,
  KoneksiViewer,
  PabrikViewer,
  PendampingBukti,
  PendampingEvent,
  PendampingMode,
  SesiPendamping,
  ViewerPendamping,
} from './tipe.js';

/**
 * Keadaan layar Browser Pendamping (papan "Browser Pendamping · Keadaan", 11 keadaan) + `siaga`: langkah selesai,
 * peramban server MASIH hidup sebentar untuk langkah berikutnya (bukan "ditutup").
 */
export type KeadaanLayar =
  | 'mati'
  | 'antre'
  | 'menyiapkan'
  | 'ai'
  | 'giliran'
  | 'dijeda'
  | 'selesai'
  | 'siaga'
  | 'kedaluwarsa'
  | 'terputus'
  | 'dipandu'
  | 'galat'
  | 'tidak_tersedia';

/** Pesan bila "Tutup sekarang" gagal (ditampilkan di lembar siaga). */
export const PESAN_GAGAL_TUTUP = 'Browser belum bisa ditutup. Coba lagi; browser juga tutup sendiri.';

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
  butuhData: {
    placeholder: string[];
    berkas: string[];
    origin?: string | undefined;
    /** Navigator generik: baris lembar per kolom halaman ini (label portal = teks situs, tak tepercaya). */
    kolom?: KolomButuh[] | undefined;
    rencanaHash?: string | undefined;
  } | null;
  /** Situs yang benar-benar dibuka peramban + apakah itu replika uji (Mode Uji), dari status server. */
  situs: { origin: string; replika: boolean } | null;
  /**
   * Bingkai portal (atau replika Mode Uji) sudah tergambar di layar warga. Sebelum itu lembar "Izinkan AI mengisi?"
   * tidak dibuka: warga melihat situsnya dulu, baru izin isi diminta.
   */
  tayang: boolean;
  /** "Saya sudah mengirim": sedang diperiksa worker. */
  memeriksaKirim?: boolean;
  /** Jawaban jujur bila pengiriman belum terlihat (409) atau pemeriksaan gagal. */
  pesanKirim?: string | null;
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
    situs: null,
    tayang: false,
  };
}

/**
 * Status sesi server → keadaan layar. `menunggu_data` (izin isi diminta) sesudah portal tayang bukan "Menyiapkan":
 * situsnya tetap terlihat di balik lembar izin, AI menunggu izin untuk mengisi.
 */
export function keadaanDariSesi(
  s: Pick<SesiPendamping, 'status' | 'mode'>,
  giliran: boolean,
  tayang = false,
): KeadaanLayar {
  switch (s.status) {
    case 'antre':
      return 'antre';
    case 'memulai':
      return 'menyiapkan';
    case 'menunggu_data':
      if (!tayang) return 'menyiapkan';
      if (s.mode === 'takeover') return giliran ? 'giliran' : 'dijeda';
      return 'ai';
    case 'siaga':
      return 'siaga';
    case 'berjalan':
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

/** Jeda periksa ulang status server selama AI memegang kendali (lihat `jadwalPantauAi`). */
export const PANTAU_AI_MS = 15_000;

/**
 * Pengendali sesi Browser Pendamping untuk satu urusan: memulai sesi (POST /pendamping), menyambungkan viewer
 * lewat tiket sekali pakai, dan menerjemahkan pesan viewer menjadi `data` reaktif untuk layar.
 */
export class SesiPendampingUi {
  data = $state<DataPendamping>(dataAwal());
  private viewer: ViewerPendamping | null = null;
  private lepas: (() => void)[] = [];
  /** executionId yang hasilnya sudah disinkronkan ke server (GET status mencatat hasil + nomor permohonan). */
  private tersinkron: string | null = null;
  private executionId: string | null = null;
  private pantauAi: ReturnType<typeof setTimeout> | null = null;
  /** Status server terakhir: keadaan dihitung ulang saat bingkai portal pertama tergambar. */
  private statusServer: Pick<SesiPendamping, 'status' | 'mode'> | null = null;

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
    this.statusServer = null;
    this.executionId = executionId;
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
    // Tanpa tiket (mis. sesi sudah berakhir karena portal tidak terjangkau): baca status akhir dari server agar
    // layar menampilkan pesan dan jalur panduan, bukan "Menyiapkan" selamanya.
    if (!tiket) return this.statusAkhir();
    if (!c) return;
    this.sambung(pabrik, c, tiket.wsUrl, inputTeks() ?? undefined);
  }

  private async statusAkhir(): Promise<void> {
    const s = await this.ambil(this.dasar)
      .then((r) => (r.ok ? (r.json() as Promise<SesiPendamping>) : null))
      .catch(() => null);
    if (s?.status && s.status !== 'antre' && s.status !== 'memulai') return this.terapkanSesi(s);
    this.data = {
      ...this.data,
      keadaan: 'galat',
      pesan:
        s?.pesan ?? 'Browser Pendamping tidak bisa dibuka sekarang. Ikuti panduan untuk mengisi sendiri.',
    };
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
          // Event `selesai` lalu mode takeover (bukan done) = sesi siaga: peramban belum ditutup.
          keadaan:
            mode === 'done'
              ? this.data.keadaan
              : this.data.keadaan === 'selesai' || this.data.keadaan === 'siaga'
                ? 'siaga'
                : mode === 'takeover'
                  ? giliran
                    ? 'giliran'
                    : 'dijeda'
                  : 'ai',
          pesan: pesan ?? this.data.pesan,
        };
        this.jadwalPantauAi();
      }),
      v.on('event', (e) => this.terapkanEvent(e)),
      v.on('butuh_data', (b) => (this.data = { ...this.data, butuhData: b })),
      v.on('frame', () => {
        if (this.data.tayang) return;
        const s = this.statusServer;
        this.data = {
          ...this.data,
          tayang: true,
          keadaan:
            s?.status === 'menunggu_data' && this.data.keadaan === 'menyiapkan'
              ? keadaanDariSesi(s, this.data.giliran !== null, true)
              : this.data.keadaan,
        };
      }),
      v.on('galat', (g) => (this.data = { ...this.data, pesan: g.pesanWarga })),
      v.on('koneksi', (k) => {
        const keadaan =
          k === 'putus' ? 'terputus' : this.data.keadaan === 'terputus' ? 'ai' : this.data.keadaan;
        this.data = { ...this.data, koneksi: k, keadaan };
      }),
    ];
  }

  terapkanSesi(s: SesiPendamping): void {
    this.executionId = s.executionId;
    this.statusServer = { status: s.status, mode: s.mode };
    if (s.hasil && (s.status === 'selesai' || s.status === 'siaga')) void this.sinkronHasil();
    this.data = {
      ...this.data,
      mode: s.mode,
      antrean: s.antrean,
      keadaan: keadaanDariSesi(s, this.data.giliran !== null, this.data.tayang),
      pesan: s.pesan ?? this.data.pesan,
      bukti: s.bukti ?? this.data.bukti,
      situs: s.situs ? { origin: s.situs, replika: s.replika === true } : this.data.situs,
    };
    this.jadwalPantauAi();
  }

  /**
   * Selama mode `ai`, GET status berkala: server memulihkan loop Navigator yang hilang (web restart, atau loop
   * sudah berhenti lalu warga menekan Lanjutkan) atau mengembalikan kendali ke warga, sehingga layar tidak
   * tertahan "AI sedang mengisi" tanpa pengemudi. Jawabannya tidak dipakai; keadaan baru datang lewat viewer.
   */
  private jadwalPantauAi(): void {
    if (this.pantauAi || this.data.mode !== 'ai' || !this.viewer) return;
    this.pantauAi = setTimeout(() => {
      this.pantauAi = null;
      if (this.data.mode !== 'ai' || !this.viewer) return;
      void this.ambil(this.dasar)
        .catch(() => undefined)
        .finally(() => this.jadwalPantauAi());
    }, PANTAU_AI_MS);
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
        void this.sinkronHasil();
        return;
      case 'diblokir':
        return;
    }
  }

  /**
   * Laporkan hasil eksekusi ke harness sekali per execution: GET status membuat server membaca status
   * tepercaya dari worker lalu mencatat hasilnya (berhasil -> TERKIRIM + nomor permohonan). State baru
   * datang lewat stream urusan; jawaban GET di sini tidak dipakai.
   */
  private async sinkronHasil(): Promise<void> {
    const id = this.executionId;
    if (!id || this.tersinkron === id) return;
    this.tersinkron = id;
    try {
      const r = await this.ambil(this.dasar);
      if (!r.ok) this.tersinkron = null;
    } catch {
      this.tersinkron = null;
    }
  }

  ambilAlih(): void {
    this.viewer?.ambilAlih();
  }

  /**
   * Giliran `ketuk_tautan`: tombol Urusin "Buka …" meminta worker membuka tautan pembuka yang disorot, terikat
   * ref tautan yang ditampilkan (perangkat tidak pernah mengirim URL). Worker membaca ulang href-nya dan
   * mengembalikan kendali ke AI; sorotan yang sudah berubah ditolak worker.
   */
  bukaTautan(): void {
    const t = this.data.giliran?.alasan === 'ketuk_tautan' ? this.data.giliran.tautan : undefined;
    if (!t) return;
    this.data = { ...this.data, giliran: null };
    this.viewer?.bukaTautan(t.ref);
  }

  /**
   * "Saya sudah mengirim" (AI berhenti / warga memegang kendali): warga melaporkan sudah menekan Kirim sendiri.
   * Server meneruskan ke worker yang memeriksa ulang halaman saat ini (tulis warga + halaman sukses); hanya itu
   * yang dicatat berhasil. Selain itu warga mendapat jawaban jujur dari server (mis. belum terlihat terkirim).
   */
  async sudahMengirim(): Promise<void> {
    if (this.data.memeriksaKirim) return;
    this.data = { ...this.data, memeriksaKirim: true, pesanKirim: null };
    let pesan: string | null = 'Belum bisa diperiksa. Coba lagi sebentar lagi.';
    try {
      const r = await this.ambil(`${this.dasar}/terkirim`, {
        method: 'POST',
        headers: { accept: 'application/json' },
      });
      const j = (await r.json().catch(() => null)) as (SesiPendamping & { pesanWarga?: string }) | null;
      if (r.ok && j) {
        pesan = null;
        this.terapkanSesi(j);
      } else if (j?.pesanWarga) pesan = j.pesanWarga;
    } catch {
      pesan = 'Koneksi terputus. Periksa internet Anda, lalu coba lagi.';
    }
    this.data = { ...this.data, memeriksaKirim: false, pesanKirim: pesan };
  }

  /**
   * Lanjutkan. Pada giliran `berkas_kurang`: "Izinkan isi" baru untuk berkas itu saja (warga baru menambahkannya
   * di Dokumen), lalu kendali dikembalikan; langkah unggah diulang, dan bila berkas masih belum ada giliran yang
   * sama muncul lagi.
   */
  async kembalikan(): Promise<void> {
    const berkas = this.data.giliran?.alasan === 'berkas_kurang' ? this.data.giliran.berkas : undefined;
    if (berkas) {
      const pesan = await this.kirimIzin([`berkas:${berkas.nama.toUpperCase()}`], berkas.origin);
      if (pesan) this.data = { ...this.data, pesan };
    }
    this.data = { ...this.data, giliran: null };
    this.viewer?.kembalikan();
  }

  /**
   * "Izinkan isi" (A-M1): kirim HANYA daftar write yang ditampilkan di lembar + origin tujuan dari
   * `butuh_data` (POST /api/urusan/[id]/izinkan-isi). Server menyimpan persetujuan, lalu mengambil nilai Data
   * Diri/Dokumen dan mengirimnya ke sesi lewat kanal internal; peramban tidak pernah memegang nilainya.
   * Mengembalikan pesan untuk warga (yang harus diisi sendiri, atau galat), atau undefined bila lengkap.
   * Navigator generik: `pilihan` = baris yang dicentang warga di lembar; persetujuan terikat `rencanaHash`
   * halaman itu. Baris yang tidak dicentang diisi warga sendiri (AI menyerahkannya setelah baris lain terisi).
   */
  async izinkanIsi(pilihan?: { placeholder: string[]; berkas: string[] }): Promise<string | undefined> {
    const butuh = this.data.butuhData;
    if (!butuh) return undefined;
    const writeList = daftarWrite(pilihan?.placeholder ?? butuh.placeholder, pilihan?.berkas ?? butuh.berkas);
    if (writeList.length === 0) {
      const sendiri = butuh.placeholder.map(labelPlaceholder).filter((l, i, a) => a.indexOf(l) === i);
      return `Isi sendiri di layar: ${sendiri.join(', ')}.`;
    }
    if (!butuh.origin) return 'Situs tujuan belum diketahui. Isi sendiri di layar.';
    return this.kirimIzin(writeList, butuh.origin, true, butuh.rencanaHash);
  }

  /** POST izinkan-isi (daftar write + origin, tanpa nilai); pesan untuk warga, atau undefined bila lengkap. */
  private async kirimIzin(
    writeList: string[],
    targetOrigin: string,
    awal = false,
    rencanaHash?: string,
  ): Promise<string | undefined> {
    let res: Response;
    try {
      res = await this.ambil(`/api/urusan/${encodeURIComponent(this.urusanId)}/izinkan-isi`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ writeList, targetOrigin, ...(rencanaHash ? { rencanaHash } : {}) }),
      });
    } catch {
      return 'Koneksi terputus. Coba lagi atau isi sendiri.';
    }
    const j = (await res.json().catch(() => null)) as { pesanWarga?: string; kurang?: string[] } | null;
    if (!res.ok) return j?.pesanWarga ?? 'Izin belum tercatat. Coba lagi atau isi sendiri.';
    const kurang = j?.kurang ?? [];
    // Navigator generik: AI langsung lanjut; baris yang tidak disetujui diserahkan ke warga di layar nanti.
    if (rencanaHash) {
      this.data = { ...this.data, butuhData: null };
      return undefined;
    }
    if (awal && kurang.length === 0) this.data = { ...this.data, butuhData: null };
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

  /**
   * Tutup peramban server beserta login/cookie. Hasil (nomor) tetap disimpan; pemanggil baru boleh
   * menyembunyikan panel setelah true (server mengonfirmasi, atau sesi memang sudah tidak ada).
   */
  async tutupSekarang(): Promise<boolean> {
    try {
      const r = await this.ambil(this.dasar, { method: 'DELETE' });
      // 404: sesi sudah tidak ada (tutup sendiri) = sudah tertutup.
      if (!r.ok && r.status !== 404) throw new Error(String(r.status));
    } catch {
      this.data = { ...this.data, pesan: PESAN_GAGAL_TUTUP };
      return false;
    }
    this.tutup();
    this.data = { ...this.data, keadaan: 'selesai', mode: 'done', giliran: null };
    return true;
  }

  tutup(): void {
    if (this.pantauAi) clearTimeout(this.pantauAi);
    this.pantauAi = null;
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
