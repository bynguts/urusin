# Worker Browser Pendamping berjaringan Indonesia

Worker ini OPSIONAL: Urusin berjalan 24/7 dari server utama tanpanya. Sebagian portal membatasi akses dari
luar Indonesia:

- `aksesWilayah: 'id-utama'` (mis. Telunjuk Sakti Wonogiri): dari IP datacenter muncul tantangan kotak centang
  yang diketuk warga sendiri lewat Browser Pendamping. Bila worker `id` sehat dan masih punya slot, web
  mendahulukannya; bila penuh atau gagal, sesi langsung berjalan di server utama.
- `aksesWilayah: 'id-only'`: IP luar negeri diblokir keras, jadi hanya worker ini yang bisa melayaninya; tanpa
  worker, urusannya dipandu langkah demi langkah. Daftar portalnya ada di `packages/core/src/registry.ts` dan
  `registry-wilayah.ts`.

Web hanya memakai worker `id` bila `/health`-nya sehat dan melaporkan `"generik":true`. Tanpa stealth, tanpa
pemalsuan sidik jari, tanpa layanan CAPTCHA, tanpa proxy residensial: warga sendiri yang mengetik login, OTP,
dan CAPTCHA, lalu menekan Kirim.

## Topologi

Kontainer sama dengan produksi (`compose.prod.yml`): `pendamping` hanya di jaringan internal (tanpa rute
keluar, sandbox Chromium aktif, profil seccomp yang sama) dan `pendamping-edge` sebagai satu-satunya port dan
satu-satunya jalan keluar. Bedanya:

| Hal            | Server utama                  | Worker ini                                                    |
| -------------- | ----------------------------- | ------------------------------------------------------------- |
| Ikat port edge | `127.0.0.1:4330`              | HANYA IP privat worker (`WORKER_TAILSCALE_IP`, 100.64.0.0/10) |
| Token HMAC     | `PENDAMPING_INTERNAL_TOKEN`   | `WORKER_TOKEN` milik worker ini (dipasang sbg `token` di web) |
| URL WS warga   | `wss://$DOMAIN/pendamping/ws` | `wss://$DOMAIN/pendamping/w/$WORKER_ID/ws`                    |
| Sesi bersamaan | 2                             | 1 (`PENDAMPING_MAX_SESSIONS`)                                 |

Web menjangkau worker lewat jaringan privat dengan panggilan bertanda tangan HMAC; reverse proxy hanya
meneruskan upgrade WebSocket `GET /pendamping/w/<id>/ws/*` (cookie dipangkas menjadi sid saja), jalur lain 404.

## Syarat

- Docker Engine >= 28 (Docker Desktop dengan backend WSL2 juga bisa), memori Docker >= 3 GB.
- Host terhubung ke jaringan privat yang sama dengan server utama dan punya IP di rentang 100.64.0.0/10.
- Koneksi internet Indonesia, dan host tetap menyala selama worker diharapkan melayani.
- bash (Git Bash di Windows) untuk `worker.sh`.

## Menjalankan

```sh
bash deploy/worker-id/worker.sh init    # .env (chmod 600) dengan token acak, tanpa dicetak
bash deploy/worker-id/worker.sh build   # image lokal dari checkout ini (atau isi PENDAMPING_IMAGE@digest rilis)
bash deploy/worker-id/worker.sh up      # validasi .env (IP privat terpasang di host), lalu up -d
bash deploy/worker-id/worker.sh sehat   # {"ok":true,...,"generik":true,"sha":"..."}
bash deploy/worker-id/worker.sh down
```

Image worker harus sama dengan rilis produksi (`sha` di `/health` = commit produksi); image lama tidak
mengenal portal id-only baru dan web akan memandu urusan itu.

## Menghubungkan ke web

- `bash deploy/worker-id/worker.sh web-env publik` menulis `.env.web-publik` berisi `PENDAMPING_WORKERS`
  (server utama + worker ini, lengkap dengan token). Gabungkan ke `.env` web, lalu deploy ulang.
- Rute reverse proxy dibangkitkan, bukan diedit manual:
  `node scripts/gen-caddyfile.mjs --set primary --pendamping --worker <id>=<IP privat>:4330 ...`.
- Rotasi token: hapus `.env`, `init`, `up`, lalu ganti `token` worker ini di `PENDAMPING_WORKERS` web. Selama
  belum diganti, urusan id-only dipandu dengan pesan jujur dan warga tidak pernah melihat galat 401.
- `.env`, `.env.web-publik`, dan `.env.web-final` diabaikan git. Di Windows, batasi ACL berkas itu
  (`icacls deploy\worker-id\.env /inheritance:r /grant:r "%USERNAME%:F"`).

## Demo lokal

Jalur demo utama adalah `bash scripts/demo-final.sh up` (tanpa worker ini). Bila ingin memakai worker ini
bersama web lokal di `http://localhost:3000`: `worker.sh up --final` mengikat edge juga ke `127.0.0.1` dan
`worker.sh web-env final` menulis env web lokal untuk `deploy/compose.local.yml`. Kembali ke mode biasa
dengan `worker.sh up` tanpa `--final`.
