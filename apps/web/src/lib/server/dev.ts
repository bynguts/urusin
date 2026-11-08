/**
 * True hanya saat `vite dev` (DEV diganti konstanta saat build: produksi selalu false, tanpa bergantung env var).
 * Dipakai untuk rute yang tidak boleh ada di produksi, mis. /dev/fixtures/sse.
 */
export const isDev = (): boolean => import.meta.env.DEV === true;
