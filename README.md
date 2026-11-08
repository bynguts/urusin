# Urusin

[![CI](https://github.com/bynguts/urusin/actions/workflows/ci.yml/badge.svg)](https://github.com/bynguts/urusin/actions/workflows/ci.yml)
[![Release image](https://github.com/bynguts/urusin/actions/workflows/release.yml/badge.svg)](https://github.com/bynguts/urusin/actions/workflows/release.yml)
<!-- Badge coverage sengaja belum ada: angka coverage dihitung lokal (`pnpm coverage`) dan belum dipublikasikan oleh CI. Tambahkan badge hanya bila datanya berasal dari CI. -->

Agen AI yang ikut mengurus layanan publik bersama warga: membaca syarat dari sumber resmi, membantu
mengisi formulir di situs pemerintah, dan selalu menyerahkan tombol kirim terakhir kepada warga.

> Status: fondasi hari pertama. README ini hanya menjelaskan apa yang sudah ada di repositori;
> bagian yang belum dikerjakan ditandai **akan dilengkapi**.

## 1. Tim & anggota

| Peran                                                    | Anggota                        | Kampus                      | GitHub                                     |
| -------------------------------------------------------- | ------------------------------ | --------------------------- | ------------------------------------------ |
| Ketua — harness agen, AI/LLM, RAG, UI, VPS               | Muhammad Muqorrobin Al Anshori | President University        | [@bynguts](https://github.com/bynguts)     |
| Anggota — ekstensi, adapter layanan & kota, fixture, e2e | Rafi Cahya Mahardika           | Universitas Negeri Surabaya | [@rafilajhh](https://github.com/rafilajhh) |

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

| Lapisan          | Pilihan                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Bahasa & runtime | TypeScript (strict), Node.js 26, pnpm 11, Turborepo                                                                      |
| Web              | SvelteKit 3 + Svelte 5, `@sveltejs/adapter-node`, Vite 8, Tailwind CSS 4                                                 |
| LLM              | SDK resmi `openai` ke endpoint OpenAI-compatible (Chat Completions saja)                                                 |
| Validasi         | zod 4                                                                                                                    |
| Pengujian        | Vitest, `node:test` untuk skrip repositori                                                                               |
| Kualitas         | ESLint (flat config), Prettier, commitlint, husky                                                                        |
| Basis data       | SQLite (`better-sqlite3`, mode WAL); pencarian BM25 lewat FTS5                                                           |
| Vektor (RAG)     | Cosine brute-force di JS atas blob SQLite, transform center/whiten opsional digerbang eval. Bukan `sqlite-vec`           |
| Proxy & TLS      | Caddy milik host bersama (VPS), meneruskan ke `127.0.0.1:4310`; Caddy tidak mengirim CSP                                 |
| CSP              | SvelteKit `kit.csp` mode `auto` (nonce untuk halaman dinamis, hash untuk prerender)                                      |
| CI & rilis       | GitHub Actions (tanpa bot yang membuat commit, tanpa Dependabot); image multi-arch ke GHCR, di-deploy berdasarkan digest |

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

Diagram C4 (konteks dan kontainer) serta alur data PII ada di [`docs/arsitektur.md`](docs/arsitektur.md). State machine harness: **akan dilengkapi**.

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

Login tidak wajib: **"Coba tanpa daftar"** (mode tamu) membuka semua fitur tanpa akun. Akun dibutuhkan
hanya agar Data Diri, dokumen, dan urusan ikut ke perangkat lain (HP dan laptop). Masuk bisa dengan
email + kata sandi atau Google (ADR 0028).

Juri tidak butuh kredensial apa pun: tombol **"Masuk sebagai juri"** di halaman Masuk membuat salinan demo
terisolasi berisi Data Diri sintetis (bukan data orang sungguhan), berlaku 24 jam. Setiap klik mendapat
salinannya sendiri, jadi juri tidak saling menimpa data. Tombol ini dilindungi Cloudflare Turnstile dan
dibatasi 3 salinan per IP per hari. Data sintetis hanya boleh diisikan ke situs latihan (fixture), tidak
pernah ke situs pemerintah. Situs pemerintah selalu memakai akun pribadi warga dan tidak pernah dibagikan.

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

- CSP tunggal dari SvelteKit (mode `auto`: nonce per request untuk halaman dinamis, hash untuk halaman prerender), termasuk `worker-src 'self'`, `manifest-src 'self'`,
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

## Dokumentasi

- [Arsitektur (C4 dan alur data PII)](docs/arsitektur.md)
- [Architecture Decision Records](docs/adr/README.md) (28 keputusan, format MADR)
- [Kebijakan keamanan](SECURITY.md) (Indonesia dan English)
- [Panduan kontribusi](CONTRIBUTING.md)
- [Deploy di VPS](deploy/README.md)
- [RAG: transform vektor dan evaluasi](packages/rag/README.md)

## Lisensi

[MIT](LICENSE) © 2026 Tim Urusin
