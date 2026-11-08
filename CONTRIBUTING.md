# Berkontribusi ke Urusin

Terima kasih sudah mau membantu. Dokumen ini singkat dan hanya berisi aturan yang benar-benar ditegakkan di
repositori ini. Arsitektur ada di [`docs/arsitektur.md`](docs/arsitektur.md), keputusan di
[`docs/adr/`](docs/adr/README.md), dan kebijakan keamanan di [`SECURITY.md`](SECURITY.md).

## Setup

Prasyarat: Node.js 26 (lihat `.nvmrc`) dan pnpm 11 (`packageManager` di `package.json`).

```bash
pnpm install --frozen-lockfile   # juga memasang hook husky lewat skrip prepare
cp .env.example .env             # isi nilai sendiri; jangan pernah commit .env
pnpm dev
```

Dependensi dipin **exact** (tanpa `^` atau `~`). Tambahkan dengan `pnpm add -E`.

## Alur kerja

- Cabang dari `main`, dengan nama seperti `feat/...`, `fix/...`, `docs/...`. Buka pull request ke `main`;
  jangan push langsung ke `main`.
- Commit kecil dan sering. Satu commit, satu perubahan yang utuh.
- Pemilik berkas ada di [`.github/CODEOWNERS`](.github/CODEOWNERS); PR yang menyentuh area orang lain
  ditinjau oleh pemiliknya.

## Pesan commit

[Conventional Commits](https://www.conventionalcommits.org/), ditegakkan oleh `commitlint` dan hook `commit-msg`:

```
feat(web): tambah halaman pairing
fix(core): tolak origin dengan userinfo
docs: perbarui diagram arsitektur
```

Tipe yang diterima: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.
Subjek tidak boleh hanya "update", "test", "final", atau "wip".

### Aturan keras

1. **Jangan menulis ulang riwayat.** Tidak ada `git push --force`, `rebase`, `squash`, `commit --amend` pada
   riwayat yang sudah dipush, `reset --hard`, atau `filter-branch`/`filter-repo`. Salah? Tambahkan commit baru
   yang memperbaikinya. CI menjalankan `pnpm audit:history`.
2. **Jangan menambah trailer `Co-Authored-By` atau atribusi AI otomatis** di pesan commit. Hook dan CI menolaknya.
   Penggunaan AI diungkap di README, bukan di trailer. Anda bertanggung jawab atas setiap baris yang Anda commit.
3. **Jangan memakai `--no-verify`** untuk melewati hook. Perbaiki penyebab kegagalannya.
4. Alamat email commit harus yang terdaftar di `scripts/team-emails.json` (diperiksa oleh `audit-history`).

## Hook

`husky` memasang dua hook (`pnpm install` memasangnya):

- `commit-msg`: `scripts/check-commit-msg.mjs` dan `commitlint`.
- `pre-commit`: `scripts/pii-scan.mjs --staged`, memindai NIK, nomor HP, email, dan private key.

CI menjalankan ulang pemindaian PII pada semua berkas terlacak (`pnpm pii:scan`).

## Aturan PII

Ini aturan terpenting di proyek ini.

- **Jangan pernah** meng-commit data pribadi nyata: NIK, KK, nomor HP, email pribadi, alamat, foto atau scan
  dokumen, tangkapan layar yang memuatnya, atau kredensial. Ini berlaku juga untuk fixture, tes, dan dokumen.
- Gunakan data karangan yang jelas palsu. Hindari 16 digit dengan prefiks provinsi yang valid.
- Model (LLM) tidak boleh menerima data pribadi: parameter tool dari model dilindungi `noPlaceholder()`
  (`packages/core`). Jangan melonggarkannya tanpa ADR dan tinjauan.
- `.env*`, basis data (`*.db`), dan kunci (`*.pem`) tidak boleh masuk repositori.
- Bila Anda tidak sengaja mem-push PII atau rahasia, **jangan** menulis ulang riwayat sendiri. Beri tahu
  pengelola segera lewat kanal di [`SECURITY.md`](SECURITY.md) agar rotasi dan penanganan dilakukan bersama.

## Menjalankan pemeriksaan

```bash
pnpm turbo run lint typecheck test build   # semuanya harus hijau sebelum PR
pnpm format:check                          # Prettier; perbaiki dengan `pnpm format`
pnpm coverage                              # coverage vitest v8 per paket + tabel ringkasan
pnpm budget                                # JS awal beranda <= 70 KB gzip (setelah build)
pnpm e2e                                   # Playwright (web app)
```

- Tes unit memakai Vitest (`*.test.ts`), skrip repositori memakai `node:test` (`pnpm test:scripts`).
- Tes properti memakai `fast-check` (lihat `packages/core/src/properties.test.ts`). Bila sebuah properti gagal,
  fast-check mencetak `seed` dan counterexample yang bisa diputar ulang; jangan melemahkan properti untuk meloloskannya.
- E2E: sekali per mesin jalankan `npx playwright install chromium`. E2E hanya menyentuh fixture lokal, tidak pernah
  situs pemerintah asli. Rincian di [`apps/web/playwright.config.ts`](apps/web/playwright.config.ts).
- Coverage punya ambang per paket di `packages/*/vitest.config.ts`. Menurunkan ambang butuh alasan di PR.

## Pull request

Isi [template PR](.github/pull_request_template.md). Fitur baru yang menambah JS awal beranda harus tetap
di bawah anggaran 70 KB gzip. Perubahan yang mengubah keputusan arsitektur butuh ADR baru di `docs/adr/`.

## Dokumentasi

Tulis dokumentasi dalam bahasa Indonesia, kecuali kode, konfigurasi, dan `SECURITY.md` (dwibahasa). Setiap klaim
harus bisa ditelusuri ke kode atau sumber. Jangan menulis angka yang belum diverifikasi.
