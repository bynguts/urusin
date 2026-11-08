# Urusin

Agen AI yang ikut mengurus layanan publik bersama warga: membaca syarat dari sumber resmi, membantu
mengisi formulir di situs pemerintah, dan selalu menyerahkan tombol kirim terakhir kepada warga.

> Status: fondasi hari pertama. README ini hanya menjelaskan apa yang sudah ada di repositori;
> bagian yang belum dikerjakan ditandai **akan dilengkapi**.

## 1. Tim & anggota

| Peran                        | Anggota         | GitHub                                 |
| ---------------------------- | --------------- | -------------------------------------- |
| Anggota A (web, gateway LLM) | Tim Urusin      | [@bynguts](https://github.com/bynguts) |
| Anggota B                    | akan dilengkapi | akan dilengkapi                        |

## 2. Kategori, nama, deskripsi, masalah, target

- **Kategori:** Web
- **Nama:** Urusin
- **Deskripsi:** pendamping digital untuk urusan administrasi publik (akta, KK, KTP, pindah domisili,
  pengaduan, cek data publik). Urusin menyusun langkah dari sumber resmi lalu menemani warga mengisi
  formulir di situs resmi; pengiriman akhir selalu dilakukan warga sendiri.
- **Masalah:** akan dilengkapi dengan hasil riset pengguna dan angka yang sudah diverifikasi (URL sumber
  dan tanggal akses). Kami tidak mencantumkan angka sebelum terverifikasi.
- **Target pengguna:** perantau, keluarga yang sedang mengalami peristiwa hidup (kelahiran, kematian,
  perkawinan, pindah), dan warga lansia lewat pendamping. Dirancang untuk HP lebih dulu.

## 3. Fitur

Yang sudah berjalan saat ini:

- Kerangka aplikasi web (SvelteKit + adapter-node) berbahasa Indonesia: beranda dengan empat Peristiwa
  Hidup (Kelahiran, Kematian, Perkawinan, Pindah) dan "Urusan lain", navigasi bawah di HP, dua panel di
  layar ≥ 1024 px. Beranda tetap bisa dipakai tanpa JavaScript.
- `GET /api/health` mengembalikan `{ status, gitSha }`; footer menampilkan `v<sha7>` build yang berjalan.
- `@urusin/core`: Step DSL adapter (`nav`, `waitFor`, `fill`, `select`, `upload`, `click`, `verify`,
  `extract`, `gate.human`) dengan validator yang menolak `click` ber-effect `final` di luar `gate.human`
  dan setiap `write` tanpa `verify`; grammar placeholder `{{PEMOHON.NIK}}` dan guard `noPlaceholder()`
  untuk parameter yang ditulis model; registry 11 domain resmi dengan pencocokan origin persis.
- `@urusin/llm`: gateway OpenAI-compatible (Chat Completions), capability probe, tangga structured
  output, akumulator stream tool call, meter biaya, dan FakeProvider untuk pengujian.

Fitur agen, ekstensi peramban, MCP, RAG, PWA, dan pengingat: **akan dilengkapi**.

## 4. Teknologi

| Lapisan          | Pilihan                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| Bahasa & runtime | TypeScript (strict), Node.js 26, pnpm 11, Turborepo                      |
| Web              | SvelteKit 3 + Svelte 5, `@sveltejs/adapter-node`, Vite 8, Tailwind CSS 4 |
| LLM              | SDK resmi `openai` ke endpoint OpenAI-compatible (Chat Completions saja) |
| Validasi         | zod 4                                                                    |
| Pengujian        | Vitest, `node:test` untuk skrip repositori                               |
| Kualitas         | ESLint (flat config), Prettier, commitlint, husky                        |
| CI               | GitHub Actions (tanpa bot yang membuat commit, tanpa Dependabot)         |

## 5. Arsitektur

```
apps/web          SvelteKit: UI + endpoint server (harness akan berjalan in-process)
packages/core     skema, Step DSL, placeholder guard, registry domain resmi, kode error
packages/llm      gateway OpenAI-compatible + capability probe + FakeProvider
scripts/          pii-scan, audit-history, pemeriksa pesan commit
```

Prinsip yang sudah dikodekan:

- Data pribadi tidak dikirim ke model: model hanya boleh menulis parameter tanpa placeholder/NIK/HP/email;
  nilai asli diisi dari vault di sisi eksekutor lewat placeholder.
- Pengiriman akhir hanya lewat `gate.human` (warga menekan tombolnya sendiri).
- Hanya origin `https://` yang terdaftar persis di registry yang dianggap resmi.

Diagram alur data, aliran PII, dan state machine: **akan dilengkapi**.

## 6. Instalasi & menjalankan

Prasyarat: Node.js 26 (lihat `.nvmrc`) dan pnpm 11.

```bash
pnpm install
cp .env.example .env        # isi nilai sendiri; jangan commit .env
pnpm dev                    # server pengembangan
pnpm lint && pnpm typecheck && pnpm test
pnpm build                  # build produksi
pnpm budget                 # cek anggaran JS awal beranda (≤ 70 KB gzip)
node apps/web/build         # jalankan hasil build (set PORT dan ORIGIN)
```

Variabel lingkungan lengkap ada di `.env.example`. Panduan deploy (Docker Compose di VPS), ekstensi,
dan pemasangan PWA: **akan dilengkapi**.

## 7. Akun demonstrasi

Saat ini aplikasi tidak memerlukan login. Akun demonstrasi untuk situs tiruan (fixture): **akan
dilengkapi**. Situs pemerintah selalu memakai akun pribadi warga dan tidak pernah dibagikan.

## 8. Dokumentasi AI

- **AI di dalam produk:** gateway memakai SDK `openai` ke penyedia OpenAI-compatible yang dipilih lewat
  env (`LLM_BASE_URL`, `LLM_AGENT_MODEL`, `LLM_VISION_MODEL`, `LLM_TRANSCRIBE_MODEL`,
  `LLM_EMBED_MODEL`). Penyedia, model per peran, dan hasil capability probe nyata: **akan dilengkapi**.
- **AI saat pengembangan:** kami memakai AI coding assistant (Claude Code) untuk membantu menulis dan
  meninjau kode, konfigurasi, dan dokumentasi. Setiap perubahan ditinjau dan di-commit oleh anggota tim.
  Atribusi co-author otomatis dimatikan (`.claude/settings.json`) dan penggunaan AI diungkap di bagian ini.

## 9. Atribusi

Pustaka sumber terbuka utama: SvelteKit, Svelte, Vite, Tailwind CSS, `openai` (SDK resmi), zod,
Turborepo, Vitest, ESLint, Prettier, commitlint, husky. Daftar sumber data publik (URL + tanggal akses),
kode wilayah, dan formulir resmi: **akan dilengkapi**.

## Efisiensi Sumber Daya

- Anggaran performa: JS awal beranda ≤ 70 KB gzip, dicek otomatis di CI (`pnpm budget`). Hasil saat ini:
  sekitar 38 KB gzip.
- Font sistem dan ikon SVG inline: tidak ada unduhan font atau pustaka ikon.
- Meter biaya LLM dari `usage` × harga di env (`LLM_PRICE_*`) sudah tersedia di `@urusin/llm`.

## Keamanan & Privasi

- CSP tunggal dari SvelteKit (nonce per request), termasuk `worker-src 'self'`, `manifest-src 'self'`,
  `object-src 'none'`, dan `frame-ancestors 'none'`.
- Hook `pre-commit` memindai NIK, nomor HP, email, dan private key sebelum commit; CI memindai ulang
  semua file terlacak.
- `.gitignore` defensif untuk `.env*`, basis data, hasil riset, dan laporan pengujian.
- Threat model dan DPIA ringkas: **akan dilengkapi**.

## Pengujian

```bash
pnpm test
```

Mencakup Step DSL dan validatornya, guard placeholder/PII, registry domain beserta jebakan lookalike,
tangga structured output, akumulator stream tool call (6 rekaman gaya provider), matriks "tanpa X"
capability probe, endpoint health, serta pemindai PII dan audit riwayat commit.

## Batasan yang diketahui

- Baru fondasi: belum ada agen, ekstensi peramban, adapter situs, MCP, RAG, PWA, atau pengingat.
- Domain di registry masih berupa seed; tanggal verifikasi manual tiap domain belum dicatat.
- Capability probe belum dijalankan terhadap penyedia nyata.

## Lisensi

[MIT](LICENSE) © 2026 Tim Urusin
