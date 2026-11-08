import type { StoreTts } from '#lib/contracts.js';

type Sintesis = Pick<SpeechSynthesis, 'speak' | 'cancel' | 'getVoices'>;
type Ucapan = new (teks: string) => SpeechSynthesisUtterance;

/** Ada suara id-ID di perangkat? `getVoices()` bisa kosong sebelum `voiceschanged`; panggil ulang `periksa()` saat itu. */
export function adaSuaraIndonesia(s: Pick<SpeechSynthesis, 'getVoices'> | undefined): boolean {
  if (!s) return false;
  return s.getVoices().some((v) => v.lang.toLowerCase().replace('_', '-').startsWith('id'));
}

/** Bacakan teks dengan `speechSynthesis` id-ID bila ada. Tanpa suara id-ID, `tersedia` false dan UI menyembunyikan tombol. */
export class TtsStore implements StoreTts {
  tersedia = $state(false);
  membaca = $state(false);

  constructor(
    private readonly sintesis: Sintesis | undefined = typeof speechSynthesis === 'undefined'
      ? undefined
      : speechSynthesis,
    private readonly Ucapan: Ucapan | undefined = typeof SpeechSynthesisUtterance === 'undefined'
      ? undefined
      : SpeechSynthesisUtterance,
  ) {
    this.periksa();
    (
      this.sintesis as { addEventListener?: (t: string, f: () => void) => void } | undefined
    )?.addEventListener?.('voiceschanged', () => this.periksa());
  }

  periksa(): void {
    this.tersedia = this.Ucapan !== undefined && adaSuaraIndonesia(this.sintesis);
  }

  baca(teks: string): void {
    if (!this.tersedia || !this.sintesis || !this.Ucapan || teks.trim() === '') return;
    this.sintesis.cancel();
    const u = new this.Ucapan(teks);
    u.lang = 'id-ID';
    const voice = this.sintesis
      .getVoices()
      .find((v) => v.lang.toLowerCase().replace('_', '-').startsWith('id'));
    if (voice) u.voice = voice;
    u.onend = () => (this.membaca = false);
    u.onerror = () => (this.membaca = false);
    this.membaca = true;
    this.sintesis.speak(u);
  }

  berhenti(): void {
    this.sintesis?.cancel();
    this.membaca = false;
  }
}
