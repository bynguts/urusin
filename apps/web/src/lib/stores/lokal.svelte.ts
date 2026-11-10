/**
 * Data per perangkat untuk tamu (tanpa akun): daftar id urusan yang dimulai di perangkat ini, wilayah layanan,
 * dan dua pilihan tampilan tambahan (kontras tinggi, kurangi gerakan). Disimpan di localStorage; bila diblokir,
 * tetap jalan di memori. Id urusan adalah token kapabilitas: hanya disimpan di perangkat warga.
 */
export type CatatanUrusan = {
  id: string;
  judul: string;
  peristiwa: string | null;
  dibuatPada: string;
};

export type Wilayah = { kodeKabKota: string; nama: string };

export type DataLokal = {
  /**
   * 2 = `wilayah` dipilih warga sendiri. Data lama (tanpa penanda ini) masih menyimpan default Wonogiri yang dulu
   * diisi diam-diam, jadi wilayahnya diabaikan.
   */
  versiWilayah: 2;
  urusan: CatatanUrusan[];
  /** Pilihan wilayah di perangkat ini: hanya usulan, selalu dikonfirmasi warga di urusan. null = belum dipilih. */
  wilayah: Wilayah | null;
  kontrasTinggi: boolean;
  kurangiGerak: boolean;
};

const KUNCI = 'urusin.lokal.v1';
const ID_RE = /^u_[0-9a-f]{32}$/;
const MAKS_URUSAN = 50;

/** Ambil hanya bentuk yang valid dari data tersimpan. */
export function bersihkanLokal(raw: unknown): DataLokal {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const urusan = Array.isArray(o.urusan)
    ? o.urusan
        .filter(
          (u): u is CatatanUrusan =>
            typeof u === 'object' &&
            u !== null &&
            typeof (u as CatatanUrusan).id === 'string' &&
            ID_RE.test((u as CatatanUrusan).id) &&
            typeof (u as CatatanUrusan).judul === 'string' &&
            typeof (u as CatatanUrusan).dibuatPada === 'string',
        )
        .map((u) => ({
          id: u.id,
          judul: u.judul.slice(0, 120),
          peristiwa: typeof u.peristiwa === 'string' ? u.peristiwa : null,
          dibuatPada: u.dibuatPada,
        }))
        .slice(0, MAKS_URUSAN)
    : [];
  const w = o.versiWilayah === 2 ? (o.wilayah as Partial<Wilayah> | null | undefined) : undefined;
  const wilayah =
    w && typeof w.kodeKabKota === 'string' && /^\d{4}$/.test(w.kodeKabKota) && typeof w.nama === 'string'
      ? { kodeKabKota: w.kodeKabKota, nama: w.nama.slice(0, 80) }
      : null;
  return {
    versiWilayah: 2,
    urusan,
    wilayah,
    kontrasTinggi: o.kontrasTinggi === true,
    kurangiGerak: o.kurangiGerak === true,
  };
}

/** Singkat nama resmi registry: "Kabupaten Wonogiri" → "Kab. Wonogiri". */
export function namaPendek(nama: string): string {
  return nama
    .replace(/^Kabupaten Administrasi /, 'Kab. ')
    .replace(/^Kota Administrasi /, 'Kota ')
    .replace(/^Kabupaten /, 'Kab. ');
}

export class LokalStore {
  data = $state<DataLokal>(bersihkanLokal(null));

  constructor(private readonly gudang: Pick<Storage, 'getItem' | 'setItem'> | undefined = ambilGudang()) {
    try {
      const raw = this.gudang?.getItem(KUNCI);
      if (raw) this.data = bersihkanLokal(JSON.parse(raw));
    } catch {
      // data rusak: mulai dari kosong
    }
  }

  private simpan(): void {
    try {
      this.gudang?.setItem(KUNCI, JSON.stringify(this.data));
    } catch {
      // penyimpanan penuh/diblokir: tetap berlaku sampai halaman ditutup
    }
  }

  catatUrusan(u: CatatanUrusan): void {
    if (!ID_RE.test(u.id)) return;
    this.data = {
      ...this.data,
      urusan: [u, ...this.data.urusan.filter((x) => x.id !== u.id)].slice(0, MAKS_URUSAN),
    };
    this.simpan();
  }

  cari(id: string): CatatanUrusan | undefined {
    return this.data.urusan.find((u) => u.id === id);
  }

  aturWilayah(w: Wilayah | null): void {
    this.data = { ...this.data, wilayah: bersihkanLokal({ versiWilayah: 2, wilayah: w }).wilayah };
    this.simpan();
  }

  atur(kunci: 'kontrasTinggi' | 'kurangiGerak', nilai: boolean): void {
    this.data = { ...this.data, [kunci]: nilai };
    this.simpan();
  }

  hapusSemua(): void {
    for (const u of this.data.urusan) this.hapusKunci(`${KUNCI_PESAN}${u.id}`);
    this.hapusKunci(KUNCI_TERTUNDA);
    this.data = bersihkanLokal(null);
    this.simpan();
  }

  /**
   * Pesan warga per urusan. Event SSE tidak memuat teks warga (server hanya mencatat placeholder), jadi
   * gelembung pesan warga disimpan di perangkat ini saja.
   */
  pesanWarga(id: string): PesanWarga[] {
    try {
      const raw = this.gudang?.getItem(`${KUNCI_PESAN}${id}`);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr)
        ? arr
            .filter(
              (p): p is PesanWarga =>
                typeof p === 'object' &&
                p !== null &&
                typeof (p as PesanWarga).teks === 'string' &&
                typeof (p as PesanWarga).setelahSeq === 'number',
            )
            .slice(-MAKS_PESAN)
        : [];
    } catch {
      return [];
    }
  }

  catatPesan(id: string, p: PesanWarga): void {
    if (!ID_RE.test(id)) return;
    const semua = [...this.pesanWarga(id), { teks: p.teks.slice(0, 2000), setelahSeq: p.setelahSeq }].slice(
      -MAKS_PESAN,
    );
    try {
      this.gudang?.setItem(`${KUNCI_PESAN}${id}`, JSON.stringify(semua));
    } catch {
      // diabaikan
    }
  }

  /** Pesan pertama dari Beranda, dipasang ke urusan yang baru dibuat saat halamannya terbuka. */
  simpanTertunda(teks: string): void {
    try {
      this.gudang?.setItem(KUNCI_TERTUNDA, teks.slice(0, 2000));
    } catch {
      // diabaikan
    }
  }

  ambilTertunda(): string | null {
    try {
      const t = this.gudang?.getItem(KUNCI_TERTUNDA) ?? null;
      this.hapusKunci(KUNCI_TERTUNDA);
      return t;
    } catch {
      return null;
    }
  }

  private hapusKunci(k: string): void {
    try {
      (this.gudang as Partial<Pick<Storage, 'removeItem'>> | undefined)?.removeItem?.(k);
    } catch {
      // diabaikan
    }
  }
}

export type PesanWarga = { teks: string; setelahSeq: number };
const KUNCI_PESAN = 'urusin.pesan.';
const KUNCI_TERTUNDA = 'urusin.pesan-tertunda';
const MAKS_PESAN = 40;

function ambilGudang(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
