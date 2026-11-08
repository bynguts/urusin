#!/usr/bin/env node
// Dipanggil hook commit-msg: node scripts/check-commit-msg.mjs <file-pesan>
import { readFileSync } from 'node:fs';
import { hasAiAttribution, stripGitComments } from './lib/commit-rules.mjs';

const file = process.argv[2];
if (!file) {
  console.error('pemakaian: node scripts/check-commit-msg.mjs <file-pesan-commit>');
  process.exit(2);
}

const message = stripGitComments(readFileSync(file, 'utf8'));
if (hasAiAttribution(message)) {
  console.error('commit ditolak: pesan memuat "Co-Authored-By:" atau atribusi AI.');
  console.error('Hapus trailer tersebut. Penggunaan AI diungkap di README bagian Dokumentasi AI.');
  process.exit(1);
}
