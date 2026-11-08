export type RegistryErrorCode = 'NIK_INVALID' | 'KODE_INVALID';

/** Pesan sengaja generik: tidak pernah memuat nilai masukan (NIK). */
export class RegistryError extends Error {
  readonly code: RegistryErrorCode;
  constructor(code: RegistryErrorCode) {
    super(code === 'NIK_INVALID' ? 'Format NIK tidak valid.' : 'Kode kab/kota tidak valid.');
    this.name = 'RegistryError';
    this.code = code;
  }
}
