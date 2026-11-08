import type { KeadaanKoneksi, StoreKoneksi } from '#lib/contracts.js';

type NavigatorKoneksi = Navigator & { connection?: { saveData?: boolean } };

/** Online/offline dan mode hemat data (`navigator.connection.saveData`). Aman di SSR (default online). */
export class ConnectivityStore implements StoreKoneksi {
  keadaan = $state<KeadaanKoneksi>({ online: true, hemat: false });

  constructor(
    target: Pick<Window, 'addEventListener'> | undefined = typeof window === 'undefined' ? undefined : window,
  ) {
    if (!target || typeof navigator === 'undefined') return;
    const baca = () => {
      this.keadaan = {
        online: navigator.onLine,
        hemat: (navigator as NavigatorKoneksi).connection?.saveData === true,
      };
    };
    baca();
    target.addEventListener('online', baca);
    target.addEventListener('offline', baca);
  }
}
