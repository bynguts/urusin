import { AkunError } from '@urusin/akun';
import { fail, type ActionFailure } from '@sveltejs/kit';

/**
 * Form action halaman akun (App 15–20). Galat dikembalikan sebagai `form` = `{kode, pesanWarga, email?}`;
 * sandi TIDAK pernah dikembalikan ke halaman.
 */
export type GalatForm = { kode: string; pesanWarga: string; email?: string };

export function teks(form: FormData, nama: string): string {
  const v = form.get(nama);
  return typeof v === 'string' ? v : '';
}

/** AkunError → fail(status, {kode, pesanWarga}); galat lain dilempar ulang (500 tanpa detail). */
export function gagalForm(e: unknown, email?: string): ActionFailure<GalatForm> {
  if (e instanceof AkunError)
    return fail(e.status, { kode: e.kode, pesanWarga: e.pesanWarga, ...(email ? { email } : {}) });
  throw e;
}
