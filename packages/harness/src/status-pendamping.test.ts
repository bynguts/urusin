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

  it('demo lihat saja di situs asli: agen tidak boleh mengaku mengisi, dan menjelaskan jalur akun asli', () => {
    const { store, id } = urusanDenganJejak([
      { jenis: 'lihat_saja' },
      { jenis: 'ambil_alih', fase: 'mulai', alasan: 'berhenti' },
      { jenis: 'resi', akhir: 'lihat_saja', hash: H, halaman: 2, aksi: 1, panggilanLlm: 1 },
    ]);
    const s = statusPendamping(store, id)!;
    expect(s).toMatchObject({ lihatSaja: true, kolomDiisi: 0, aiBerakhir: 'lihat_saja' });
    const note = buildStateNote({
      state: 'MENGUNGGAH',
      jenis: 'kelahiran',
      kodeKabKota: '3578',
      tools: [],
      confirmations: [],
      pendamping: s,
    });
    expect(note).toContain('mode lihat saja');
    expect(note).toContain('JANGAN bilang AI sudah, sedang, atau akan mengisi');
    expect(note).toContain('Masuk dengan Google');
    expect(note).not.toContain('AI di layar melanjutkan setelah warga menekan Lanjutkan');
    // Eksekusi biasa (tanpa catatan lihat_saja) tidak berubah.
    expect(barisStatusPendamping({ kolomDiisi: 0, izinKosong: false, giliran: 'ai' })).not.toContain(
      'lihat saja',
    );
  });

  it('demo beralih ke simulasi (executionId sama): catatan mode terakhir berlaku, jejak lihat saja tidak terbawa', () => {
    const { store, id } = urusanDenganJejak([
      { jenis: 'lihat_saja' },
      { jenis: 'ambil_alih', fase: 'mulai', alasan: 'berhenti' },
      { jenis: 'resi', akhir: 'lihat_saja', hash: H, halaman: 2, aksi: 1, panggilanLlm: 1 },
      { jenis: 'simulasi' },
      { jenis: 'persetujuan', rencanaHash: H, n: 2 },
    ]);
    const s = statusPendamping(store, id)!;
    expect(s).toEqual({ kolomDiisi: 2, izinKosong: false, giliran: 'ai', simulasi: true });
    const teks = barisStatusPendamping(s);
    expect(teks).toContain('SIMULASI');
    expect(teks).toContain('mengisi 2 kolom');
    expect(teks).not.toContain('JANGAN bilang AI sudah, sedang, atau akan mengisi');

    // Kembali ke situs asli sesudah simulasi: lihat saja lagi.
    store.appendEvent(id, 'jejak_pendamping', { executionId: X, catatan: { jenis: 'lihat_saja' } });
    expect(statusPendamping(store, id)).toMatchObject({ lihatSaja: true, kolomDiisi: 0 });
  });

  it('jejak eksekusi lama tidak tercampur dengan eksekusi terbaru', () => {
    const { store, id } = urusanDenganJejak([{ jenis: 'persetujuan', rencanaHash: H, n: 4 }]);
    store.appendEvent(id, 'execution_request', { executionId: 'x_baru' });
    expect(statusPendamping(store, id)).toEqual({ kolomDiisi: 0, izinKosong: false, giliran: 'ai' });
  });
});
