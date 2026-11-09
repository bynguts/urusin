import { createBrowserFactory, pidsOfProfile } from './browser.js';
import { loadConfig } from './config.js';
import { periksaSandbox, periksaTanpaRute } from './isolasi.js';
import { createServer } from './server.js';
import { SessionManager } from './sessions.js';
import { ensureDisplay } from './xvfb.js';

const config = loadConfig(process.env);
// Chromium headed butuh layar: di server Linux tanpa DISPLAY, jalankan satu Xvfb milik proses ini.
const xvfb = await ensureDisplay(process.env, config.headless);
// Gagal tertutup sebelum menerima sesi: dengan edge (produksi) kontainer tidak boleh punya rute keluar
// langsung, dan di Linux sandbox Chromium harus benar-benar aktif.
if (config.edge && process.platform === 'linux') await periksaTanpaRute();
if (config.sandbox && process.platform === 'linux') {
  const jenis = await periksaSandbox(config, pidsOfProfile);
  console.log(`sandbox Chromium aktif (${jenis === 'setuid' ? 'setuid chrome-sandbox' : 'user namespace'})`);
}
const manager = new SessionManager(config, createBrowserFactory(config));
manager.startSweeper();
const server = createServer(config, manager);

server.listen(config.port, config.host, () => {
  // Hanya metadata boot; tidak ada log per permintaan, frame, atau ketikan.
  console.log(
    `pendamping mendengarkan di ${config.host}:${config.port} (maks ${config.maxSessions} sesi, TTL ${config.ttlMs / 60_000} menit, ${config.headless ? 'headless' : `headed${xvfb ? ` di Xvfb ${xvfb.display}` : ''}`})`,
  );
});

const stop = async () => {
  server.close();
  await manager.shutdown();
  xvfb?.stop();
  process.exit(0);
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
