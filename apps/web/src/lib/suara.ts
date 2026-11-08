/**
 * Dikte suara (Web Speech API) untuk tombol "Bicara". Hanya tersedia di peramban yang mendukungnya;
 * bila tidak ada, tombol disembunyikan. Bahasa id-ID; hasil langsung masuk kotak teks, tidak dikirim otomatis.
 */
type HasilPengenalan = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type Pengenal = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: HasilPengenalan) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
};
type KelasPengenal = new () => Pengenal;

function kelas(): KelasPengenal | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: KelasPengenal;
    webkitSpeechRecognition?: KelasPengenal;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function dikteTersedia(): boolean {
  return kelas() !== undefined;
}

/** Mulai dikte; `onTeks` dipanggil dengan transkrip berjalan. Kembalikan fungsi berhenti. */
export function mulaiDikte(onTeks: (teks: string) => void, onSelesai: () => void): () => void {
  const K = kelas();
  if (!K) {
    onSelesai();
    return () => {};
  }
  const r = new K();
  r.lang = 'id-ID';
  r.interimResults = true;
  r.continuous = false;
  r.onresult = (e) => {
    let teks = '';
    for (let i = 0; i < e.results.length; i++) teks += e.results[i]?.[0]?.transcript ?? '';
    onTeks(teks);
  };
  r.onend = onSelesai;
  r.onerror = onSelesai;
  r.start();
  return () => r.stop();
}
