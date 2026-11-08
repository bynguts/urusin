import { createBrowserFactory } from './browser.js';
import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { SessionManager } from './sessions.js';

const config = loadConfig(process.env);
const manager = new SessionManager(config, createBrowserFactory(config));
manager.startSweeper();
const server = createServer(config, manager);

server.listen(config.port, config.host, () => {
  // Hanya metadata boot; tidak ada log per permintaan, frame, atau ketikan.
  console.log(
    `pendamping mendengarkan di ${config.host}:${config.port} (maks ${config.maxSessions} sesi, TTL ${config.ttlMs / 60_000} menit)`,
  );
});

const stop = async () => {
  server.close();
  await manager.shutdown();
  process.exit(0);
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
