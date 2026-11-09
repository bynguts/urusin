// pnpm kek:rotate — bungkus ulang semua DEK vault dari URUSIN_PII_KEY_PREV ke URUSIN_PII_KEY.
// Kunci hanya dibaca dari env proses; tidak pernah dicetak.
import { rotasiKek } from './kek-rotate.js';

try {
  const r = rotasiKek(process.env);
  console.log(
    `kek:rotate selesai: ${r.dibungkusUlang} DEK dibungkus ulang, ${r.sudahBaru} sudah memakai kunci baru`,
  );
  process.exit(0);
} catch (e) {
  console.error(`kek:rotate gagal: ${(e as Error).message}`);
  process.exit(1);
}
