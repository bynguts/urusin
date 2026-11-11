# Runner GitHub Actions kedua (laptop, Linux x64 di Docker Desktop). Image resmi dipin digest.
# Tidak ada token di image: pendaftaran lewat `docker exec -i` (token dari stdin) oleh up.sh.
FROM ghcr.io/actions/actions-runner:2.338.2@sha256:759a1d94a15b05941aba5196974ff43fe15b4cbba29b694b35cbc32a1166b232
# libatomic1: binary @pnpm/exe dari pnpm/action-setup; xz-utils: arsip Node; zstd: kompresi actions/cache.
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends libatomic1 xz-utils zstd \
  && rm -rf /var/lib/apt/lists/*
USER runner
# _work dibuat milik user runner agar volume bernama mewarisi pemiliknya.
RUN mkdir -p /home/runner/_work/_actcache /home/runner/urusin
COPY --chown=runner:runner --chmod=755 entrypoint.sh job-completed.sh /home/runner/urusin/
# pnpm_config_store_dir: satu store persisten di volume, juga untuk `pnpm self-update` milik pnpm/action-setup
# (bawaannya $PNPM_HOME/store, yang dibuat ulang tiap job sehingga pnpm diunduh ulang setiap kali).
ENV ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/home/runner/urusin/job-completed.sh \
    ACTIONS_RUNNER_ACTION_ARCHIVE_CACHE=/home/runner/_work/_actcache \
    pnpm_config_store_dir=/home/runner/_work/.pnpm-store \
    TURBO_CONCURRENCY=2
# TURBO_CONCURRENCY=2: bawaan turbo 10 tugas paralel; di 4 CPU / 2,5 GB tes vitest kehabisan waktu (5 s) karena
# berebut CPU dan swap. Variabel lain (mis. VITEST_MAX_WORKERS) tidak sampai ke tugas karena env mode strict turbo.
ENTRYPOINT ["/home/runner/urusin/entrypoint.sh"]
