/** Warga memilih kurangi gerakan (sistem: prefers-reduced-motion, atau Pengaturan: data-gerak="kurang"). */
export function gerakDikurangi(): boolean {
  if (typeof window === 'undefined') return true;
  return (
    matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.dataset.gerak === 'kurang'
  );
}
