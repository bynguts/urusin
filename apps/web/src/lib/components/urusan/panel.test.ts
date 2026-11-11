import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { EventOf } from '#lib/contracts.js';
import { LANGKAH_RENCANA, langkahKini, langkahPanel } from '#lib/urusan-status.js';
import PanelKonteks from './PanelKonteks.svelte';

const langkah = (jenis: 'online-manual' | 'offline' | 'cek-kanal', judul: string) => ({
  id: judul,
  jenis,
  judul,
  bawa: [],
  sumber: [],
});

/** Rencana cek data dipandu (tanpa Browser Pendamping), seperti cek bansos. */
const cekBansos = {
  type: 'plan_card',
  ringkasan: 'Cek bansos',
  langkah: [
    langkah('online-manual', 'Cek status di cekbansos.kemensos.go.id'),
    langkah('offline', 'Bila tidak terdaftar, ajukan lewat desa/kelurahan'),
  ],
  tier: 'dipandu',
} as unknown as EventOf<'plan_card'>;

const aktaSemi = {
  ...cekBansos,
  langkah: [langkah('online-manual', 'Ajukan akta kelahiran')],
  tier: 'semi',
  pendamping: { jalur: 'adapter', host: 'fixtures.urusinai.web.id', keterangan: 'AI mengisi.' },
} as unknown as EventOf<'plan_card'>;

function panel(props: Record<string, unknown>) {
  return render(PanelKonteks, {
    props: { state: null, sedangBerjalan: false, rencana: null, checklist: null, kutipan: [], ...props },
  }).body;
}

describe('panel Rencana mengikuti rencana dan tier', () => {
  it('rencana dipandu memakai langkahnya sendiri, bukan lima langkah adminduk', () => {
    const l = langkahPanel(cekBansos, 'bansos');
    expect(l).toEqual([
      { judul: 'Cek status di cekbansos.kemensos.go.id', pelaku: 'Anda' },
      { judul: 'Bila tidak terdaftar, ajukan lewat desa/kelurahan', pelaku: 'Instansi' },
    ]);
    expect(langkahKini('RENCANA_DIUSULKAN', l)).toBe(0);
    expect(langkahKini('RENCANA_DISETUJUI', l)).toBe(1);
    expect(langkahKini('DIPANDU', l)).toBe(1);
    expect(langkahKini('SELESAI', l)).toBe(3);

    const body = panel({ state: 'RENCANA_DISETUJUI', rencana: cekBansos, jenis: 'bansos' });
    expect(body).toContain('Langkah 1 dari 2');
    expect(body).toContain('Cek status di cekbansos.kemensos.go.id');
    expect(body).not.toContain('Masuk akun di situs resmi');
    expect(body).not.toContain('AI mengisi formulir');
  });

  it('rencana yang dibantu Browser Pendamping tetap lima langkah', () => {
    expect(langkahPanel(aktaSemi, 'kelahiran')).toBe(LANGKAH_RENCANA);
    const body = panel({ state: 'MENUNGGU_LOGIN_WARGA', rencana: aktaSemi, jenis: 'kelahiran' });
    expect(body).toContain('Langkah 2 dari 5');
    expect(body).toContain('Masuk akun di situs resmi');
  });

  it('Browser Pendamping masih disiapkan: langkah 2–3 belum "Selesai"', () => {
    const body = panel({ state: 'BERKAS_SIAP', rencana: aktaSemi, persiapan: true });
    expect(body).toContain('Langkah 2 dari 5');
    expect(body).toContain('Menyiapkan browser');
    // Hanya langkah 1 yang selesai (ikon centang berlabel "Selesai" + teks "Selesai").
    expect(body.match(/>Selesai</g) ?? []).toHaveLength(1);
  });

  it('tab Sumber menghitung sumber rencana yang belum dikutip, unik per URL', () => {
    const s = (n: number) => ({ url: `https://contoh.go.id/${n}`, judul: `Sumber ${n}`, instansi: 'Dinas' });
    const rencana = {
      ...cekBansos,
      langkah: [
        { ...cekBansos.langkah[0]!, sumber: [s(1), s(2)] },
        { ...cekBansos.langkah[1]!, sumber: [s(2), s(3), s(4)] },
      ],
    } as EventOf<'plan_card'>;
    const kutipan = [
      { refId: 'r1', nomor: 1, url: s(1).url, judul: 'Kutipan 1', kutipanPersis: 'isi', instansi: 'Dinas' },
    ] as never;
    const semua = panel({ state: 'RENCANA_DISETUJUI', rencana, tab: 'sumber' });
    expect(semua).toMatch(/Sumber\s*(<!--[^>]*-->\s*)*<span[^>]*>4</);
    for (const n of [1, 2, 3, 4]) expect(semua).toContain(`Sumber ${n}`);
    expect(semua).not.toContain('Sumber resmi muncul di sini');
    const campur = panel({ state: 'RENCANA_DISETUJUI', rencana, tab: 'sumber', kutipan });
    expect(campur).toContain('Kutipan 1');
    expect(campur).not.toContain('>Sumber 1<');
    expect(campur.match(/Buka situs resmi/g) ?? []).toHaveLength(3);
  });

  it('sebelum rencana: lima langkah hanya untuk adminduk; urusan informasi tanpa daftar statis', () => {
    expect(langkahPanel(null, 'kelahiran')).toBe(LANGKAH_RENCANA);
    expect(langkahPanel(null, 'pengaduan')).toEqual([]);
    expect(langkahPanel(null, null)).toEqual([]);
    const body = panel({ state: 'MEMAHAMI', jenis: 'pengaduan' });
    expect(body).not.toContain('Masuk akun di situs resmi');
    expect(body).toContain('Langkah muncul di sini setelah Urusin menyusun rencana.');
  });
});
