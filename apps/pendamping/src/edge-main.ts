import { lookup } from 'node:dns/promises';
import { networkInterfaces } from 'node:os';
import {
  createDaftarSesi,
  createEdgeBalik,
  createEdgeKontrol,
  createEdgeProxy,
  loadEdgeConfig,
  pilihAntarmuka,
} from './edge.js';

const cfg = loadEdgeConfig(process.env);

// Alamat pendamping (DNS Docker) menentukan antarmuka internal; tunggu sampai kontainernya hidup.
let alamatHulu: string | undefined;
for (let i = 0; i < 60 && !alamatHulu; i++) {
  try {
    alamatHulu = (await lookup(cfg.hulu.hostname, { family: 4 })).address;
  } catch {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
if (!alamatHulu) throw new Error(`edge: ${cfg.hulu.hostname} tidak ter-resolve`);
const { internal, publik } = pilihAntarmuka(alamatHulu, networkInterfaces());

const daftar = createDaftarSesi(cfg.maksSesi);
const proxy = createEdgeProxy(cfg, daftar);
const kontrol = createEdgeKontrol(cfg, daftar);
const balik = createEdgeBalik(cfg);

proxy.server.listen(cfg.portProxy, internal);
kontrol.listen(cfg.portKontrol, internal);
balik.listen(cfg.portBalik, publik, () => {
  // Hanya metadata boot; tidak ada log per permintaan atau per host.
  console.log(
    `pendamping-edge: balik ${publik}:${cfg.portBalik}, proxy ${internal}:${cfg.portProxy}, kontrol ${internal}:${cfg.portKontrol}${cfg.debug ? ' (debug diteruskan)' : ''}`,
  );
});

const stop = () => {
  proxy.tutup();
  for (const s of [proxy.server, kontrol, balik]) s.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
