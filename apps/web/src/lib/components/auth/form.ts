import { page } from '$app/state';

/**
 * Akses longgar ke `page.form` / `page.data` layar akun. Server (form action + load) berada di branch
 * feat/auth-akun; dengan membaca lewat `$app/state`, layar ini tetap bisa di-typecheck di main dan tidak
 * bentrok saat merge. Bentuk mengikuti docs/ui/auth.md.
 */
export type GalatAuth = { kode: string; pesanWarga: string; email?: string };
export type FormAuth = Partial<GalatAuth> & {
  terkirim?: true;
  /** Email tertunda/ditahan: tampilkan pesan jujur (docs/ui/auth.md). */
  tertunda?: boolean;
  berhasil?: true;
  email?: string;
};

export function formAuth(): FormAuth | null {
  return (page.form as FormAuth | null | undefined) ?? null;
}

export function galatAuth(): GalatAuth | null {
  const f = formAuth();
  if (f?.kode && f.pesanWarga) return { kode: f.kode, pesanWarga: f.pesanWarga };
  const g = (page.data as { galat?: GalatAuth | null }).galat;
  return g ?? null;
}

export function dataAuth<T extends object>(): Partial<T> {
  return page.data as Partial<T>;
}
