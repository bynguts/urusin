# 0008. Monorepo pnpm + Turborepo dengan WXT untuk ekstensi

- **Status:** Diterima. Terimplementasi.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D8 (§1.3, §10)

## Konteks dan masalah

Dua anggota tim mengerjakan web, ekstensi, fixture, dan beberapa paket yang saling bergantung; build dan tes harus konsisten antara lokal dan CI.

## Keputusan

pnpm workspaces (`apps/*`, `packages/*`) dengan Turborepo untuk `build`, `lint`, `typecheck`, `test`, `budget`, dan `e2e`. Ekstensi MV3 memakai WXT. TypeScript strict, versi dependensi dipin exact.

## Alternatif yang dipertimbangkan

- Tidak ada alternatif yang dievaluasi secara formal di rencana (D8 hanya menyatakan pilihan).

## Konsekuensi

- Satu lockfile, cache build lewat Turborepo, dan `pnpm install --frozen-lockfile` di CI dan image.
- Versi mesin dikunci: Node 26 (`.nvmrc`), pnpm 11.
