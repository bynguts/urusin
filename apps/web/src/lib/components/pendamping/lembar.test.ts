import { validasiRencana } from '@urusin/navigator';
import type { ElemenAmatan, Pengamatan } from '@urusin/contracts';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import LembarIzinkan from './LembarIzinkan.svelte';

const HP = '{{PEMOHON.HP}}';
const PERINGATAN = /jarang meminta Nomor HP/;

/** Halaman satu kolom: validator web menghasilkan baris lembar (termasuk `tidakLazim`), lalu lembar dirender. */
function lembarUntuk(kolom: ElemenAmatan): string {
  const p: Pengamatan = {
    v: 1,
    seq: 1,
    host: 'portal.contoh.go.id',
    jalur: '/daftar',
    judul: 'Pendaftaran',
    sinyal: {
      login: false,
      otp: false,
      captcha: false,
      tantangan: false,
      halamanAkhir: false,
      sukses: false,
      galatForm: false,
    },
    elemen: [kolom],
    teks: '',
    sidik: 'sidik-uji',
  };
  const v = validasiRencana({ aksi: [{ jenis: 'isi', ref: kolom.ref, nilai: HP }] }, p);
  if (!v.ok) throw new Error(`rencana ditolak: ${v.aturan.join(',')}`);
  return render(LembarIzinkan, {
    props: {
      buka: true,
      placeholder: [HP],
      berkas: [],
      kolom: v.kolom,
      rencanaHash: v.rencanaHash,
      onizinkan: () => {},
      ontolak: () => {},
    },
  }).body;
}

describe('LembarIzinkan: peringatan "jarang meminta" hanya bila kolom memang meragukan', () => {
  it.each<[string, ElemenAmatan]>([
    [
      'placeholder 0819xxxx (QA Bandar Lampung)',
      { ref: 'e1', peran: 'teks', nama: 'Kontak', petunjuk: '0819xxxxxxxx' },
    ],
    ['label No. HP', { ref: 'e1', peran: 'teks', nama: 'No. HP', petunjuk: '0819xxxxxxxx' }],
    ['label Nomor Telepon', { ref: 'e1', peran: 'teks', nama: 'Nomor Telepon' }],
    ['label WhatsApp', { ref: 'e1', peran: 'teks', nama: 'WhatsApp' }],
    ['type/autocomplete tel', { ref: 'e1', peran: 'teks', nama: 'Kontak', isyarat: 'tel' }],
  ])('%s: tanpa peringatan', (_, kolom) => {
    const html = lembarUntuk(kolom);
    expect(html).toContain('Nomor HP');
    expect(html).not.toMatch(PERINGATAN);
  });

  it('Nomor HP ke kolom "Nama Ibu": peringatan tampil', () => {
    const html = lembarUntuk({ ref: 'e1', peran: 'teks', nama: 'Nama Ibu', isyarat: 'nama' });
    expect(html).toMatch(PERINGATAN);
  });
});
