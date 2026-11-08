# 0005. Adapter situs berupa DSL deklaratif bertipe dengan effect per operasi

- **Status:** Diterima. DSL dan validator sudah ada di `packages/core/src/dsl.ts`.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D5 (§1.3, §10)

## Konteks dan masalah

Langkah di situs pemerintah tidak boleh ditulis atau dipilih oleh LLM, dan operasi yang mengubah data harus bisa dibatasi secara statis.

## Keputusan

Adapter ditulis sebagai DSL deklaratif bertipe (`nav`, `waitFor`, `fill`, `select`, `upload`, `click`, `verify`, `extract`, `gate.human`) dengan `effect` per operasi (`read`, `input`, `write`, `final`). Validator menolak `click` ber-effect `final` di luar `gate.human` dan setiap `write` tanpa `verify`.

## Alternatif yang dipertimbangkan

- Skrip imperatif bebas: tidak bisa divalidasi secara statis.
- Selector yang dipilih LLM: melanggar batas bahwa LLM hanya memutuskan "apa", bukan "bagaimana".

## Konsekuensi

- Pengiriman akhir hanya mungkin lewat `gate.human`.
- Setiap situs butuh adapter yang dirawat bila DOM berubah; drift dideteksi dan jatuh ke mode dipandu.
