/**
 * Nilai env terisi, atau undefined bila kosong atau masih placeholder `.env.example` (`ganti-dengan-…`).
 * Dengan begitu `.env` yang disalin dari contoh tanpa kredensial asli mematikan fitur (tombol Google
 * tersembunyi, email mode log, Turnstile nonaktif) alih-alih menyalakannya dengan kunci palsu.
 */
export function nilaiEnv(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t && !t.startsWith('ganti-dengan') ? t : undefined;
}
