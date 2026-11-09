# Architecture Decision Records

Format [MADR](https://adr.github.io/madr/) dalam bahasa Indonesia: Status, Konteks, Keputusan, Alternatif,
Konsekuensi. ADR 0001-0019 berurutan sesuai keputusan D1-D19 di rencana (§1.3); 0020 dan seterusnya adalah
keputusan yang muncul belakangan atau berasal dari implementasi.

Aturan: ADR yang sudah diterima tidak diubah isinya. Bila keputusan berganti, tulis ADR baru dan ubah baris
**Status** ADR lama menjadi "digantikan oleh ADR nnnn". Fakta di dalam ADR harus bisa ditelusuri ke rencana
atau kode; "Diterima" tidak berarti sudah diimplementasikan, dan kolom Status menyebut bagian mana yang sudah ada.

| ADR                                                              | Keputusan                                                                                          | Asal          |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------- |
| [0001](0001-executor-ekstensi-mv3-di-peramban-warga.md)          | Executor aksi di situs pemerintah berupa ekstensi MV3 di peramban warga                            | D1            |
| [0002](0002-relay-ekstensi-lewat-tab-web-app.md)                 | Komunikasi ekstensi dan harness lewat relay tab web app dengan pairing nonce                       | D2            |
| [0003](0003-harness-sendiri-di-atas-chat-completions.md)         | Harness agen buatan sendiri di atas Chat Completions                                               | D3            |
| [0004](0004-gateway-llm-openai-compatible.md)                    | Satu gateway LLM OpenAI-compatible dengan model per peran lewat env                                | D4            |
| [0005](0005-dsl-adapter-deklaratif-dengan-effect.md)             | Adapter situs berupa DSL deklaratif bertipe dengan effect per operasi                              | D5            |
| [0006](0006-hosting-vps-docker-compose.md)                       | Hosting di VPS milik tim dengan Docker Compose, tanpa PaaS                                         | D6            |
| [0007](0007-vault-pii-di-peramban.md)                            | Vault PII di peramban (IndexedDB, AES-GCM) dengan ekstensi sebagai gate kedua                      | D7            |
| [0008](0008-monorepo-pnpm-turborepo-wxt.md)                      | Monorepo pnpm + Turborepo dengan WXT untuk ekstensi                                                | D8            |
| [0009](0009-interpreter-ekstensi-di-service-worker.md)           | Interpreter ekstensi di service worker dengan cursor persisten dan step-runner yang disuntik ulang | D9            |
| [0010](0010-transfer-berkas-chunk-lewat-port.md)                 | Transfer berkas ke ekstensi lewat chunk base64 pada port dengan verifikasi SHA-256                 | D10           |
| [0011](0011-host-permissions-ekstensi-statis-dari-registry.md)   | Host permissions ekstensi statis, dihasilkan dari registry domain resmi                            | D11           |
| [0012](0012-host-fixture-publik-domain-terpisah.md)              | Fixture publik jinak di host terpisah, fixture berbahaya hanya lokal                               | D12           |
| [0013](0013-turnstile-di-iframe-verify-host.md)                  | Turnstile diisolasi di iframe pada host verifikasi terpisah                                        | D13           |
| [0014](0014-capability-probe-llm-dengan-tangga-degradasi.md)     | Capability probe untuk penyedia LLM dengan tangga degradasi per kapabilitas                        | D14           |
| [0015](0015-pengingat-inbox-dan-web-push.md)                     | Pengingat lewat inbox in-app dan Web Push (VAPID) dengan worker terpisah                           | D15           |
| [0016](0016-input-suara-mediarecorder-dan-transkripsi.md)        | Input suara lewat MediaRecorder dan rute transkripsi milik sendiri                                 | D16           |
| [0017](0017-sveltekit-bukan-nextjs.md)                           | SvelteKit (Svelte 5) dengan adapter-node, bukan Next.js                                            | D17           |
| [0018](0018-retrieval-hibrida-bm25-dan-vektor-di-sqlite.md)      | Retrieval pengetahuan hibrida di satu SQLite: BM25 (FTS5) dan vektor, fusi RRF                     | D18           |
| [0019](0019-router-multi-kota-prefiks-nik.md)                    | Router multi-kota berdasarkan kode kab/kota dari prefiks NIK                                       | D19           |
| [0020](0020-web-only-pwa-tanpa-telegram.md)                      | Platform web-only (PWA), tanpa bot Telegram                                                        | keputusan tim |
| [0021](0021-cosine-js-di-atas-blob-sqlite.md)                    | Pencarian vektor cosine di JS atas blob SQLite, bukan sqlite-vec                                   | implementasi  |
| [0022](0022-centering-whitening-vektor-digerbang-eval.md)        | Centering dan whitening vektor hanya aktif bila terbukti lewat evaluasi                            | implementasi  |
| [0023](0023-caddy-host-bersama-port-loopback.md)                 | Caddy milik host bersama dengan port loopback, bukan Caddy di dalam compose                        | implementasi  |
| [0024](0024-image-multi-arch-ghcr-ditarik-berdasarkan-digest.md) | Image multi-arch di GHCR, dibangun di CI dan di-deploy berdasarkan digest                          | implementasi  |
| [0025](0025-executor-tanpa-bypass-captcha.md)                    | Eksekusi di peramban warga tanpa bypass CAPTCHA atau teknik anti-deteksi                           | prinsip       |
| [0026](0026-csp-sveltekit-mode-auto.md)                          | CSP tunggal dari SvelteKit dalam mode auto, tanpa strict-dynamic                                   | implementasi  |
| [0027](0027-commit-konvensional-tanpa-co-author.md)              | Commit konvensional, tanpa atribusi AI otomatis, dan riwayat tidak ditulis ulang                   | proses        |
| [0028](0028-browser-pendamping.md)                               | Browser Pendamping di server sebagai eksekutor                                                     | keputusan tim |
