import { networkInterfaces } from 'node:os';

/**
 * Healthcheck kontainer: `node dist/sehat.js [port]`. Layanan mengikat alamat antarmuka (HOST=antarmuka atau
 * antarmuka internal edge), bukan 127.0.0.1, jadi coba 127.0.0.1 lalu setiap IPv4 non-loopback; sehat bila
 * salah satu menjawab /health 2xx dalam 3 detik.
 */
const port = Number(process.argv[2] ?? process.env.PORT ?? 4330);
const alamat = [
  '127.0.0.1',
  ...Object.values(networkInterfaces())
    .flat()
    .filter((a) => a !== undefined && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address),
];
for (const a of alamat) {
  try {
    const r = await fetch(`http://${a}:${port}/health`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) process.exit(0);
  } catch {
    // coba alamat berikutnya
  }
}
process.exit(1);
