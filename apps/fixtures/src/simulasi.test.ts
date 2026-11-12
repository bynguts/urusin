import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { BANNER_TEXT } from './layout.js';

const O = 'http://localhost:4320';

describe('formulir simulasi replika (demo juri tanpa dinding login)', () => {
  it.each(['', '/sby', '/smg'])(
    'awalan "%s": formulir, kirim menghitung kolom terisi, halaman terkirim',
    async (awalan) => {
      const app = createApp({ profile: 'public', port: 4320, publicOrigin: undefined });
      const form = await app.request(`${O}${awalan}/simulasi/formulir`);
      expect(form.status).toBe(200);
      const html = await form.text();
      expect(html).toContain(BANNER_TEXT);
      for (const id of ['nama', 'nik', 'tempat_lahir', 'tanggal_lahir', 'alamat', 'hp'])
        expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`action="${awalan}/simulasi/kirim"`);
      expect(html).toContain('id="kirim"');

      const kirim = await app.request(`${O}${awalan}/simulasi/kirim`, {
        method: 'POST',
        headers: {
          host: 'localhost:4320',
          origin: O,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ nama: 'Contoh', alamat: 'Jl. Contoh', hp: '' }).toString(),
      });
      expect(kirim.status).toBe(303);
      expect(kirim.headers.get('location')).toBe(`${awalan}/simulasi/terkirim`);
      expect(await (await app.request(`${O}${awalan}/simulasi/_terisi`)).json()).toEqual({ terisi: 2 });
      expect(await (await app.request(`${O}${awalan}/simulasi/terkirim`)).text()).toContain(
        'simulasi-terkirim',
      );
    },
  );
});
