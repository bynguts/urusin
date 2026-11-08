import { LokalStore } from './lokal.svelte.js';
import { PrefsStore } from './prefs.svelte.js';
import { TtsStore } from './tts.svelte.js';

/**
 * Store per perangkat yang dipakai banyak layar. Dibuat malas (sekali) di peramban; di server tiap pemanggilan
 * mendapat instance baru bernilai awal sehingga tidak ada state yang bocor antar-request.
 */
let lokal: LokalStore | undefined;
let prefs: PrefsStore | undefined;
let tts: TtsStore | undefined;

const diPeramban = () => typeof window !== 'undefined';

export function ambilLokal(): LokalStore {
  if (!diPeramban()) return new LokalStore(undefined);
  return (lokal ??= new LokalStore());
}

export function ambilPrefs(): PrefsStore {
  if (!diPeramban()) return new PrefsStore(undefined);
  return (prefs ??= new PrefsStore());
}

export function ambilTts(): TtsStore {
  if (!diPeramban()) return new TtsStore(undefined, undefined);
  return (tts ??= new TtsStore());
}
