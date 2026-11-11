# Runner CI self-hosted (cadangan bila menit GitHub Actions habis)

> **SEBELUM REPO DIBUAT PUBLIC (submission LOGICODIX, tenggat 2026-11-14): COPOT RUNNER INI.**
> Di repo publik, siapa pun bisa membuka PR dari fork, dan workflow `pull_request` akan menjalankan kode
> mereka di runner self-hosted, yaitu **di agent-vm** (bersama Caddy, proxy :20128, situs pengguna, Xvfb :99).
> Repo publik juga mendapat menit runner GitHub **gratis tanpa batas**, jadi runner ini tidak dibutuhkan lagi.
>
> ```sh
> gh api -X POST repos/bynguts/urusin/actions/runners/remove-token --jq .token \
>   | ssh ubuntu@agent-vm 'sudo /tmp/urusin-ci-install/deploy/ci-runner/uninstall.sh'   # token lewat stdin
> gh variable delete URUSIN_RUNNER --repo bynguts/urusin  # semua job kembali ke ubuntu-latest
> gh api repos/bynguts/urusin/actions/runners --jq .total_count   # harus 0
> ```
>
> Tidak ada PAT di box (runner hanya memegang kredensialnya sendiri, ikut terhapus). Tetap rotasi/cabut token
> lokal yang dipakai untuk membuat registration token. Baru setelah itu ubah visibilitas repo ke Public.

## Kapan dipakai

Disiapkan, **tidak terpasang**. Dipasang hanya bila run CI/Release gagal karena batas menit atau billing
GitHub Actions (pesan seperti "spending limit" / "minutes quota"), dan hanya selama repo masih private.
Setiap pemasangan dan pengaktifan tetap butuh persetujuan per kejadian (aturan do-no-harm agent-vm).

## Cara kerja

- **Satu variabel repo memindahkan semua job.** Setiap job di `ci.yml`, `release.yml`, `security.yml`, dan
  `audit-branch.yml` memakai `runs-on: ${{ vars.URUSIN_RUNNER || 'ubuntu-latest' }}`. Set
  `URUSIN_RUNNER=urusin-self` untuk pindah ke agent-vm; hapus variabelnya untuk kembali. Tanpa ubah kode.
  `codeql.yml` dan `scorecard.yml` tetap di runner GitHub (keduanya hanya bermakna saat repo publik).
- **Langkah yang tidak aman di host punya varian self-hosted** (`if: runner.environment == 'self-hosted'`):
  - **E2E dan Lighthouse** berjalan di image Playwright resmi (digest = basis `apps/pendamping/Dockerfile`,
    jadi Chromium sama dengan produksi). Tidak ada `sysctl` host. Sandbox Chromium tetap aktif lewat
    `chrome-sandbox` setuid + seccomp Playwright, persis model produksi (ADR 0029); tidak pernah `--no-sandbox`
    untuk pendamping.
  - **Build image Release** memakai builder buildx khusus `urusin-ci` (driver docker-container, cache
    dibatasi 1,5 GB di `buildkitd.toml`, dan `ci-docker build` menjalankan `builder-gc` ke 1,5 GB setelah SETIAP
    build). Membersihkan cache HANYA lewat `ci-docker builder-gc`
    (`docker buildx prune --builder urusin-ci --max-used-space 1500mb`) atau `ci-docker builder-rm`. Tidak pernah prune global, tidak
    pernah `daemon.json`. amd64 dibangun lewat binfmt `qemu-x86_64` yang **sudah** terdaftar di host (paket
    distro); CI tidak pernah memasang binfmt. Output tetap `DIGEST: sha256:...` di log job, sama dengan runner
    GitHub.
  - **Smoke test Release hanya arsitektur native host** (arm64; boot pendamping penuh dengan pengerasan
    compose). Node amd64 di bawah `qemu-x86_64` bisa menggantung tanpa CPU, jadi amd64 tidak di-smoke di sini:
    amd64 tetap dibangun + di-push, lalu `ci-docker smoke` memastikan setiap platform yang dibangun ada di
    manifest index (`docker buildx imagetools inspect --raw`). Hanya varian native yang ditarik
    (`docker pull --platform`). Setiap `docker run` smoke dibatasi `timeout` dan diberi nama
    `urusin-ci-smoke-*` (dihentikan paksa saat waktu habis; hook `cleanup` juga membersihkannya).
  - **Image job tidak menumpuk di daemon**: setelah smoke, `ci-docker` membuang ref `urusin-*@<digest>` milik
    job itu; setelah build, ref `:<sha>`/`@<digest>` lokal (bila ada). `docker image rm` tanpa `-f` dan hanya
    ref milik job itu: tidak ada prune image global, image yang dipakai kontainer produksi tidak tersentuh.
  - **rc-compat** (aktif hanya bila ada tag `rc*`) belum punya varian self-hosted: di runner ini langkahnya
    **dilewati dengan `::warning::`** (bukan gagal); cakupan rc-compat berkurang selama runner cadangan aktif. Cek migrasi aditif
    (`scripts/check-additive-migrations.mjs`, statis: git diff + node) **tetap jalan** di runner ini.
  - Image Playwright (dipin digest) ditarik sekali dan disimpan; tidak ditarik ulang per job.
  - gitleaks dan osv-scanner diunduh sesuai arsitektur runner (checksum dipin) ke `$RUNNER_TEMP`, tanpa sudo.
- **Runner persisten, didaftarkan sekali.** `install.sh` menerima **registration token** sekali pakai (berlaku
  1 jam) lewat stdin dan menjalankan `config.sh --unattended` (tanpa `--ephemeral`, tanpa JIT). Box hanya
  memegang kredensial runner itu sendiri (0600, milik `urusin-ci`); **tidak ada PAT di box**.
  Label: `self-hosted`, `Linux`, `ARM64`, `urusin-self`.
- **Kebersihan antar job.** `actions/checkout` membersihkan workspace di awal job (`clean: true`, bawaan).
  Hook `job-completed` setelah setiap job: hapus `node_modules` di workspace, `pnpm store prune` di `_home`
  (batas keras 1 GB: store dihapus bila lebih), hapus kontainer sisa
  `urusin-ci-pw-*`/`urusin-ci-smoke-*` dan temp `ci-docker` (`ci-docker cleanup`), lalu cetak `df` agar tren disk terlihat di log.
- **Penjaga disk.** Hook `job-started` menggagalkan job bila disk ≥ 88%; `runner-prestart` tidak menyalakan
  runner; `ci-docker` menolak build/pull/run. Tidak ada pembersihan otomatis selain cache builder sendiri.

## Grup docker vs sudoers sempit (keputusan)

Grup `docker` = root di host (bisa `docker run -v /:/host --privileged`). Runner ini **tidak** masuk grup
docker. User `urusin-ci` hanya boleh menjalankan satu skrip root, `/opt/urusin-ci/bin/ci-docker`:

```
Defaults:urusin-ci env_reset, !setenv
urusin-ci ALL=(root) NOPASSWD: /opt/urusin-ci/bin/ci-docker
```

`ci-docker` hanya punya subperintah tetap (`pw`, `build`, `smoke`, `sbom`, `alias`, `builder-*`, `cleanup`, `teardown`)
dengan flag Docker yang ditulis di skrip, bukan dari pemanggil: tanpa `--privileged`, tanpa `--network host`,
tanpa mount host selain workspace runner (divalidasi: direktori nyata di `_work`, milik `urusin-ci`), tanpa
`--allow security.insecure`, image hanya `ghcr.io/bynguts/urusin-{web,fixtures,pendamping}` dan basis
Playwright yang dipin digest. Env uji `URUSIN_CI_*` diabaikan saat berjalan sebagai root.

Sisa risiko yang diterima (repo private, hanya tim yang bisa push):

- Kode repo tetap berjalan: langkah non-Docker (`pnpm build/test`) sebagai `urusin-ci` di host, dan langkah
  E2E/Lighthouse di kontainer dengan `SYS_ADMIN` + `SYS_CHROOT` di bounding set (sama seperti kontainer
  pendamping produksi; kapabilitas efektif proses repo kosong, seccomp dan AppArmor `docker-default` aktif).
- Kontainer buildkit (driver docker-container) berjalan privileged seperti default buildx; langkah `RUN` di
  Dockerfile tetap tidak privileged karena entitlement `security.insecure` tidak pernah diizinkan.
- Runner butuh `sudo`, jadi unit tidak bisa `NoNewPrivileges=yes`.

Karena itu runner ini hanya untuk repo private dan wajib dicopot sebelum Public.

## Batas sumber daya (agent-vm: 2 vCPU, 11 GB RAM, dipakai bersama)

| Bagian                                           | Batas                                                                                                                                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit `urusin-ci-runner` (runner + langkah host)  | `CPUQuota=150%` (1,5 dari 2 CPU), `CPUWeight=20`, `IOWeight=10`, `Nice=10`, `MemoryHigh=3500M`, `MemoryMax=4G`, tanpa swap, `TasksMax=2048`                                                        |
| Kontainer dari `ci-docker` (di luar cgroup unit) | `--cpus 1.5 --cpu-shares 256 --memory 4g --memory-swap 4g --pids-limit 2048`; `pw perf`: `--cpu-period 10000 --cpu-quota 15000` (tetap 1,5 CPU, jeda throttle CFS lebih pendek) ganti `--cpus 1.5` |
| Builder buildkit `urusin-ci`                     | CPU 1,5 (shares 256), memori 4g, cache ≤ 1,5 GB (gc setelah tiap build, 7 hari)                                                                                                                    |
| Paralel                                          | 1 runner = 1 job sekaligus (CI penuh berjalan berurutan, lebih lambat)                                                                                                                             |

Layanan pengguna (proxy :20128, Caddy, kontainer lain, Xvfb :99) selalu punya ≥ 0,5 CPU terjamin dan menang ~5:1 saat CPU berebut (bobot 20 vs 100 / shares 256 vs 1024), serta ≥ 4 GB RAM. Batas 1,5 CPU dipilih karena e2e akun.spec flaky di 1 CPU (lulus 17/17 di 4 CPU). `IOWeight`
hampir tidak berpengaruh di agent-vm (scheduler disk `none`); perlindungan I/O nyata = batas CPU/memori + penjaga disk. Timeout
job berat di workflow otomatis ×3 saat `URUSIN_RUNNER` diset. Skor Lighthouse di ARM 1,5 CPU bisa lebih rendah dari
runner GitHub; bila gagal hanya di runner ini, ulangi atau putuskan di lead (ambang tidak dilonggarkan diam-diam).

## Pasang (hanya setelah go dari lead/pengguna)

Registration token dibuat di mesin lokal (token admin repo tetap di lokal, tidak pernah ke box) dan HANYA
token itu yang dikirim ke box, lewat stdin. Token tidak disimpan; `config.sh` menukarnya dengan kredensial runner.

```sh
# salinan repo (git archive) di /tmp/urusin-ci-install pada agent-vm; tidak membangun image apa pun
ssh ubuntu@agent-vm 'sudo /tmp/urusin-ci-install/deploy/ci-runner/install.sh --dry-run'   # rencana saja
gh api -X POST repos/bynguts/urusin/actions/runners/registration-token --jq .token \
  | ssh ubuntu@agent-vm 'sudo /tmp/urusin-ci-install/deploy/ci-runner/install.sh'          # pasang
gh variable set URUSIN_RUNNER --repo bynguts/urusin --body urusin-self
```

Menjalankan ulang `install.sh` pada runner yang sudah terdaftar tidak membaca token dan tidak mendaftar ulang
(hanya memperbarui skrip, unit, dan builder).

Yang dibuat: user sistem `urusin-ci` (shell nologin, rumah `/opt/urusin-ci`), `/opt/urusin-ci/{bin,etc,runner,buildx}`,
`/etc/sudoers.d/urusin-ci`, `/etc/systemd/system/urusin-ci-runner.service`, builder buildx `urusin-ci`.
Runner `v2.338.2` arm64 dipin sha256. Yang tidak pernah dilakukan: `sysctl`, `daemon.json`, binfmt, iptables/ufw,
`apt install`, prune global, menyentuh kontainer/image/layanan non-Urusin.

Operasi: `systemctl status urusin-ci-runner`, `journalctl -u urusin-ci-runner -f`,
`sudo /opt/urusin-ci/bin/ci-docker builder-gc` (cache builder saja).

## Copot

`uninstall.sh` (aman diulang) menerima **remove-token** sekali pakai lewat stdin (dibuat lokal:
`gh api -X POST repos/bynguts/urusin/actions/runners/remove-token --jq .token`): hentikan unit, `config.sh remove`
(hapus pendaftaran di GitHub), `docker buildx rm urusin-ci` (beserta cache-nya), kontainer sisa `urusin-ci-*`,
sudoers, user, dan `/opt/urusin-ci`. Tanpa token, pendaftaran dihapus manual
(`gh api -X DELETE repos/bynguts/urusin/actions/runners/<id>`). Lalu `gh variable delete URUSIN_RUNNER`.

## Uji

```sh
bash deploy/tests/ci-runner.test.sh   # docker/df palsu: validasi argumen, flag Docker tetap, token via stdin, disk 88%
shellcheck -x deploy/ci-runner/ci-docker deploy/ci-runner/*.sh deploy/ci-runner/runner-prestart deploy/ci-runner/job-*
```
