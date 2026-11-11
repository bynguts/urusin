import type { Prefs, StorePrefs } from '#lib/contracts.js';

const KUNCI = 'urusin.prefs.v1';

/** Nilai awal (nilai runtime tidak diimpor dari @urusin/contracts agar zod tidak ikut ke bundel klien). */
export const PREFS_AWAL: Prefs = {
  ukuranHuruf: 1,
  bacakanOtomatis: false,
  hematData: false,
  tema: 'sistem',
  modeUji: false,
  modePresentasi: false,
};

const UKURAN: readonly Prefs['ukuranHuruf'][] = [1, 1.125, 1.25, 1.5];
const TEMA: readonly Prefs['tema'][] = ['terang', 'gelap', 'sistem'];

/** Ambil hanya kunci yang valid dari data tersimpan; sisanya kembali ke nilai awal. */
export function bersihkanPrefs(raw: unknown): Prefs {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const bool = (k: keyof Prefs) =>
    typeof o[k] === 'boolean' ? (o[k] as boolean) : (PREFS_AWAL[k] as boolean);
  return {
    ukuranHuruf: UKURAN.find((u) => u === o.ukuranHuruf) ?? PREFS_AWAL.ukuranHuruf,
    bacakanOtomatis: bool('bacakanOtomatis'),
    hematData: bool('hematData'),
    tema: TEMA.find((t) => t === o.tema) ?? PREFS_AWAL.tema,
    modeUji: bool('modeUji'),
    modePresentasi: bool('modePresentasi'),
  };
}

/** Preferensi tampilan per perangkat (localStorage; bila diblokir, tetap jalan di memori). */
export class PrefsStore implements StorePrefs {
  nilai = $state<Prefs>({ ...PREFS_AWAL });

  constructor(private readonly gudang: Pick<Storage, 'getItem' | 'setItem'> | undefined = ambilGudang()) {
    try {
      const raw = this.gudang?.getItem(KUNCI);
      if (raw) this.nilai = bersihkanPrefs(JSON.parse(raw));
    } catch {
      // data tersimpan rusak/tidak bisa dibaca: pakai nilai awal
    }
  }

  atur<K extends keyof Prefs>(kunci: K, nilai: Prefs[K]): void {
    this.nilai = bersihkanPrefs({ ...this.nilai, [kunci]: nilai });
    this.simpan();
  }

  reset(): void {
    this.nilai = { ...PREFS_AWAL };
    this.simpan();
  }

  private simpan(): void {
    try {
      this.gudang?.setItem(KUNCI, JSON.stringify(this.nilai));
    } catch {
      // penyimpanan penuh/diblokir: nilai tetap berlaku sampai halaman ditutup
    }
  }
}

function ambilGudang(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
