import { describe, expect, it } from 'vitest';
import { panelSesiDemo } from './urusan-status.js';

const lihat = { lihatSaja: true };
const sim = { simulasi: true };
const p = (situs: object | null, keadaan: string, extra: { alasan?: string; menungguIzin?: boolean } = {}) =>
  panelSesiDemo({
    situs,
    keadaan,
    giliran: extra.alasan ? { alasan: extra.alasan } : null,
    menungguIzin: extra.menungguIzin ?? false,
  });

describe('panelSesiDemo: panel Rencana mengikuti sesi demo nyata', () => {
  it('sesi biasa atau tanpa sesi: undefined (panel lima langkah urusan)', () => {
    expect(p({}, 'ai')).toBeUndefined();
    expect(p(null, 'ai')).toBeUndefined();
    expect(p(lihat, 'mati')).toBeUndefined();
  });

  it('lihat saja: menyiapkan/AI di langkah 2, giliran di langkah 3, selesai melewati semua langkah', () => {
    expect(p(lihat, 'menyiapkan')).toMatchObject({ sekarang: 2, label: 'Menyiapkan browser', nada: 'ai' });
    expect(p(lihat, 'ai')).toMatchObject({ sekarang: 2, label: 'AI melihat-lihat situs' });
    expect(p(lihat, 'giliran', { alasan: 'verifikasi' })).toMatchObject({ sekarang: 3, nada: 'anda' });
    const s = p(lihat, 'berakhir')!;
    expect(s.sekarang).toBe(s.langkah.length + 1);
    // Tidak ada langkah masuk akun, isi, atau Kirim di mode lihat saja.
    expect(s.langkah.map((l) => l.judul).join(' ')).not.toMatch(/Kirim|Masuk akun/);
  });

  it('simulasi: siap -> izin -> AI mengisi -> tekan Kirim (simulasi) -> selesai', () => {
    expect(p(sim, 'antre')).toMatchObject({ sekarang: 1 });
    expect(p(sim, 'giliran', { menungguIzin: true })).toMatchObject({ sekarang: 2, nada: 'anda' });
    expect(p(sim, 'ai')).toMatchObject({ sekarang: 3, label: 'AI sedang mengisi' });
    expect(p(sim, 'giliran', { alasan: 'final' })).toMatchObject({ sekarang: 4, nada: 'anda' });
    expect(p(sim, 'selesai')).toMatchObject({ sekarang: 5, label: 'Simulasi selesai', nada: 'selesai' });
  });
});
