import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Host verify primary dari deploy/hosts.json (sumber tunggal); persis, tanpa wildcard. Host set fallback (IP
// server) tidak diiklankan di header CSP publik: belum ada halaman yang membingkai host verify.
const VERIFY_HOSTS = [
  (
    JSON.parse(readFileSync(new URL('../../deploy/hosts.json', import.meta.url), 'utf8')) as {
      primary: { verify: string };
    }
  ).primary,
].map((h): `https://${string}.${string}` => `https://${h.verify}` as `https://${string}.${string}`);
// Widget Cloudflare Turnstile di /masuk (juri, masuk setelah 3 gagal); dimuat hanya bila kuncinya dikonfigurasi.
const TURNSTILE = 'https://challenges.cloudflare.com';

export default defineConfig(({ command, mode }) => {
  // Hanya `vite dev` lokal (bukan build, preview, Vitest, atau e2e): origin publik default agar form action
  // SvelteKit tidak ditolak validasi CSRF Origin, dan kuota akun demo per IP dilonggarkan untuk uji manual.
  if (command === 'serve' && mode === 'development') {
    process.env.URUSIN_PUBLIC_ORIGIN ||= 'http://localhost:5173';
    process.env.URUSIN_DEMO_PER_IP_HARI ||= '100';
  }
  return {
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
            'script-src': ['self', TURNSTILE],
            // Transisi Svelte menyisipkan <style>; dengan 'unsafe-inline' SvelteKit tidak menambah nonce gaya.
            'style-src': ['self', 'unsafe-inline'],
            'img-src': ['self', 'data:', 'blob:'],
            'font-src': ['self'],
            'connect-src': ['self'],
            'worker-src': ['self'],
            'manifest-src': ['self'],
            'object-src': ['none'],
            'base-uri': ['self'],
            // Tombol Google = formulir GET ke /auth/google yang dialihkan ke Google; Chrome menegakkan form-action pada
            // pengalihan, jadi origin otorisasi Google harus diizinkan (tanpa ini tombol diam).
            'form-action': ['self', 'https://accounts.google.com'],
            'frame-src': ['self', TURNSTILE, ...VERIFY_HOSTS],
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
  };
});
