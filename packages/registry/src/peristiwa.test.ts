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
  it('langkah online-adapter wajib (dan hanya dia) membawa alur Pendamping; akta kelahiran Wonogiri = layanan 23', () => {
    const b = findBundel('kelahiran')!;
    const ajukan = b.langkah.find((l) => l.id === 'ajukan')!;
    expect(ajukan).toMatchObject({
      jenis: 'online-adapter',
      pendamping: { flowId: 'ajukan', params: { layanan_id: 23, berkas: 'kk,ktp,surat' } },
    });
    const tanpa = { ...ajukan, pendamping: undefined };
    expect(BundelSchema.safeParse({ ...b, langkah: [tanpa] }).success).toBe(false);
    const manual = { ...b.langkah[1]!, pendamping: ajukan.pendamping };
    expect(BundelSchema.safeParse({ ...b, langkah: [ajukan, manual] }).success).toBe(false);
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
  it('Pindah antar kab/kota: SKPWNI di asal lalu KK/KTP-el di tujuan; SKDWNI bukan dokumen nasional', () => {
    const p = findBundel('pindah')!;
    expect(p.langkah.map((l) => l.id)).toEqual(['skpwni', 'kk-ktp-el']);
    expect(p.langkah[1]!.dependsOn).toEqual(['skpwni']);
    expect(p.keluaran).toEqual(['SKPWNI', 'Kartu Keluarga', 'KTP-el']);
    expect(p.langkah[1]!.keterangan).toMatch(/KTP-el lama ditarik di tujuan/);
    expect(p.catatan).toMatch(/100 hari kerja/);
    expect(p.peringatan).toMatch(/dua sistem/);
  });
  it('fakta bersumber: 60 hari kelahiran, 30 hari kematian, KUA, KIA bersama akta', () => {
    const teks = (slug: string) => JSON.stringify(findBundel(slug)!.langkah);
    expect(teks('kelahiran')).toMatch(/paling lambat 60 hari/);
    expect(teks('kelahiran')).toMatch(/tanpa penetapan pengadilan/);
    expect(teks('kelahiran')).toMatch(/fotokopi KK \(Permendagri 7\/2026/);
    expect(teks('kematian')).toMatch(/paling lambat 30 hari/);
    expect(teks('perkawinan')).toMatch(/Dukcapil tidak menerbitkan kutipan akta perkawinannya/);
    const urls = (slug: string) => findBundel(slug)!.langkah.flatMap((l) => l.sourceRef.map((r) => r.url));
    expect(urls('kelahiran')).toContain('https://peraturan.go.id/files/uu24-2013bt.pdf');
    expect(urls('kelahiran')).toContain(
      'https://peraturan.bpk.go.id/Download/423299/permendagri-no-7-tahun-2026.pdf',
    );
    expect(urls('kematian')).toContain('https://peraturan.go.id/files/uu24-2013bt.pdf');
    expect(urls('perkawinan')).toContain('https://peraturan.go.id/files/uu23-2006.pdf');
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
