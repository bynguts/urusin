# Arsitektur Urusin

Dokumen ini menggambarkan topologi **yang ada saat ini** di repositori dan di `deploy/`. Bagian yang masih
rencana ditandai **(rencana)** dan tidak digambar sebagai komponen yang sudah berjalan. Keputusan di balik
bentuk ini dicatat di [`docs/adr/`](adr/README.md); ancaman dan mitigasinya ada di rencana §6.2.

Diagram memakai sintaks C4 Mermaid (`C4Context`, `C4Container`) yang dirender langsung oleh GitHub. Sintaks C4
di Mermaid masih berstatus eksperimental, sehingga tata letak otomatisnya bisa berbeda antar-versi renderer.

## 1. Konteks sistem (C4 level 1)

```mermaid
C4Context
  title Konteks sistem Urusin

  Person(warga, "Warga", "Mengurus layanan publik dari HP atau laptop. Selalu menekan tombol kirim akhir sendiri.")

  System(urusin, "Urusin", "Menyusun langkah dari sumber resmi dan menemani warga mengisi formulir di situs pemerintah.")

  System_Ext(gov, "Situs layanan pemerintah", "Portal adminduk daerah, LAPOR!, KPU, Kemensos, OSS. Hanya origin yang terdaftar di registry.")
  System_Ext(llm, "Penyedia LLM", "Endpoint OpenAI-compatible (Chat Completions). Hanya menerima placeholder, bukan data pribadi.")
  System_Ext(gh, "GitHub", "Repositori, GitHub Actions (CI dan release), GHCR (registry image).")

  Rel(warga, urusin, "Memakai", "HTTPS dari ponsel atau laptop; layar Browser Pendamping dialirkan ke perangkat")
  Rel(urusin, gov, "Membuka dan mengisi formulir lewat Browser Pendamping", "Chromium di server per sesi, login dan kirim akhir oleh warga")
  Rel(urusin, llm, "Meminta penalaran dan ekstraksi", "HTTPS, placeholder saja")
  Rel(gh, urusin, "Membangun dan menyimpan image, VPS menariknya berdasarkan digest", "Docker pull")
```

## 2. Kontainer (C4 level 2)

```mermaid
C4Container
  title Kontainer Urusin: perangkat warga dan VPS

  Person(warga, "Warga")

  System_Boundary(browser, "Perangkat warga (ponsel atau laptop)") {
    Container(webui, "Web app", "SvelteKit UI", "Antarmuka, daftar urusan lokal (tamu), kanvas layar Browser Pendamping.")
  }

  System_Boundary(vps, "VPS arm64 (Docker Compose, Caddy milik host)") {
    Container(caddy, "Caddy host bersama", "Caddy 2", "Satu-satunya yang memegang 80/443. TLS otomatis, HSTS, kompresi. Tanpa CSP.")
    Container(web, "web", "SvelteKit adapter-node, Node 26", "Server routes, harness agen, akun, vault terenkripsi, CSP nonce. Mendengar di 127.0.0.1:4310.")
    Container(fixtures, "fixtures (opsional)", "Hono", "Situs tiruan jinak untuk demo dan uji. Mendengar di 127.0.0.1:4320.")
    Container(pendamping, "pendamping (opsional)", "Node, Chromium headed di Xvfb", "Satu Chromium per sesi warga, proxy egress per sesi ber-allowlist registry. Mendengar di 127.0.0.1:4330.")
    ContainerDb(db, "SQLite", "better-sqlite3, mode WAL", "Berkas /data/urusin.db di named volume data. Urusan dan jejak tanpa PII; akun dan vault (ciphertext AES-256-GCM).")
  }

  System_Ext(gov, "Situs layanan pemerintah", "Origin terdaftar di registry")
  System_Ext(llm, "Penyedia LLM", "OpenAI-compatible")
  System_Ext(gh, "GitHub Actions dan GHCR", "Build multi-arch, image per commit SHA")

  Rel(warga, webui, "Memakai")
  Rel(webui, caddy, "HTTPS, SSE", "placeholder dan fakta turunan, bebas PII")
  Rel(webui, caddy, "Layar dan input Browser Pendamping", "WebSocket /pendamping/ws, tiket sekali pakai")
  Rel(web, pendamping, "API internal bertanda HMAC", "127.0.0.1:4330")
  Rel(pendamping, gov, "Menjelajah dan mengisi; kirim akhir oleh warga", "HTTPS lewat proxy egress")
  Rel(caddy, web, "reverse_proxy, flush_interval -1", "127.0.0.1:4310")
  Rel(caddy, fixtures, "reverse_proxy (bila diaktifkan)", "127.0.0.1:4320")
  Rel(web, db, "Membaca dan menulis", "file SQLite")
  Rel(web, llm, "Chat Completions", "HTTPS")
  Rel(gh, web, "Image web per SHA, ditarik berdasarkan digest", "deploy.sh")
```

Catatan pembacaan:

- **Caddy dimiliki host**, bukan service di `compose.prod.yml`. Snippet `deploy/Caddyfile.urusin.primary` (atau `.fallback`) di-`import`
  ke Caddyfile host yang juga melayani situs lain. Compose hanya mempublikasikan port loopback.
  Alasannya ada di [ADR 0023](adr/0023-caddy-host-bersama-port-loopback.md).
- `{$DOMAIN}` dan `verify.{$DOMAIN}` menuju upstream yang sama (`127.0.0.1:4310`). Aplikasi memilih rute `/verify`
  dari header `Host` mentah.
- Container `web` berjalan `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, `mem_limit: 512m`.
- **Belum ada (rencana):** server MCP, service `worker` pengingat, PWA. Input suara dan pengingat masih
  dimatikan lewat flag.
- **Dua mode penyimpanan data pribadi ([ADR 0028](adr/0028-akun-dan-login.md)):**
  - Tanpa akun (tamu): Data Diri dan dokumen disimpan terenkripsi di server, terikat hash cookie
    `__Host-urusin_sid`, dan dihapus 72 jam sejak dibuat. Daftar urusan dan preferensi ada di penyimpanan
    peramban.
  - Dengan akun: vault terenkripsi per akun (DEK per pemilik dibungkus KEK dari `URUSIN_PII_KEY`) ikut lintas
    perangkat.
  - Salinan demo juri disimpan 24 jam; akun tidak disapu (tanpa verifikasi email, ADR 0032). Hapus = crypto-shred.
- **Pemroses dan lokasi:**
  - VPS Oracle Cloud Singapura: DB, berkas vault terenkripsi, dan Browser Pendamping.
  - Resend (Amerika Serikat): hanya menerima alamat email dan tautan. Saat ini mode log, jadi belum ada email
    yang terkirim.
  - Google: hanya untuk OIDC, bila warga memilihnya.
  - Model AI tidak pernah melihat NIK, KK, HP, atau email.
- Paket pustaka (bukan kontainer): `@urusin/harness` (agen, state machine, policy gate, audit), `@urusin/akun`
  (akun, sesi, vault), `@urusin/egress` (allowlist HTTP keluar), `@urusin/core` (Step DSL, guard placeholder, registry domain),
  `@urusin/llm` (gateway dan capability probe), `@urusin/registry` (router kab/kota dari prefiks NIK),
  `@urusin/rag` (BM25 FTS5, vektor opsional, fusi RRF).

## 3. Pipeline pengiriman

| Tahap       | Yang terjadi                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| CI          | `.github/workflows/ci.yml`: lint, format, typecheck, test, build, anggaran bundle, audit riwayat commit.                               |
| Release     | `.github/workflows/release.yml`: push ke `main` membangun image web `linux/amd64` dan `linux/arm64`, push ke GHCR.                     |
| Digest      | Digest image dicatat di ringkasan job. Tag hanya SHA commit.                                                                           |
| Deploy      | `deploy/deploy.sh <sha> [digest]` menarik image berdasarkan digest, `up -d`, lalu menunggu `/api/health` dan memastikan `gitSha` sama. |
| Tidak build | VPS tidak pernah membangun image.                                                                                                      |

## 4. Alur data PII

Invarian utama: model dan log tidak pernah menerima PII mentah.

- Model hanya melihat **placeholder** seperti `{{PEMOHON.NIK}}`.
- Nilai asli ada di vault server yang terenkripsi. Vault hanya dibuka oleh jalur isi Pendamping
  (`lib/server/vault/resolver.ts`, satu-satunya penyelesai), setelah warga menekan "Izinkan isi" dan sesaat
  sebelum mengisi kolom di situs tujuan.
- Peramban tidak pernah menerima nilai vault untuk Pendamping.
- Guard `noPlaceholder()` menolak parameter dari model yang memuat `{{`, `}}`, atau pola NIK, HP, dan email.

```mermaid
sequenceDiagram
  autonumber
  actor W as Warga
  participant UI as Web app (peramban)
  participant S as Server web (harness)
  participant V as Vault (server, terenkripsi)
  participant L as Penyedia LLM
  participant E as Browser Pendamping (server)
  participant G as Situs tujuan (portal kirim-asli atau situs latihan)

  W->>UI: Mengisi Data Diri dan mengunggah dokumen
  UI->>S: PUT /api/vault/data-diri, POST /api/vault
  S->>V: Enkripsi AES-256-GCM dengan DEK pemilik
  W->>UI: Bercerita tentang urusannya
  UI->>S: Teks warga
  S->>L: Prompt berisi {{PEMOHON.NIK}} dan teks bebas PII
  L-->>S: Pemanggilan tool dengan parameter tanpa PII
  S->>S: noPlaceholder() dan policy gate memeriksa parameter
  S-->>UI: Rencana dan permintaan isi (placeholder saja)
  W->>UI: Menekan Izinkan isi
  UI->>S: POST /api/urusan/[id]/izinkan-isi {writeList, targetOrigin}
  S->>S: Origin di allowlist, persetujuan sekali pakai disimpan di server
  E->>S: Halaman hidup di origin yang sama
  S->>V: Buka nilai sesuai daftar write
  V-->>E: Nilai lewat kanal internal (tidak dicatat, tidak ke model)
  E->>G: Isi kolom dan unggah berkas
  W->>E: Warga sendiri menekan tombol kirim akhir (takeover)
  E->>G: Kirim
```

Risiko sisa yang diungkap di ADR 0028: demi sinkron lintas perangkat, server memegang ciphertext sekaligus
kuncinya. Karena itu `URUSIN_PII_KEY` adalah rahasia paling kritis, dengan escrow dan rotasi lewat
`pnpm kek:rotate`. Jalur `/api/vision` dan `/api/transcribe` belum ada.

## 5. Jejak keputusan

Daftar ADR ada di [`docs/adr/README.md`](adr/README.md).
