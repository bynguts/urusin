/// <reference types="vite/client" />
// Lihat https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      /** Id sesi anonim (cookie urusin_sid); hanya terisi untuk /api/*. */
      sid?: string;
      /** Akun/demo yang masuk (cookie __Host-urusin_akun yang sah); kosong untuk tamu. */
      akun?: import('@urusin/akun').Akun;
      /** Sesi login yang sedang dipakai: hash token ("perangkat ini"), bukti kredensial terakhir, unduhan. */
      akunSesi?: { tokenHash: string; authAt: string; pernahUnduh: boolean };
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
