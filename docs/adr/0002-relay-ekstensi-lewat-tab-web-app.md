# 0002. Komunikasi ekstensi dan harness lewat relay tab web app dengan pairing nonce

- **Status:** Diterima. Rute `/pair` dan pairing di ekstensi sudah ada; kanal sinkron status belum.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D2 (§1.3, §10)

## Konteks dan masalah

Ekstensi perlu menerima langkah dari harness dan melaporkan hasil, tetapi tidak boleh memegang token sesi atau menyentuh vault. Native messaging tidak bisa dipasang juri.

## Keputusan

Web app dan ekstensi berbicara lewat `externally_connectable` dan port, dengan **pairing nonce** dari popup ekstensi dan ID ekstensi yang dipin. Web app berbicara ke server lewat SSE dan POST. Nonce dibawa di fragment URL agar tidak masuk log server. Rencana menambah satu kanal sempit, `POST /api/sync/status`, hanya untuk sinkron status latar yang opt-in.

## Alternatif yang dipertimbangkan

- WebSocket langsung dari ekstensi ke server: layak, tetapi ekstensi harus memegang token sesi dan state menjadi ganda. Disimpan sebagai cadangan.
- Native messaging: butuh instal host OS, tidak bisa dipasang juri. Ditolak.

## Konsekuensi

- Perilaku identik di VPS dan laptop; ekstensi tanpa izin jaringan ke backend, kecuali kanal sinkron status yang direncanakan.
- Tab Urusin harus terbuka selama eksekusi.
- `externally_connectable` diturunkan dari origin aplikasi saat build (`apps/extension/wxt.config.ts`).
