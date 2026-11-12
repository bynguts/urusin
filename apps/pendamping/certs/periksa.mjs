// Pemeriksa bundel intermediate saat build image (Dockerfile tahap `nss`): setiap berkas di certs/intermediate harus
// tercatat di intermediate.json dengan sidik SHA-256 yang sama, berupa CA, dan BUKAN self-signed (bukan trust
// anchor). Gagal = build gagal. Setiap berkas .crt berisi satu sertifikat PEM. Uji yang sama ada di src/nss.test.ts.
import { X509Certificate } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? import.meta.dirname;
const manifest = JSON.parse(readFileSync(join(dir, 'intermediate.json'), 'utf8'));
const berkas = readdirSync(join(dir, 'intermediate')).sort();
const tercatat = manifest.map((m) => m.berkas).sort();
if (JSON.stringify(berkas) !== JSON.stringify(tercatat))
  throw new Error(`berkas dan manifest berbeda: ${berkas.join(',')} vs ${tercatat.join(',')}`);
for (const m of manifest) {
  const c = new X509Certificate(readFileSync(join(dir, 'intermediate', m.berkas)));
  if (c.fingerprint256 !== m.sha256) throw new Error(`sidik ${m.berkas} tidak cocok: ${c.fingerprint256}`);
  if (!c.ca) throw new Error(`${m.berkas} bukan sertifikat CA`);
  if (c.issuer === c.subject) throw new Error(`${m.berkas} self-signed (trust anchor dilarang)`);
}
console.log(`bundel intermediate: ${manifest.length} sertifikat, sidik cocok`);
