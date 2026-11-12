import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { actions } from './+page.server';

/** Action `mulai` Beranda wajib akun: tanpa sesi ke /daftar lalu kembali ke Beranda, sebelum urusan dibuat. */
describe('/beranda ?/mulai', () => {
  it('tanpa sesi dialihkan ke /daftar?next=/beranda sebelum urusan dibuat', async () => {
    const body = new FormData();
    body.set('pesan', 'Mau urus akta kelahiran');
    const event = {
      request: new Request('http://localhost:3000/beranda?/mulai', { method: 'POST', body }),
      url: new URL('http://localhost:3000/beranda?/mulai'),
      locals: {} as App.Locals,
    } as never;
    let lokasi = '';
    try {
      await actions.mulai!(event);
    } catch (e) {
      if (!isRedirect(e)) throw e;
      lokasi = e.location;
    }
    expect(lokasi).toBe(`/daftar?next=${encodeURIComponent('/beranda')}`);
  });
});
