import { describe, expect, it } from 'vitest';
import { openHarnessDb } from './db.js';
import { buildStateNote } from './prompt.js';
import { barisStatusPendamping, statusPendamping } from './status-pendamping.js';
import { HarnessStore } from './store.js';

const X = 'x_uji-1';
const H = 'a'.repeat(64);

function urusanDenganJejak(catatan: object[]): { store: HarnessStore; id: string } {
  const store = new HarnessStore(openHarnessDb());
  const id = store.createUrusan({ kodeKabKota: '3578', jenis: 'kelahiran' }).id;
  store.appendEvent(id, 'execution_request', { executionId: X, tool: 'dukcapil__ajukan_layanan' });
  for (const c of catatan) store.appendEvent(id, 'jejak_pendamping', { executionId: X, catatan: c });
  return { store, id };
}

describe('statusPendamping: dasar jujur agen chat tentang isian (QA prod 2026-11-12 Klampid)', () => {
  it('urusan tanpa Browser Pendamping: tidak ada status', () => {
    const store = new HarnessStore(openHarnessDb());
    const id = store.createUrusan({}).id;
    expect(statusPendamping(store, id)).toBeUndefined();
  });

  it('jejak prod Klampid: giliran masuk akun berulang lalu berhenti, tanpa isian = AI belum mengisi apa pun', () => {
    const { store, id } = urusanDenganJejak([
      { jenis: 'ambil_alih', fase: 'mulai', alasan: 'masuk_akun' },
      { jenis: 'ambil_alih', fase: 'selesai' },
      { jenis: 'ambil_alih', fase: 'mulai', alasan: 'masuk_akun' },
      { jenis: 'ambil_alih', fase: 'selesai' },
      { jenis: 'ambil_alih', fase: 'mulai', alasan: 'berhenti' },
      { jenis: 'resi', akhir: 'putaran', hash: H, halaman: 3, aksi: 1, panggilanLlm: 0 },
    ]);
    const s = statusPendamping(store, id)!;
    expect(s).toMatchObject({ kolomDiisi: 0, izinKosong: false, giliran: 'berhenti', aiBerakhir: 'putaran' });
    const note = buildStateNote({
      state: 'MENUNGGU_SUBMIT_WARGA',
      jenis: 'kelahiran',
      kodeKabKota: '3578',
      tools: [],
      confirmations: [],
      pendamping: s,
    });
    expect(note).toContain('AI BELUM mengisi kolom apa pun');
    expect(note).toContain('sudah berhenti');
    expect(note).not.toMatch(/Warga memeriksa isian di layar/);
  });

  it('isian nyata (persetujuan n>0), izin tanpa data (n=0), giliran warga, dan sesi yang sudah ditutup', () => {
    const { store, id } = urusanDenganJejak([
      { jenis: 'persetujuan', rencanaHash: H, n: 3 },
      { jenis: 'persetujuan', rencanaHash: H, n: 0 },
      { jenis: 'ambil_alih', fase: 'mulai', alasan: 'isi_sendiri' },
    ]);
    const s = statusPendamping(store, id)!;
    expect(s).toEqual({ kolomDiisi: 3, izinKosong: true, giliran: 'isi_sendiri' });
    const teks = barisStatusPendamping(s);
    expect(teks).toContain('mengisi 3 kolom');
    expect(teks).toContain('Data Diri');
    expect(teks).toContain('mengisi sendiri kolom yang disorot');

    store.recordExecutionResult(id, X, 'dibatalkan');
    const tutup = barisStatusPendamping(statusPendamping(store, id)!);
    expect(tutup).toContain('sudah ditutup (hasil: dibatalkan)');
    expect(tutup).toContain('jangan menyuruh warga menekan Selesai');
  });

  it('jejak eksekusi lama tidak tercampur dengan eksekusi terbaru', () => {
    const { store, id } = urusanDenganJejak([{ jenis: 'persetujuan', rencanaHash: H, n: 4 }]);
    store.appendEvent(id, 'execution_request', { executionId: 'x_baru' });
    expect(statusPendamping(store, id)).toEqual({ kolomDiisi: 0, izinKosong: false, giliran: 'ai' });
  });
});
