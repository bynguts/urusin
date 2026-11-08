import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BundelSchema, LangkahSchema, PERISTIWA_BUNDEL, findBundel } from './peristiwa.js';

describe('PERISTIWA_BUNDEL', () => {
  it('empat bundel dengan slug yang dipakai beranda web', () => {
    expect(PERISTIWA_BUNDEL.map((b) => b.slug)).toEqual(['kelahiran', 'kematian', 'perkawinan', 'pindah']);
    const web = readFileSync(new URL('../../../apps/web/src/lib/peristiwa.ts', import.meta.url), 'utf8');
    for (const b of PERISTIWA_BUNDEL) expect(web).toContain(`slug: '${b.slug}'`);
  });
  it('setiap langkah punya sourceRef resmi (.go.id) dan verifiedAt (null = belum diverifikasi)', () => {
    for (const b of PERISTIWA_BUNDEL) {
      for (const l of b.langkah) {
        expect(l.sourceRef.length, `${b.slug}/${l.id}`).toBeGreaterThan(0);
        for (const r of l.sourceRef) expect(new URL(r.url).hostname.endsWith('.go.id')).toBe(true);
        expect(l.verifiedAt).toBeNull();
      }
    }
  });
  it('menolak langkah tanpa sourceRef atau tanpa kunci verifiedAt', () => {
    const l = PERISTIWA_BUNDEL[0]!.langkah[0]!;
    expect(LangkahSchema.safeParse({ ...l, sourceRef: [] }).success).toBe(false);
    const { verifiedAt: _v, ...tanpa } = l;
    expect(LangkahSchema.safeParse(tanpa).success).toBe(false);
  });
  it('langkah offline wajib punya lokasi; kelahiran dan kematian punya langkah offline', () => {
    const bad = {
      ...PERISTIWA_BUNDEL[0]!,
      langkah: [{ ...PERISTIWA_BUNDEL[0]!.langkah[2]!, lokasi: undefined }],
    };
    expect(BundelSchema.safeParse(bad).success).toBe(false);
    expect(findBundel('kelahiran')!.langkah.some((l) => l.jenis === 'offline')).toBe(true);
    expect(findBundel('kematian')!.langkah.some((l) => l.jenis === 'offline')).toBe(true);
  });
  it('DAG valid: dependsOn dikenal dan tanpa siklus', () => {
    const b = findBundel('kelahiran')!;
    expect(BundelSchema.safeParse({ ...b, langkah: [{ ...b.langkah[0]!, dependsOn: ['x'] }] }).success).toBe(
      false,
    );
    expect(
      BundelSchema.safeParse({ ...b, langkah: [{ ...b.langkah[0]!, id: 'a', dependsOn: ['a'] }] }).success,
    ).toBe(false);
  });
  it('Pindah berurutan SKPWNI -> SKDWNI -> KK -> KTP-el dan diberi peringatan risiko', () => {
    const p = findBundel('pindah')!;
    expect(p.langkah.map((l) => l.id)).toEqual(['skpwni', 'skdwni', 'kk', 'ktp-el']);
    expect(p.langkah[1]!.dependsOn).toEqual(['skpwni']);
    expect(p.peringatan).toMatch(/dua sistem/);
  });
  it('Perkawinan menampilkan langkah PT POS dan tatap muka secara eksplisit', () => {
    const lok = findBundel('perkawinan')!.langkah.map((l) => l.lokasi);
    expect(lok).toContain('pt-pos');
    expect(lok).toContain('disdukcapil');
  });
  it('tidak ada klaim kelayakan dan tidak ada PII', () => {
    const s = JSON.stringify(PERISTIWA_BUNDEL);
    expect(s).not.toMatch(/Anda memenuhi syarat/i);
    expect(s).not.toMatch(/\d{12,}|\+62|wa\.me/);
  });
});
