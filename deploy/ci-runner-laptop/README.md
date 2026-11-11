# Runner CI kedua di laptop (sementara, repo private saja)

> **WAJIB DICOPOT SEBELUM REPO DIBUAT PUBLIC** (bersama runner agent-vm, lihat
> [`../ci-runner/README.md`](../ci-runner/README.md)). Di repo publik, PR dari fork bisa menulis
> `runs-on: urusin-laptop` dan menjalankan kode di laptop ini.
>
> ```sh
> deploy/ci-runner-laptop/down.sh                       # hapus URUSIN_RUNNER_UJI, kontainer, volume, image, registrasi
> gh variable delete URUSIN_RUNNER_UJI --repo bynguts/urusin   # (sudah oleh down.sh; ulangi bila down.sh gagal di tengah)
> gh api repos/bynguts/urusin/actions/runners --jq '[.runners[] | select(any(.labels[]; .name == "urusin-laptop"))] | length'   # harus 0
> ```

## Kenapa

Runner agent-vm (ARM64, 2 vCPU, dipakai bersama) satu-satunya runner selama menit GitHub Actions tidak bisa
dipakai, sehingga semua job CI antre serial (> 1 jam per run). Runner kedua ini mengambil job yang tidak memakai
`ci-docker` host: `verify`, `coverage`, `rc-compat`, `contract-freeze`, `gitleaks` di `ci.yml`. Job `perf` dan
`e2e` (`sudo -n /opt/urusin-ci/bin/ci-docker pw ...`) tetap di agent-vm.

## Cara kerja

- `ci.yml`, kelima job di atas:
  `runs-on: ${{ (github.event_name != 'pull_request' && vars.URUSIN_RUNNER && (vars.URUSIN_RUNNER_UJI || vars.URUSIN_RUNNER)) || 'ubuntu-latest' }}`.
  Job `pull_request` tetap `ubuntu-latest`; tanpa `URUSIN_RUNNER` semua kembali ke GitHub (variabel laptop
  diabaikan); tanpa `URUSIN_RUNNER_UJI` kelima job kembali ke agent-vm. `perf`/`e2e` tidak pernah membaca
  `URUSIN_RUNNER_UJI` (dijaga `deploy/tests/ci-runner.test.sh`).
- `rc-compat` di runner self-hosted melewati langkah Docker (sudah begitu sejak runner agent-vm); hanya cek
  migrasi aditif yang jalan, jadi kontainer runner tidak butuh socket Docker dan tidak diberi.
- Kontainer `urusin-ci-laptop-N` dari image resmi `ghcr.io/actions/actions-runner:2.338.2` (dipin digest,
  Linux x64), label `urusin-laptop`, `--restart unless-stopped` (ikut hidup lagi setelah reboot / Docker Desktop
  restart). Node dan pnpm dipasang tiap job oleh `actions/setup-node` dan `pnpm/action-setup`; git sudah ada di
  image.
- Runner persisten dengan kebersihan per job (bukan ephemeral, supaya tidak ada token/PAT di kontainer): hook
  `job-completed.sh` menghapus berkas tak terlacak di workspace (`git clean -ffdx`: node_modules, build,
  coverage) dan cache user. Yang sengaja disimpan, karena jaringan laptop ke GitHub lambat (~0,1-0,3 MB/s):
  `.git` workspace (checkout cukup fetch inkremental), arsip action yang dipin SHA
  (`ACTIONS_RUNNER_ACTION_ARCHIVE_CACHE`, "Set up job" tidak mengunduh ulang), Node di `_tool`, dan pnpm store
  lokal (dibatasi `PNPM_STORE_MAX_MB`, bawaan 2048). Di runner ini `ci.yml` mematikan `cache: pnpm` setup-node
  (`runner.name` berawalan `urusin-ci-laptop`) sehingga install memakai store lokal, bukan unduh cache GitHub.
- Token registrasi dibuat `gh` di laptop dan hanya masuk lewat stdin ke `config.sh` di dalam kontainer
  (`ACTIONS_RUNNER_INPUT_TOKEN`, bukan argumen). Tidak ada token di repo, image, env kontainer, atau berkas.

## Batas sumber daya

VM Docker Desktop laptop dibatasi 4 GB RAM + 2 GB swap (`~/.wslconfig`) dan juga menjalankan worker prod
`urusin-worker-id-*` (memori 1,3 GB, 2 CPU). Runner: `--cpus 6 --memory 2g --memory-swap 3g --pids-limit 4096`,
tanpa port terbuka (port 4330/3000 worker tidak disentuh). Ubah lewat env `CPUS`, `MEMORY`, `MEMORY_SWAP`,
`RUNNERS` (jumlah kontainer, bawaan 1) saat `up.sh`. Menaikkan `~/.wslconfig` butuh restart WSL, yang ikut
mematikan worker; jangan dilakukan diam-diam.

Disk: `docker_data.vhdx` ada di C: (sempit). Image runner ~1 GB, workspace dibersihkan setiap job.

## Nyalakan / matikan

```sh
deploy/ci-runner-laptop/up.sh     # build image lokal, daftarkan runner, set URUSIN_RUNNER_UJI=urusin-laptop
deploy/ci-runner-laptop/down.sh   # copot total (variabel dihapus DULU agar job tidak antre ke runner mati)
docker logs -f urusin-ci-laptop-1 # pantau
```

Menjalankan `up.sh` lagi saat kontainer sudah ada hanya memastikan kontainer jalan (tanpa daftar ulang).
Laptop mati/tidur dengan `URUSIN_RUNNER_UJI` masih diset = kelima job antre sampai laptop hidup lagi. Sebelum
laptop dimatikan lama, jalankan `down.sh` (atau `gh variable delete URUSIN_RUNNER_UJI --repo bynguts/urusin`).
