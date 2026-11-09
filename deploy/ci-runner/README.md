# Runner CI self-hosted (cadangan bila menit GitHub Actions habis)

> **SEBELUM REPO DIBUAT PUBLIC (submission LOGICODIX, tenggat 2026-11-14): COPOT RUNNER INI.**
> Di repo publik, siapa pun bisa membuka PR dari fork, dan workflow `pull_request` akan menjalankan kode
> mereka di runner self-hosted, yaitu **di agent-vm** (bersama Caddy, proxy :20128, situs pengguna, Xvfb :99).
> Repo publik juga mendapat menit runner GitHub **gratis tanpa batas**, jadi runner ini tidak dibutuhkan lagi.
>
> ```sh
> sudo deploy/ci-runner/uninstall.sh                      # di agent-vm
> gh variable delete URUSIN_RUNNER --repo bynguts/urusin  # semua job kembali ke ubuntu-latest
> gh api repos/bynguts/urusin/actions/runners --jq .total_count   # harus 0
> ```
>
> Lalu cabut fine-grained PAT admin yang dipakai runner. Baru setelah itu ubah visibilitas repo ke Public.

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
    dibatasi 8 GB di `buildkitd.toml`). Membersihkan cache HANYA lewat `ci-docker builder-gc`
    (`docker buildx prune --builder urusin-ci`) atau `ci-docker builder-rm`. Tidak pernah prune global, tidak
    pernah `daemon.json`. amd64 dibangun lewat binfmt `qemu-x86_64` yang **sudah** terdaftar di host (paket
    distro); CI tidak pernah memasang binfmt. Smoke test: arm64 native (boot pendamping penuh dengan pengerasan
    compose), amd64 lewat binfmt. Output tetap `DIGEST: sha256:...` di log job, sama dengan runner GitHub.
  - **rc-compat** (aktif hanya bila ada tag `rc*`) belum punya varian self-hosted: job gagal dengan pesan jelas.
  - gitleaks dan osv-scanner diunduh sesuai arsitektur runner (checksum dipin) ke `$RUNNER_TEMP`, tanpa sudo.
- **Runner sekali pakai (JIT).** `runner-prestart` (root) meminta konfigurasi JIT ke GitHub untuk tiap job;
  runner JIT selalu ephemeral: satu job, lalu keluar dan terhapus. `_work` dikosongkan sebelum runner baru.
  Label: `self-hosted`, `Linux`, `ARM64`, `urusin-self`.
- **Penjaga disk.** Hook `job-started` menggagalkan job bila disk ≥ 88%; `runner-prestart` tidak mendaftarkan
  runner baru; `ci-docker` menolak build/pull/run. Tidak ada pembersihan otomatis selain cache builder sendiri.

## Grup docker vs sudoers sempit (keputusan)

Grup `docker` = root di host (bisa `docker run -v /:/host --privileged`). Runner ini **tidak** masuk grup
docker. User `urusin-ci` hanya boleh menjalankan satu skrip root, `/opt/urusin-ci/bin/ci-docker`:

```
Defaults:urusin-ci env_reset, !setenv
urusin-ci ALL=(root) NOPASSWD: /opt/urusin-ci/bin/ci-docker
```

`ci-docker` hanya punya subperintah tetap (`pw`, `build`, `smoke`, `sbom`, `alias`, `builder-*`, `teardown`)
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

| Bagian                                           | Batas                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit `urusin-ci-runner` (runner + langkah host)  | `CPUQuota=150%` (1,5 dari 2 CPU), `CPUWeight=20`, `IOWeight=10`, `Nice=10`, `MemoryHigh=3500M`, `MemoryMax=4G`, tanpa swap, `TasksMax=2048` |
| Kontainer dari `ci-docker` (di luar cgroup unit) | `--cpus 1.5 --cpu-shares 256 --memory 4g --memory-swap 4g --pids-limit 2048`                                                                |
| Builder buildkit `urusin-ci`                     | CPU 1,5 (shares 256), memori 4g, cache ≤ 8 GB (gc 7 hari)                                                                                   |
| Paralel                                          | 1 runner = 1 job sekaligus (CI penuh berjalan berurutan, lebih lambat)                                                                      |

Layanan pengguna (proxy :20128, Caddy, kontainer lain, Xvfb :99) selalu punya ≥ 0,5 CPU terjamin dan menang ~5:1 saat CPU berebut (bobot 20 vs 100 / shares 256 vs 1024), serta ≥ 4 GB RAM. Batas 1,5 CPU dipilih karena e2e akun.spec flaky di 1 CPU (lulus 17/17 di 4 CPU). `IOWeight`
hampir tidak berpengaruh di agent-vm (scheduler disk `none`); perlindungan I/O nyata = batas CPU/memori + penjaga disk. Timeout
job berat di workflow otomatis ×3 saat `URUSIN_RUNNER` diset. Skor Lighthouse di ARM 1,5 CPU bisa lebih rendah dari
runner GitHub; bila gagal hanya di runner ini, ulangi atau putuskan di lead (ambang tidak dilonggarkan diam-diam).

## Pasang (hanya setelah go dari lead/pengguna)

Butuh fine-grained PAT khusus repo `bynguts/urusin` dengan izin **Administration: Read and write** (untuk
`generate-jitconfig` dan menghapus runner saat uninstall). Token hanya lewat stdin, disimpan root-only 0600.

```sh
# di agent-vm, dari salinan repo (git archive) di /tmp; tidak membangun image apa pun
sudo deploy/ci-runner/install.sh --dry-run           # rencana saja
sudo deploy/ci-runner/install.sh < /path/token-admin  # pasang (token lewat stdin; hapus berkasnya setelah)
gh variable set URUSIN_RUNNER --repo bynguts/urusin --body urusin-self
```

Yang dibuat: user sistem `urusin-ci` (shell nologin, rumah `/opt/urusin-ci`), `/opt/urusin-ci/{bin,etc,runner,buildx}`,
`/etc/sudoers.d/urusin-ci`, `/etc/systemd/system/urusin-ci-runner.service`, builder buildx `urusin-ci`.
Runner `v2.338.2` arm64 dipin sha256. Yang tidak pernah dilakukan: `sysctl`, `daemon.json`, binfmt, iptables/ufw,
`apt install`, prune global, menyentuh kontainer/image/layanan non-Urusin.

Operasi: `systemctl status urusin-ci-runner`, `journalctl -u urusin-ci-runner -f`,
`sudo /opt/urusin-ci/bin/ci-docker builder-gc` (cache builder saja).

## Copot

`sudo deploy/ci-runner/uninstall.sh` (aman diulang): hentikan unit, hapus pendaftaran runner `urusin-self` di
GitHub, `docker buildx rm urusin-ci` (beserta cache-nya), kontainer sisa `urusin-ci-*`, sudoers, user, dan
`/opt/urusin-ci`. Lalu `gh variable delete URUSIN_RUNNER` dan cabut PAT admin.

## Uji

```sh
bash deploy/tests/ci-runner.test.sh   # docker/df palsu: validasi argumen, flag Docker tetap, token via stdin, disk 88%
shellcheck -x deploy/ci-runner/ci-docker deploy/ci-runner/*.sh deploy/ci-runner/runner-* deploy/ci-runner/job-started
```
