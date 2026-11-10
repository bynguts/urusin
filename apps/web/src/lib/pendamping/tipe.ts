/**
 * Tipe Browser Pendamping untuk UI: satu sumber, langsung dari `@urusin/contracts` (pesan dan status sesi) dan
 * `@urusin/pendamping-client` (viewer). Nama lama dipertahankan sebagai alias agar komponen tidak berubah.
 */
import type { PendampingEvent } from '@urusin/contracts';
import type { createPendampingViewer } from '@urusin/pendamping-client';

export type {
  KolomButuh,
  PendampingBukti,
  PendampingEvent,
  PendampingHasil,
  PendampingMode,
  PendampingStatus,
  SesiPendamping,
} from '@urusin/contracts';
export type {
  JenisFokus,
  ViewerEvents,
  ViewerOptions as OpsiViewer,
  PendampingViewer as ViewerPendamping,
  ViewerStatus as KoneksiViewer,
} from '@urusin/pendamping-client';

export type AlasanGiliran = Extract<PendampingEvent, { jenis: 'giliran_anda' }>['alasan'];

/** `createPendampingViewer` dari `@urusin/pendamping-client`. */
export type PabrikViewer = typeof createPendampingViewer;
