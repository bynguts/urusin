# Arsitektur Urusin

Dokumen ini menggambarkan topologi **yang ada saat ini** di repositori dan di `deploy/`. Bagian yang masih
rencana ditandai **(rencana)** dan tidak digambar sebagai komponen yang sudah berjalan. Keputusan di balik
bentuk ini dicatat di [`docs/adr/`](adr/README.md).

Diagram memakai sintaks C4 Mermaid (`C4Context`, `C4Container`) yang dirender langsung oleh GitHub. Sintaks C4
di Mermaid masih berstatus eksperimental, sehingga tata letak otomatisnya bisa berbeda antar-versi renderer.

## 1. Konteks sistem (C4 level 1)

```mermaid
C4Context
  title Konteks sistem Urusin

  Person(warga, "Warga", "Mengurus layanan publik dari HP atau laptop. Selalu menekan tombol kirim akhir sendiri.")

  System(urusin, "Urusin", "Menyusun langkah dari sumber resmi dan menemani warga mengisi formulir di situs pemerintah.")

  System_Ext(gov, "Situs layanan pemerintah", "Portal adminduk daerah, LAPOR!, KPU, Kemensos, OSS. Hanya origin yang terdaftar di registry.")
  System_Ext(llm, "OpenAI", "Model GPT lewat Chat Completions (SDK resmi openai). Hanya menerima placeholder, bukan data pribadi.")
  System_Ext(gh, "GitHub", "Repositori, GitHub Actions (CI dan release), GHCR (registry image).")
  System_Ext(cf, "Cloudflare", "DNS, CDN, dan perlindungan jaringan: tepi publik urusinai.web.id.")
  System_Ext(google, "Google", "Masuk dengan Google (OIDC), bila warga memilihnya.")
  System_Ext(exa, "Exa", "Cadangan pencarian web, istilah umum saja.")

  Rel(warga, cf, "Memakai", "HTTPS dari ponsel atau laptop; layar Browser Pendamping dialirkan ke perangkat")
  Rel(cf, urusin, "Meneruskan lalu lintas web", "HTTPS")
  Rel(urusin, google, "Verifikasi masuk", "OIDC")
  Rel(urusin, exa, "Pencarian web cadangan", "HTTPS, tanpa data pribadi")
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
    Container(webui, "Web app", "SvelteKit UI", "Antarmuka dan kanvas layar Browser Pendamping.")
  }

  System_Ext(cf, "Cloudflare", "Tepi publik: DNS, CDN, perlindungan jaringan, TLS di edge.")

  System_Boundary(vps, "Server Urusin: Oracle Cloud Singapura") {
    Container(caddy, "Caddy (host)", "Caddy 2, proses host di luar compose", "Satu-satunya pintu masuk server. TLS, HSTS, kompresi (ADR 0023).")
    Container_Boundary(compose, "Docker Compose (port hanya 127.0.0.1)") {
      Container(web, "web", "SvelteKit adapter-node, Node 26", "Server routes, harness agen, akun, vault terenkripsi, CSP nonce.")
      Container(fixtures, "fixtures (opsional)", "Hono", "Situs tiruan jinak untuk demo dan uji.")
      Container(pendamping, "pendamping (opsional)", "Node, Chromium headed di Xvfb", "Satu Chromium per sesi warga, proxy egress per sesi ber-allowlist registry.")
      Container(embedding, "embedding", "llama.cpp, EmbeddingGemma-300M", "Self-hosted: jenis urusan dan pencarian vektor RAG.")
      ContainerDb(db, "SQLite", "better-sqlite3, mode WAL", "Urusan dan jejak tanpa PII; akun dan vault (ciphertext AES-256-GCM); korpus RAG dengan indeks BM25 + vektor.")
    }
  }

  System_Ext(gov, "Situs layanan pemerintah", "Origin terdaftar di registry")
  System_Ext(llm, "OpenAI", "Model GPT")
  System_Ext(gh, "GitHub Actions dan GHCR", "Build multi-arch, image per commit SHA")

  Rel(warga, webui, "Memakai")
  Rel(webui, cf, "HTTPS, SSE", "placeholder dan fakta turunan, bebas PII")
  Rel(webui, cf, "Layar dan input Browser Pendamping", "WebSocket /pendamping/ws, tiket sekali pakai")
  Rel(cf, caddy, "Meneruskan ke origin", "HTTPS")
  Rel(web, pendamping, "API internal bertanda HMAC", "jaringan internal")
  Rel(web, embedding, "Embedding kueri dan teks", "jaringan internal")
  Rel(pendamping, gov, "Menjelajah dan mengisi; kirim akhir oleh warga", "HTTPS lewat proxy egress")
  Rel(caddy, web, "reverse_proxy, streaming SSE", "loopback 127.0.0.1")
  Rel(caddy, fixtures, "reverse_proxy (bila diaktifkan)", "loopback 127.0.0.1")
  Rel(web, db, "Membaca dan menulis", "file SQLite")
  Rel(web, llm, "Chat Completions", "HTTPS")
  Rel(gh, web, "Image web per SHA, ditarik berdasarkan digest", "deploy.sh")
```

Catatan pembacaan:

- **Cloudflare adalah tepi publik.** DNS urusinai.web.id ada di Cloudflare dan semua lalu lintas web diproksikan
  lewat jaringannya (CDN, perlindungan jaringan, TLS di edge). Di server, **Caddy milik host adalah satu-satunya
  pintu masuk**: Caddy berjalan sebagai proses host, bukan di Docker Compose, dan kontainer Urusin hanya mengikat
  port loopback `127.0.0.1`. Alasannya ada di [ADR 0023](adr/0023-caddy-host-bersama-port-loopback.md).
- Container `web` berjalan `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, `mem_limit: 512m`.
- **Belum ada (rencana):** server MCP, service `worker` pengingat, PWA. Pengingat masih dimatikan lewat
  flag.
- **Penyimpanan data pribadi ([ADR 0028](adr/0028-akun-dan-login.md)):**
  - Tidak ada mode tamu: akun wajib. Data tamu lama (sebelum akun wajib) digabung ke akun saat masuk dari
    peramban yang sama, lalu disapu. Daftar urusan disimpan di server per akun.
  - Dengan akun: vault terenkripsi per akun (DEK per pemilik dibungkus KEK dari `URUSIN_PII_KEY`) ikut lintas
    perangkat.
  - Salinan demo juri disimpan 24 jam; akun tidak disapu (tanpa verifikasi email, ADR 0032). Hapus = crypto-shred.
- **Pemroses dan lokasi** (sama dengan [`docs/privasi.md`](privasi.md)):
  - Oracle Cloud (Singapura): DB, berkas vault terenkripsi, pencarian sumber resmi, dan Browser Pendamping.
  - Cloudflare (global, titik terdekat Singapura): DNS, CDN, dan perlindungan jaringan untuk semua lalu lintas web,
    serta penerusan email ke hello@urusinai.web.id <!-- pii-scan:allow alamat kontak publik -->. Data Diri dan dokumen tetap tersimpan terenkripsi hanya di
    server Urusin.
  - Google: hanya untuk OIDC, bila warga memilihnya.
  - OpenAI (model GPT): teks percakapan dengan penanda; model tidak pernah melihat NIK, KK, HP, atau email.
  - Exa (Amerika Serikat): cadangan pencarian web, istilah umum tanpa data pribadi.
- Paket pustaka (bukan kontainer): `@urusin/harness` (agen, state machine, policy gate, audit), `@urusin/akun`
  (akun, sesi, vault), `@urusin/egress` (allowlist HTTP keluar), `@urusin/core` (Step DSL, guard placeholder, registry domain),
  `@urusin/llm` (gateway dan capability probe), `@urusin/registry` (router kab/kota dari prefiks NIK),
  `@urusin/rag` (BM25 FTS5 + vektor EmbeddingGemma, fusi RRF).

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
  participant L as OpenAI (model GPT)
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
`pnpm kek:rotate`.

## 5. Jejak keputusan

Daftar ADR ada di [`docs/adr/README.md`](adr/README.md).
