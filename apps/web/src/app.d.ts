/// <reference types="vite/client" />
// Lihat https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      /** Id sesi anonim (cookie urusin_sid); hanya terisi untuk /api/*. */
      sid?: string;
      /** Akun yang masuk (cookie __Host-urusin_akun yang sah); kosong untuk tamu. */
      akun?: { id: string; email: string; emailTerverifikasi: boolean };
      /** SHA-256 token sesi yang sedang dipakai (untuk menandai "perangkat ini"). */
      akunTokenHash?: string;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
