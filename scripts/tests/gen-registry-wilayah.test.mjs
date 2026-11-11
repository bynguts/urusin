import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { susun } from '../gen-registry-wilayah.mjs';

const SCRIPT = resolve(import.meta.dirname, '..', 'gen-registry-wilayah.mjs');

test('registry-wilayah.ts mutakhir terhadap data/wilayah (--check)', () => {
  const out = execFileSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' });
  assert.match(out, /mutakhir/);
});

const kabkota = { kabkota: [{ kode: '3275', nama: 'Kota Bekasi' }] };
const kontak = { kontak: [] };
const dasar = {
  kelas: 'A',
  jenis: 'web',
  login: [],
  proteksi: [],
  domisili: 'tidak_diketahui',
  bukti: 'OBS',
  verifiedAt: '2026-11-10',
  catatan: '',
};

test('host bukan .go.id tanpa sumber .go.id ditolak', () => {
  const h = susun(kabkota, kontak, {
    wilayah: { 3275: { ...dasar, hosts: ['www.e-open.id'], sumber: 'https://www.e-open.id/' } },
  });
  assert.ok(h.galat.some((g) => g.includes('tanpa sumber halaman .go.id')));
  const ok = susun(kabkota, kontak, {
    wilayah: {
      3275: { ...dasar, hosts: ['www.e-open.id'], sumber: 'https://disdukcapil.bekasikota.go.id/' },
    },
  });
  assert.deepEqual(ok.galat, []);
});

test('wildcard, port, dan huruf besar ditolak', () => {
  for (const host of ['*.bekasikota.go.id', 'a.go.id:8443', 'A.go.id', 'go']) {
    const h = susun(kabkota, kontak, { wilayah: { 3275: { ...dasar, hosts: [host] } } });
    assert.ok(h.galat.length > 0, host);
  }
});

test('hostAset: hanya .go.id, tidak ganda dengan host portal/info, hanya jenis web; masuk domain resmi', () => {
  const ok = susun(kabkota, kontak, {
    wilayah: { 3275: { ...dasar, hosts: ['a.bekasikota.go.id'], hostAset: ['cdn.bekasikota.go.id'] } },
  });
  assert.deepEqual(ok.galat, []);
  assert.deepEqual(ok.wilayah['3275'].hostAset, ['cdn.bekasikota.go.id']);
  assert.ok(ok.domain.some((d) => d.host === 'cdn.bekasikota.go.id' && d.wilayah === '3275'));
  // Tanpa hostAset: field tidak ditulis.
  const tanpa = susun(kabkota, kontak, { wilayah: { 3275: { ...dasar, hosts: ['a.bekasikota.go.id'] } } });
  assert.equal('hostAset' in tanpa.wilayah['3275'], false);
  for (const [hostAset, pesan] of [
    [['cdn.acehcms.id'], 'host aset bukan .go.id'],
    [['a.bekasikota.go.id'], 'host aset ganda'],
  ]) {
    const h = susun(kabkota, kontak, {
      wilayah: { 3275: { ...dasar, hosts: ['a.bekasikota.go.id'], hostAset } },
    });
    assert.ok(
      h.galat.some((g) => g.includes(pesan)),
      pesan,
    );
  }
  const wa = susun(kabkota, kontak, {
    wilayah: {
      3275: { ...dasar, kelas: 'D', jenis: 'whatsapp', hosts: [], hostAset: ['cdn.bekasikota.go.id'] },
    },
  });
  assert.ok(wa.galat.some((g) => g.includes('hostAset hanya untuk jenis web')));
});

test('jenis harus cocok dengan kelas dan host hanya untuk jenis web', () => {
  const a = susun(kabkota, kontak, { wilayah: { 3275: { ...dasar, kelas: 'D', hosts: ['a.go.id'] } } });
  assert.ok(a.galat.some((g) => g.includes('tidak cocok dengan kelas')));
  const b = susun(kabkota, kontak, { wilayah: { 3275: { ...dasar, hosts: [] } } });
  assert.ok(b.galat.some((g) => g.includes('host portal wajib')));
});
