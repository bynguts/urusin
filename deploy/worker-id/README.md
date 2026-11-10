# Worker Browser Pendamping berjaringan Indonesia (laptop, lewat Tailscale)

Worker ini OPSIONAL: Urusin berjalan 24/7 dari server tanpa laptop. Telunjuk Sakti (Disdukcapil Wonogiri)
berstatus `aksesWilayah: 'id-utama'`: dari IP datacenter (agent-vm, Singapura) Cloudflare memberi tantangan
kotak centang (`403 cf-mitigated: challenge`, "Performing security verification") yang diketuk warga sendiri
lewat Browser Pendamping, lalu AI melanjutkan; bila laptop ini hidup dan masih punya slot, web mendahulukannya
(laptop penuh atau start gagal di laptop = langsung server). Dari koneksi
rumah/seluler Indonesia Chromium headed biasa lolos tanpa tantangan). Hanya Si D'nOK (`aksesWilayah: 'id-only'`,
blokir keras "Akses Terbatas - Khusus Indonesia") yang benar-benar butuh worker ini; tanpanya situs itu
dipandu. Folder ini menjalankan worker Pendamping region `id`
di laptop anggota (Docker Desktop di Windows/macOS, atau Docker Linux), dijangkau web di agent-vm hanya lewat
Tailscale. Tanpa stealth/pemalsuan sidik jari, tanpa layanan CAPTCHA, tanpa proxy residensial: warga sendiri
yang mengetik login/OTP/CAPTCHA, mengklik tantangan bila muncul, dan menekan Kirim/Selesai.

```
Peramban warga --wss--> Caddy agent-vm  /pendamping/w/<id>/ws/<uuid>
                              | (Tailscale, hanya /ws/*)
Web agent-vm  --HMAC token worker--> http://<IP Tailscale laptop>:4330  (edge: /internal/*, /health, /ws/<uuid>)
                                              |
                              laptop: pendamping-edge --> pendamping (Chromium headed di Xvfb, jaringan internal)
                                              '--> CONNECT https:443 ke host registry, IP Indonesia laptop
```

Topologi kontainer sama dengan produksi (`compose.prod.yml`): `pendamping` hanya di jaringan internal (tanpa
rute keluar, sandbox Chromium aktif, profil seccomp yang sama), `pendamping-edge` satu-satunya port dan
satu-satunya jalan keluar (union host registry, IP privat/CGNAT ditolak). Bedanya hanya:

| Hal            | agent-vm                      | Laptop (folder ini)                                           |
| -------------- | ----------------------------- | ------------------------------------------------------------- |
| Ikat port edge | `127.0.0.1:4330`              | HANYA IP Tailscale laptop (`WORKER_TAILSCALE_IP`), bukan LAN  |
| Token HMAC     | `PENDAMPING_INTERNAL_TOKEN`   | `WORKER_TOKEN` milik worker ini (dipasang sbg `token` di web) |
| URL WS warga   | `wss://$DOMAIN/pendamping/ws` | `wss://$DOMAIN/pendamping/w/$WORKER_ID/ws`                    |
| Sesi bersamaan | 2                             | 1 (`PENDAMPING_MAX_SESSIONS`)                                 |

## Syarat laptop

- Menyala, tidak tidur, terhubung internet Indonesia (rumah/seluler), selama worker diharapkan melayani.
  Windows: Settings > Power > Sleep = Never saat dicolok; tutup layar = "Do nothing".
- Docker Desktop >= 4.x dengan Docker Engine >= 28 (`gateway_mode_ipv4: isolated`; `worker.sh up` menolak versi
  lebih lama), backend WSL2, "Start Docker Desktop when you sign in" aktif. Kontainer `restart: unless-stopped`
  ikut hidup lagi setelah Docker Desktop mulai. Memori VM Docker >= 3 GB (pendamping 1,3 GB + edge 128 MB).
- Tailscale menyala dan login ke tailnet yang sama dengan agent-vm (`tailscale ip -4` = `WORKER_TAILSCALE_IP`).
  Bila IP Tailscale berubah (perangkat didaftar ulang), ubah `.env`, rute Caddy, dan `PENDAMPING_WORKERS`.
- Git Bash (Windows) atau bash biasa untuk `worker.sh`.

Docker Desktop: port `100.x.y.z:4330:4330` didengarkan oleh Docker Desktop di IP itu saja (diuji: tidak
terjangkau dari IP LAN maupun 127.0.0.1, terjangkau dari agent-vm lewat Tailscale). `network_mode: host` TIDAK
dipakai: di Docker Desktop itu jaringan VM Linux, bukan jaringan laptop (lihat deploy/README.md).

## Pertama kali

```sh
bash deploy/worker-id/worker.sh init    # .env (chmod 600): token acak, IP Tailscale diisi otomatis bila ada
bash deploy/worker-id/worker.sh build   # image lokal urusin-pendamping:worker-id dari checkout ini (~5 menit)
bash deploy/worker-id/worker.sh up      # validasi .env (IP 100.64.0.0/10 dan terpasang di host), lalu up -d
```

Image: bawaan dibangun dari checkout (pastikan checkout = commit yang sama dengan produksi). Alternatif: isi
`PENDAMPING_IMAGE=ghcr.io/bynguts/urusin-pendamping@sha256:...` dengan digest yang SAMA dengan agent-vm
(`grep PENDAMPING_IMAGE /opt/urusin/.env`) setelah `docker login ghcr.io` memakai PAT `read:packages`.

Boot yang benar (`docker logs urusin-worker-id-pendamping-1`):

```
sandbox Chromium aktif (user namespace)
pendamping mendengarkan di 172.x.y.z:4330 (maks 1 sesi, TTL 15 menit, headed di Xvfb :0)
```

## Sehari-hari

```sh
bash deploy/worker-id/worker.sh sehat   # {"ok":true,"aktif":0,"maks":1,"menunggu":0} lewat IP Tailscale
bash deploy/worker-id/worker.sh down    # berhenti; Telunjuk Sakti kembali ke server; hanya situs id-only yang dipandu
docker compose -p urusin-worker-id logs --tail 50 pendamping pendamping-edge
```

Dari agent-vm (baca saja): `curl -fsS http://<IP Tailscale laptop>:4330/health`.

Setelah laptop reboot: masuk (login) ke Windows dulu, tunggu Tailscale tersambung, lalu jalankan
`bash deploy/worker-id/worker.sh up` (dan `sehat`). Docker Desktop bisa mulai sebelum IP Tailscale terpasang;
kontainer edge yang port-nya diikat ke IP itu lalu gagal start, dan `restart: unless-stopped` saja tidak cukup.

Docker di Linux (bukan Docker Desktop): ikatan `100.x.y.z:4330` dibuat lewat DNAT iptables, sehingga host LAN
yang merutekan paket ke `100.x.y.z` lewat laptop ini masih bisa menjangkau port itu. Contoh pembatasan
(dokumentasi saja; `worker.sh` tidak menjalankannya, sesuaikan IP dan simpan sendiri agar tahan reboot):

```sh
sudo iptables -I DOCKER-USER ! -i tailscale0 -p tcp -m conntrack --ctdir ORIGINAL \
  --ctorigdst 100.x.y.z --ctorigdstport 4330 -j DROP
```

## Token

`worker.sh init` mengisi `WORKER_TOKEN` (HMAC web -> worker ini) dan `WORKER_EDGE_TOKEN` (pendamping -> edge,
tidak pernah keluar laptop) dengan 32 byte acak, ditulis lewat env (bukan argumen proses), tanpa dicetak.
`.env`, `.env.web-publik`, dan `.env.web-final` diabaikan git (`.env.*`).

- Untuk web produksi: `bash deploy/worker-id/worker.sh web-env publik` menulis `.env.web-publik` berisi baris
  `PENDAMPING_WORKERS=[vps, <id>]` lengkap dengan token worker ini. Salin berkas itu ke agent-vm lewat `scp`
  (bukan tempel di chat), lalu gabungkan ke `/opt/urusin/.env` (lead, dengan izin).
- Rotasi: hapus `.env`, `init`, `up`, lalu ganti `token` worker ini di `PENDAMPING_WORKERS` web. Selama belum
  diganti, worker menjawab 401 ke web (`/health` tetap sehat karena tidak bertanda tangan): situs `id-utama`
  langsung dicoba di server dan tetap jalan, sedangkan situs `id-only` mendapat 503 umum "sedang tidak tersedia"
  (bukan mode dipandu, karena worker terlihat sehat) sampai token di web diganti. Warga tidak pernah melihat 401.
- Windows: `chmod 600` dari Git Bash TIDAK mengubah ACL NTFS. Simpan checkout di profil sendiri
  (`C:\Users\<nama>\...`, yang tidak terbaca akun lain), atau batasi berkasnya:
  `icacls deploy\worker-id\.env /inheritance:r /grant:r "%USERNAME%:F"` (ulangi untuk `.env.web-*`).

## Produksi (agent-vm, dikerjakan lead dengan izin)

1. Rute Caddy, dibangkitkan (bukan diedit manual):
   `node scripts/gen-caddyfile.mjs --set primary --fixtures --pendamping --worker laptop-a=<IP Tailscale>:4330 --import /opt/urusin/Caddyfile.urusin --out /tmp/Caddyfile.urusin`
   Hanya upgrade WebSocket `GET /pendamping/w/<id>/ws/*` yang membawa cookie `__Host-urusin_sid` yang diteruskan
   (prefiks dibuang, edge menerima `/ws/<uuid>`); Cookie ditimpa jadi sid saja dan `Authorization` dibuang, jadi
   cookie akun warga tidak pernah sampai ke laptop (edge juga menyaringnya). Jalur lain di bawah
   `/pendamping/w/<id>/` (`/internal/*`, `/health`, `/debug`, GET biasa) dijawab 404 oleh Caddy.
   Saran ACL Tailscale (admin tailnet): hanya agent-vm yang boleh ke `laptop-a:4330`, mis.
   `"hosts": {"agent-vm": "100.a.b.c", "laptop-a": "100.x.y.z"}` dan
   `"acls": [{"action": "accept", "src": ["agent-vm"], "dst": ["laptop-a:4330"]}, ...]` (aturan lain tim tetap
   ditulis eksplisit; aturan "semua ke semua" bawaan membatalkan pembatasan ini).
2. Web: `PENDAMPING_INTERNAL_URL` diganti `PENDAMPING_WORKERS` (dari `.env.web-publik`). Skema web WAJIB punya
   `wsUrl` di setiap worker dan `token` untuk worker selain 127.0.0.1; JSON yang tidak sah membuat Pendamping
   mati seluruhnya (tidak tersedia), jadi cek `GET /api/pendamping/antrean` sesudahnya (`maks` = 2 + 1).

## Demo final di localhost

Final dijalankan di laptop ini: web lokal `http://localhost:3000` (deploy/compose.local.yml) + worker ini.

```sh
bash deploy/worker-id/worker.sh up --final       # + edge di 127.0.0.1:4330, origin http://localhost:3000
bash deploy/worker-id/worker.sh sehat --final
bash deploy/worker-id/worker.sh web-env final    # .env.web-final: PENDAMPING_INTERNAL_TOKEN + PENDAMPING_WORKERS
cd deploy && docker compose -f compose.local.yml --env-file .env up --build   # http://localhost:3000
curl -fsS http://localhost:3000/api/pendamping/antrean   # {"aktif":0,"maks":1,"menunggu":0}
```

Web lokal memanggil worker lewat `http://<IP Tailscale>:4330` (pengecualian egress web hanya 127.0.0.1 atau
100.64.0.0/10; dari dalam kontainer web, 127.0.0.1 adalah kontainer itu sendiri), sedangkan peramban membuka
`ws://localhost:4330/ws/<uuid>`: cookie `__Host-urusin_sid` milik localhost ikut terkirim ke port lain di host
yang sama, ke IP Tailscale tidak. Jadi Tailscale tetap harus menyala saat final (IP-nya hanya dipakai di dalam
laptop; tidak butuh agent-vm). Mode Uji (juri/tamu) tetap ke replika `fixtures.$DOMAIN` dan butuh internet.
Akun warga biasa (bukan tamu, bukan salinan demo juri) dibuka ke Telunjuk Sakti asli.

Kembali ke mode produksi saja: `bash deploy/worker-id/worker.sh up` (tanpa `--final`; loopback dilepas).
