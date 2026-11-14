import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { EventOf, UrusinEvent } from '#lib/contracts.js';
import { keadaanAwal, terapkanEvent } from '#lib/stores/reduksi.js';
import KartuBerkas from './KartuBerkas.svelte';
import { pecahPenanda, penandaLampiran } from './komposer.js';
import { bangunLinimasa, labelAktivitas } from './linimasa.js';

const at = '2026-11-14T03:00:00.000Z';
const berkas = {
  seq: 3,
  at,
  chainHead: 'h',
  type: 'berkas',
  id: `dok_${'a'.repeat(32)}`,
  nama: 'Surat Kuasa Pengambilan Akta.docx',
  format: 'docx',
  mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ukuran: 12_800,
  judul: 'SURAT KUASA',
} as EventOf<'berkas'>;

describe('kartu berkas di linimasa', () => {
  it('event berkas jadi kartu sendiri di urutannya; teks sesudahnya gelembung baru', () => {
    const out = bangunLinimasa(
      [
        { seq: 2, at, chainHead: 'h', type: 'assistant_text', delta: 'Sebentar…' } as UrusinEvent,
        berkas,
        {
          seq: 4,
          at,
          chainHead: 'h',
          type: 'assistant_text',
          delta: 'Surat kuasa siap diunduh.',
        } as UrusinEvent,
      ],
      [],
    );
    expect(out.map((x) => x.jenis)).toEqual(['teks', 'berkas', 'teks']);
    expect(out[1]).toMatchObject({ jenis: 'berkas', key: 'e3', e: { id: berkas.id } });
  });

  it('label aktivitas berkas__buat: "Membuat berkas…"', () => {
    const prog = {
      seq: 1,
      at,
      chainHead: 'h',
      type: 'progress',
      label: 'Menjalankan berkas__buat…',
      toolName: 'berkas__buat',
    } as UrusinEvent;
    expect(labelAktivitas([prog])).toBe('Membuat berkas…');
  });

  it('reducer menerima event berkas tanpa mengubah status giliran', () => {
    const awal = keadaanAwal();
    const next = terapkanEvent(awal, berkas);
    expect(next.events.at(-1)).toMatchObject({ type: 'berkas' });
    expect(next.sedangBerjalan).toBe(awal.sedangBerjalan);
  });

  it('kartu: nama, format, ukuran, tombol Unduh', () => {
    const { body } = render(KartuBerkas, { props: { berkas } });
    expect(body).toContain('Surat Kuasa Pengambilan Akta.docx');
    expect(body).toContain('Word (DOCX)');
    expect(body).toContain('13 KB');
    expect(body).toContain('Unduh');
    expect(body).toContain('data-berkas');
  });

  it('penanda lampiran DOCX dikenali dua arah', () => {
    const p = penandaLampiran('lainnya', berkas.mime);
    expect(p).toBe('[warga melampirkan dokumen: Dokumen lain (DOCX)]');
    expect(pecahPenanda(`${p}\ntolong isikan`)).toEqual({
      lampiran: [{ label: 'Dokumen lain', bentuk: 'DOCX' }],
      teks: 'tolong isikan',
    });
  });
});
