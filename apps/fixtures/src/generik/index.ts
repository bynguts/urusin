import type { Hono } from 'hono';
import { html, page } from '../layout.js';
import { registerAkun } from './akun.js';
import { KOREKSI, registerKoreksi } from './koreksi.js';
import { registerPoisonedGenerik, RACUN } from './poisoned-generik.js';
import { registerTanpaAkun } from './tanpa-akun.js';
import { buatPenghitung, GENERIK, VARIAN_LOKAL, VARIAN_PUBLIK, type Varian } from './umum.js';
import { registerWizard } from './wizard.js';

export { GENERIK } from './umum.js';
export const REPLIKA_GENERIK = ['akun', 'tanpa-akun', 'wizard'] as const;

/**
 * Pasang tiga replika portal generik (`/generik/<varian>/<replika>/`) dan penghitung pengiriman
 * (`GET /generik/_hitung`). Varian `injeksi`/`umpan` dan halaman racun hanya di profil local (ADR 0012).
 */
export function registerGenerik(app: Hono, opts: { secure: boolean; local: boolean }) {
  const hitung = buatPenghitung();
  const varian: readonly Varian[] = opts.local ? [...VARIAN_PUBLIK, ...VARIAN_LOKAL] : VARIAN_PUBLIK;
  const o = { varian, secure: opts.secure, local: opts.local, hitung };

  app.get(`${GENERIK}/_hitung`, (c) => c.json(hitung.semua()));
  app.get(`${GENERIK}/`, (c) =>
    c.html(
      page(
        'Replika portal generik',
        html`<p>Tiga bentuk portal layanan kependudukan tiruan untuk uji Navigator.</p>
          <ul>
            ${varian.map(
              (v) =>
                html`<li>
                  ${v}: ${REPLIKA_GENERIK.map((r) => html`<a href="${GENERIK}/${v}/${r}/">${r}</a> `)}
                </li>`,
            )}
          </ul>
          <p><a href="${KOREKSI}/">Wizard yang menolak pilihan pertama (koreksi)</a></p>
          ${opts.local ? html`<p><a href="${RACUN}/">Halaman racun (local)</a></p>` : ''}`,
      ),
    ),
  );
  registerAkun(app, o);
  registerTanpaAkun(app, o);
  registerWizard(app, o);
  registerKoreksi(app, o);
  if (opts.local) registerPoisonedGenerik(app, hitung);
  return hitung;
}
