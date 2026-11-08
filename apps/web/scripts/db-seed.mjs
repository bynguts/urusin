// Mengisi DB uji untuk job CI rc-compat (dijalankan dengan kode HEAD, setelah `pnpm build`):
//   - satu urusan normal dengan beberapa event (rantai hash audit valid);
//   - satu urusan dengan nilai state dari masa depan (tidak dikenal image rc) untuk menguji degradasi.
//   DB_PATH=/jalur/urusin.db node apps/web/scripts/db-seed.mjs   -> mencetak {"normal":"u_...","future":"u_..."}
import { HarnessStore, openHarnessDb } from '@urusin/harness';

const { DB_PATH } = process.env;
if (!DB_PATH) {
  console.error('db-seed: DB_PATH wajib diisi');
  process.exit(2);
}

const db = openHarnessDb(DB_PATH);
const store = new HarnessStore(db);

const normal = store.createUrusan({ kodeKabKota: '3374', jenis: 'kelahiran' });
store.appendEvent(normal.id, 'state', { dari: 'BARU', ke: 'MEMAHAMI' });
store.appendEvent(normal.id, 'state', { dari: 'MEMAHAMI', ke: 'RENCANA_DIUSULKAN' });
store.appendEvent(normal.id, 'state', { dari: 'RENCANA_DIUSULKAN', ke: 'RENCANA_DISETUJUI' });
db.prepare("UPDATE urusan SET state = 'RENCANA_DISETUJUI', version = 3 WHERE id = ?").run(normal.id);

const future = store.createUrusan({ kodeKabKota: '3374', jenis: 'kematian' });
store.appendEvent(future.id, 'state', { dari: 'BARU', ke: 'MEMAHAMI' });
db.prepare("UPDATE urusan SET state = 'STATE_DARI_MASA_DEPAN', version = 1 WHERE id = ?").run(future.id);

db.close();
console.log(JSON.stringify({ normal: normal.id, future: future.id }));
