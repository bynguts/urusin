#!/usr/bin/env node
// Alat kunci ekstensi (rencana §3.5 butir 6).
//   node scripts/extension-key.mjs generate <path-privat.pem>   buat keypair RSA-2048; privat ke file, publik dicetak
//   node scripts/extension-key.mjs id [manifest-key.pub]         turunkan ID ekstensi dari kunci publik
// ID = 16 byte pertama SHA-256(DER SPKI kunci publik), tiap nibble dipetakan ke huruf a..p.
import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function deriveExtensionId(publicKeyBase64) {
  const der = Buffer.from(publicKeyBase64.trim(), 'base64');
  createPublicKey({ key: der, format: 'der', type: 'spki' }); // gagal bila bukan SPKI valid
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + Number.parseInt(c, 16))).join('');
}

function main(argv) {
  const [cmd, arg] = argv;
  if (cmd === 'generate') {
    if (!arg) throw new Error('usage: generate <path-privat.pem>');
    const out = resolve(arg);
    if (existsSync(out)) throw new Error(`menolak menimpa kunci yang ada: ${out}`);
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    console.log(`kunci publik (manifest.key): ${pub}`);
    console.log(`id ekstensi: ${deriveExtensionId(pub)}`);
    return;
  }
  if (cmd === 'id') {
    const file = arg ? resolve(arg) : fileURLToPath(new URL('../manifest-key.pub', import.meta.url));
    console.log(deriveExtensionId(readFileSync(file, 'utf8')));
    return;
  }
  throw new Error('perintah: generate | id');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
