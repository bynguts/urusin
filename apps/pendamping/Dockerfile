# syntax=docker/dockerfile:1
# Image Browser Pendamping (Chromium HEADED per sesi warga, di atas Xvfb). Build dari ROOT repo:
#   docker build -f apps/pendamping/Dockerfile -t urusin-pendamping .
#
# Basis runtime = image resmi Playwright 1.65 (Ubuntu noble, Node 26, Chromium + semua pustaka sistem + Xvfb
# sudah terpasang, multi-arch amd64/arm64; sudah ada di cache agent-vm). Versi Chromium cocok dengan
# playwright-core 1.65.0 di lockfile. Tahap runtime HANYA COPY (tanpa RUN), jadi build silang arm64 di
# runner amd64 tidak butuh QEMU, sama seperti web/fixtures.
#
# Headed, bukan headless: situs ber-Cloudflare menantang Chromium headless (diukur tim). Flag Chromium
# bawaan Playwright tidak diubah (tanpa stealth, tanpa menyembunyikan otomasi; lihat tanpa-evasi.test.ts).
# Isolasi: sandbox Chromium AKTIF (userns + seccomp-bpf; butuh profil seccomp Playwright dan SYS_CHROOT dari
# compose) dan diperiksa saat boot. Kontainer pendamping hanya di jaringan internal compose; satu-satunya jalan
# keluar adalah pendamping-edge (image yang sama, `node dist/edge-main.js`). Lihat deploy/compose.prod.yml.

FROM --platform=$BUILDPLATFORM node:26-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS builder
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    HUSKY=0 \
    npm_config_store_dir=/pnpm/store
RUN npm install -g pnpm@11.1.1 --no-fund --no-audit
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter @urusin/pendamping...
RUN pnpm turbo run build --filter=@urusin/pendamping...
ARG TARGETARCH
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    case "$TARGETARCH" in amd64) cpu=x64 ;; arm64) cpu=arm64 ;; *) echo "arsitektur tidak didukung: $TARGETARCH" >&2; exit 1 ;; esac \
 && printf 'supportedArchitectures:\n  os: [linux]\n  cpu: [%s]\n  libc: [glibc]\n' "$cpu" >> pnpm-workspace.yaml \
 && pnpm --filter @urusin/pendamping deploy --prod --legacy --ignore-scripts /out \
 && cp -r apps/pendamping/dist /out/dist

FROM mcr.microsoft.com/playwright:v1.65.0-noble@sha256:6e3fb709361521eb27161606e6da6d2674e5e89fa16516cb37d6fdd91372273d AS runtime
ARG GIT_SHA=dev
# Bawaan 127.0.0.1; compose produksi memakai HOST=antarmuka (IPv4 jaringan internal, lihat compose.prod.yml).
# Root filesystem read-only di produksi: Chromium headed menulis ke HOME/XDG (crashpad, cache), jadi semuanya
# diarahkan ke /tmp (tmpfs, hilang saat kontainer berhenti). Tanpa ini Chromium headed gagal start.
ENV NODE_ENV=production \
    GIT_SHA=$GIT_SHA \
    HOST=127.0.0.1 \
    PORT=4330 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    HOME=/tmp \
    XDG_CONFIG_HOME=/tmp/.config \
    XDG_CACHE_HOME=/tmp/.cache
LABEL org.opencontainers.image.source="https://github.com/bynguts/urusin" \
      org.opencontainers.image.revision=$GIT_SHA
WORKDIR /app
COPY --from=builder --chown=pwuser:pwuser /out/node_modules ./node_modules
COPY --from=builder --chown=pwuser:pwuser /out/package.json ./package.json
COPY --from=builder --chown=pwuser:pwuser /out/dist ./dist
USER pwuser
EXPOSE 4330
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "dist/sehat.js"]
# Satu Xvfb (dengan cookie X acak, tanpa TCP) dijalankan dan dihentikan oleh proses Node sendiri (src/xvfb.ts);
# compose memakai `init: true` agar SIGTERM sampai ke Node dan proses Chromium yatim dipungut.
CMD ["node", "dist/main.js"]
