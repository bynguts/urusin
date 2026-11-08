// Menjalankan migrasi harness HEAD pada DB (membuatnya bila belum ada), lalu menutupnya.
// Dipakai job CI rc-compat: DB hasil migrasi HEAD harus tetap bisa dibaca image rc terakhir.
//   DB_PATH=/jalur/urusin.db node apps/web/scripts/db-migrate.mjs   (setelah `pnpm build`)
import { openHarnessDb } from '@urusin/harness';

const { DB_PATH } = process.env;
if (!DB_PATH) {
  console.error('db-migrate: DB_PATH wajib diisi');
  process.exit(2);
}
openHarnessDb(DB_PATH).close();
console.log(`db-migrate: migrasi HEAD diterapkan pada ${DB_PATH}`);
