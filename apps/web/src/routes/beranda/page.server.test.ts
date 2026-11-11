import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { actions } from './+page.server';

/** Action `mulai` Beranda wajib login seperti `load`; tamu tidak boleh memulai urusan lewat /beranda. */
describe('/beranda ?/mulai', () => {
  it('tamu tanpa akun dialihkan ke /masuk sebelum urusan dibuat', async () => {
    const event = {
      request: new Request('http://localhost:3000/beranda?/mulai', { method: 'POST', body: new FormData() }),
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
    expect(lokasi).toBe('/masuk');
  });
});
