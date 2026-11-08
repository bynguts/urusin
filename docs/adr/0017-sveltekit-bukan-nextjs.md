# 0017. SvelteKit (Svelte 5) dengan adapter-node, bukan Next.js

- **Status:** Diterima. Terimplementasi di `apps/web`; menggantikan rencana awal Next.js.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D17 (§1.3, §10)

## Konteks dan masalah

Keputusan tim: stack web "paling maksimal dan ringan". Pengguna sasaran memakai HP kelas bawah, dan anggaran JS awal beranda adalah 70 KB gzip (`pnpm budget`).

## Keputusan

SvelteKit (Svelte 5, versi dipin exact) dengan `@sveltejs/adapter-node`: runtime terkecil karena komponen dikompilasi, server routes dalam proses Node yang berjalan lama (harness in-process dan SSE), SSR dan form actions untuk progressive enhancement tanpa JavaScript, dan CSP nonce bawaan (`kit.csp`).

## Alternatif yang dipertimbangkan

- Next.js (App Router), rencana awal: ekosistem terbesar, tetapi runtime React dan RSC lebih berat untuk HP murah dan anggaran 70 KB sulit dipenuhi.
- Astro dengan islands: chat, vault, dan SSE sangat interaktif sehingga hampir semuanya menjadi island; endpoint kurang cocok untuk harness proses panjang.
- Remix atau React Router v7: tetap membawa runtime React.

## Konsekuensi

- Ekosistem dan keakraban tim lebih kecil daripada React; komponen siap pakai lebih sedikit.
- Anggaran bundel ditegakkan: README mencatat sekitar 38 KB gzip untuk JS awal beranda.
