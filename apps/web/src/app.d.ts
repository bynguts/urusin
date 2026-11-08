/// <reference types="vite/client" />
// Lihat https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      /** Id sesi anonim (cookie urusin_sid); hanya terisi untuk /api/*. */
      sid?: string;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
