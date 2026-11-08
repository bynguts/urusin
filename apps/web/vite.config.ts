import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Paksa mode runes untuk kode proyek (bukan library). Bisa dihapus di Svelte 6.
        runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
      },
      adapter: adapter(),
      // CSP tunggal milik aplikasi (Caddy tidak mengirim CSP). Nonce per request untuk halaman dinamis;
      // halaman prerender memakai hash via <meta>. Halaman /verify kelak mengirim CSP sendiri dari +server.ts.
      csp: {
        mode: 'auto',
        directives: {
          'default-src': ['self'],
          'script-src': ['self'],
          // Transisi Svelte menyisipkan <style>; dengan 'unsafe-inline' SvelteKit tidak menambah nonce gaya.
          'style-src': ['self', 'unsafe-inline'],
          'img-src': ['self', 'data:', 'blob:'],
          'font-src': ['self'],
          'connect-src': ['self'],
          'worker-src': ['self'],
          'manifest-src': ['self'],
          'object-src': ['none'],
          'base-uri': ['self'],
          'form-action': ['self'],
          'frame-ancestors': ['none'],
          // Pelaporan pelanggaran: report-uri untuk browser lama, report-to merujuk endpoint
          // `csp-endpoint` dari header Reporting-Endpoints (dikirim Caddy, lihat deploy/Caddyfile.urusin).
          'report-uri': ['/api/csp-report'],
          'report-to': ['csp-endpoint'],
        },
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
