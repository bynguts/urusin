import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Host verify primary + fallback dari deploy/hosts.json (sumber tunggal); persis, tanpa wildcard.
const VERIFY_HOSTS = Object.values(
  JSON.parse(readFileSync(new URL('../../deploy/hosts.json', import.meta.url), 'utf8')) as Record<
    string,
    { verify: string }
  >,
).map((h): `https://${string}.${string}` => `https://${h.verify}` as `https://${string}.${string}`);

// Di dev server lokal (Vite port 5173), set origin publik default agar form action SvelteKit
// tidak ditolak oleh validasi CSRF Origin ketika pengguna membuka lewat browser lokal.
if (!process.env.VITEST && !process.env.URUSIN_PUBLIC_ORIGIN) {
  process.env.URUSIN_PUBLIC_ORIGIN = 'http://localhost:5173';
}
// Di dev server lokal, relaksasikan kuota akun demo per IP agar pengujian lokal tidak terblokir limit 3 akun/hari.
if (!process.env.VITEST && !process.env.URUSIN_DEMO_PER_IP_HARI) {
  process.env.URUSIN_DEMO_PER_IP_HARI = '100';
}

export default defineConfig({
  // Gambar kecil (avatar, ikon objek) tetap berkas terpisah, bukan base64 di JS: JS awal tiap rute punya
  // anggaran 70 KB gzip, sedangkan gambar bisa di-cache dan dimuat tanpa memblokir.
  build: { assetsInlineLimit: 0 },
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
          'frame-src': ['self', ...VERIFY_HOSTS],
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
