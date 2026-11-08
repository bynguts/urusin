import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENDPOINT, EVENT_TYPES, GalatApiSchema, UrusinEventSchema, parseFixture } from './index.js';
import { FIXTURES_DIR, bacaFixture, bacaSkenarioSse, daftarFixture } from './fixtures-node.js';

describe('fixture', () => {
  const semua = daftarFixture();

  it('ada fixture untuk layar dan state utama', () => {
    expect(semua.length).toBeGreaterThanOrEqual(60);
    const nama = new Set(semua.map((f) => f.nama));
    for (const wajib of [
      'urusan/jawaban-bersumber',
      'urusan/handoff',
      'urusan/error',
      'urusan/timeout',
      'urusan/degraded-hemat',
      'urusan/degraded-tanpa-ai',
      'konfirmasi/menunggu-warga',
      'bagian-anda/login',
      'bagian-anda/captcha',
      'bagian-anda/final',
      'lacak/berisi',
      'jejak/rantai-rusak',
    ]) {
      expect(nama.has(wajib), wajib).toBe(true);
    }
  });

  it.each(semua.map((f) => [f.nama]))('%s lolos skema', (nama) => {
    const mentah = JSON.parse(readFileSync(join(FIXTURES_DIR, `${nama}.json`), 'utf8'));
    expect(() => parseFixture(mentah)).not.toThrow();
  });

  it('skenario SSE: seq berurutan mulai 1 dan setiap tipe event dikenal', () => {
    const sse = semua.filter((f) => bacaFixture(f.nama)?.skema === 'sse');
    expect(sse.length).toBeGreaterThanOrEqual(15);
    for (const f of sse) {
      const events = bacaSkenarioSse(f.nama)!;
      expect(
        events.map((e) => e.seq),
        f.nama,
      ).toEqual(events.map((_, i) => i + 1));
      for (const e of events) expect(EVENT_TYPES).toContain(e.type);
    }
  });

  it('semua tipe event dalam union tercakup minimal satu fixture (kecuali heartbeat)', () => {
    const dipakai = new Set<string>();
    for (const f of semua) {
      const e = bacaSkenarioSse(f.nama);
      e?.forEach((x) => dipakai.add(x.type));
    }
    for (const t of EVENT_TYPES.filter((x) => x !== 'heartbeat')) expect(dipakai.has(t), t).toBe(true);
  });

  it('nama berbahaya ditolak tanpa menyentuh filesystem', () => {
    for (const n of ['../x', 'urusan/../../x', 'a/b/c', 'urusan/', '/etc/passwd', 'URUSAN/x'])
      expect(bacaFixture(n)).toBeNull();
    expect(bacaFixture('urusan/tidak-ada')).toBeNull();
  });

  it('tidak ada deretan 16 digit di fixture (bukan data pribadi)', () => {
    for (const f of semua) {
      expect(readFileSync(join(FIXTURES_DIR, `${f.nama}.json`), 'utf8'), f.nama).not.toMatch(/\d{16}/);
    }
  });
});

describe('skema', () => {
  it('event tanpa seq/chainHead ditolak', () => {
    expect(UrusinEventSchema.safeParse({ type: 'progress', label: 'x' }).success).toBe(false);
  });

  it('galat seragam {kode, pesanWarga}', () => {
    expect(GalatApiSchema.safeParse({ kode: 'X', pesanWarga: 'y' }).success).toBe(true);
    expect(GalatApiSchema.safeParse({ kode: 'X', pesan: 'y' }).success).toBe(false);
  });

  it('semua endpoint yang disebut kontrak terdaftar', () => {
    expect(Object.values(ENDPOINT).map((e) => `${e.method} ${e.path}`)).toEqual(
      expect.arrayContaining([
        'POST /api/urusan',
        'POST /api/urusan/[id]/turn',
        'POST /api/urusan/[id]/execution-result',
        'POST /api/urusan/[id]/konfirmasi',
        'GET /api/urusan',
        'GET /api/urusan/[id]/stream',
        'GET /api/urusan/[id]/jejak',
        'GET /api/peristiwa/[slug]',
        'GET /api/wilayah',
        'GET /api/pengetahuan',
        'GET /api/transparansi',
        'GET /api/kartu/[layanan]',
        'POST /api/sambung',
        'POST /api/sambung/klaim',
        'DELETE /api/data',
      ]),
    );
  });
});
