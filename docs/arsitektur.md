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
    Container(webui, "Web app", "SvelteKit UI, PWA (rencana)", "Antarmuka, vault PII (rencana), kanvas layar Browser Pendamping.")
  }

  System_Boundary(vps, "VPS arm64 (Docker Compose, Caddy milik host)") {
    Container(caddy, "Caddy host bersama", "Caddy 2", "Satu-satunya yang memegang 80/443. TLS otomatis, HSTS, kompresi. Tanpa CSP.")
    Container(web, "web", "SvelteKit adapter-node, Node 26", "Server routes, harness (rencana), CSP nonce. Mendengar di 127.0.0.1:4310.")
    Container(fixtures, "fixtures (opsional)", "Hono", "Situs tiruan jinak untuk demo dan uji. Mendengar di 127.0.0.1:4320.")
    Container(pendamping, "pendamping (opsional)", "Node, Chromium headed di Xvfb", "Satu Chromium per sesi warga, proxy egress per sesi ber-allowlist registry. Mendengar di 127.0.0.1:4330.")
    ContainerDb(db, "SQLite", "better-sqlite3, mode WAL", "Berkas /data/urusin.db di named volume data. Metadata saja, tanpa PII.")
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
- **Belum ada (rencana):** harness agen, tujuh server MCP, vault PII, service `worker` pengingat, service `backup`,
  PWA. Repositori baru memuat fondasi, fixtures, dan paket `core`, `llm`, `registry`, `rag`.
- Paket pustaka (bukan kontainer): `@urusin/core` (Step DSL, guard placeholder, registry domain),
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

Invarian utama (rencana §3.1): semua yang melintasi garis peramban ke server bebas PII. Model hanya melihat
**placeholder** seperti `{{PEMOHON.NIK}}`. Nilai asli hanya ada di vault peramban dan baru diganti di sisi
eksekutor (Browser Pendamping), sesaat sebelum mengisi kolom di situs pemerintah. Guard `noPlaceholder()` menolak parameter
dari model yang memuat `{{`, `}}`, atau pola NIK, HP, dan email.

```mermaid
sequenceDiagram
  autonumber
  actor W as Warga
  participant UI as Web app (peramban)
  participant V as Vault PII (peramban)
  participant S as Server web (harness, rencana)
  participant L as Penyedia LLM
  participant E as Browser Pendamping (server)
  participant G as Situs pemerintah

  W->>UI: Mengisi data diri (intake terstruktur)
  UI->>V: Simpan nilai asli (NIK, nama, alamat)
  Note over V: Nilai asli tidak pernah keluar dari peramban ke server atau LLM
  UI->>S: Permintaan dengan placeholder dan fakta turunan
  S->>L: Prompt berisi {{PEMOHON.NIK}} dan teks bebas PII
  L-->>S: Pemanggilan tool dengan parameter tanpa PII
  S->>S: noPlaceholder() dan policy engine memeriksa parameter
  S-->>UI: Langkah dan permintaan eksekusi, tetap berupa placeholder
  UI->>V: Resolve placeholder
  V-->>UI: Nilai asli
  UI->>E: Kirim lewat sesi WebSocket bertiket (hanya di memori, tidak dicatat)
  E->>E: Gate kedua: warga menyetujui sebelum kolom diisi
  E->>G: Isi kolom dengan nilai asli
  W->>E: Warga sendiri menekan tombol kirim akhir (takeover)
  E->>G: Kirim
```

Pengecualian yang disetujui di rencana (belum diimplementasikan): dua jalur pass-through `/api/vision` (gambar
yang sudah di-masking) dan `/api/transcribe` (audio). Keduanya tidak disimpan dan tidak dicatat. Risiko sisa
(JS dari server yang bisa membaca vault bila server dibobol) diungkap di threat model.

## 5. Jejak keputusan

Daftar ADR ada di [`docs/adr/README.md`](adr/README.md).
