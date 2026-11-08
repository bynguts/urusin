# syntax=docker/dockerfile:1
# Image web Urusin (SvelteKit + adapter-node). Build dari ROOT repo:
#   docker build -f apps/web/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t urusin-web .
# Multi-arch (linux/amd64 + linux/arm64) TANPA QEMU:
#   - JS tidak bergantung arsitektur, jadi stage `builder` selalu berjalan di $BUILDPLATFORM (native).
#   - Modul native (better-sqlite3 membawa prebuild linux-x64 dan linux-arm64 di dalam paket npm;
#     sqlite-vec lewat paket opsional sqlite-vec-linux-{x64,arm64}) diambil untuk $TARGETARCH lewat
#     `supportedArchitectures` pada `pnpm deploy --prod`; tidak ada yang dieksekusi di arsitektur target.
#   - Stage `runtime` hanya COPY, tanpa RUN, sehingga tidak butuh emulasi.
# Base Debian (glibc) supaya prebuild glibc yang dipakai.

# ---- builder: berjalan di platform runner (amd64), bersama untuk semua target ----
FROM --platform=$BUILDPLATFORM node:26-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS builder
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    HUSKY=0 \
    npm_config_store_dir=/pnpm/store
# Versi pnpm harus sama dengan "packageManager" di package.json.
RUN npm install -g pnpm@11.1.1 --no-fund --no-audit
WORKDIR /repo
COPY . .
# --ignore-scripts: tidak ada skrip lifecycle dependensi yang jalan (selaras allowBuilds di pnpm-workspace.yaml).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter @urusin/web...
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
RUN pnpm turbo run build --filter=@urusin/web...
# TARGETARCH dideklarasikan setelah build agar layer di atas dipakai bersama oleh kedua arsitektur.
ARG TARGETARCH
# Paket produksi saja untuk arsitektur target (termasuk modul native), plus direktori data kosong.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    case "$TARGETARCH" in amd64) cpu=x64 ;; arm64) cpu=arm64 ;; *) echo "arsitektur tidak didukung: $TARGETARCH" >&2; exit 1 ;; esac \
 && printf 'supportedArchitectures:\n  os: [linux]\n  cpu: [%s]\n  libc: [glibc]\n' "$cpu" >> pnpm-workspace.yaml \
 && pnpm --filter @urusin/web deploy --prod --legacy --ignore-scripts /out \
 && cp -r apps/web/build /out/build \
 && mkdir /data-empty

# ---- runtime: platform target; hanya COPY ----
FROM node:26-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS runtime
ARG GIT_SHA=dev
ENV NODE_ENV=production \
    GIT_SHA=$GIT_SHA \
    PORT=3000 \
    HOST=0.0.0.0 \
    BODY_SIZE_LIMIT=6M \
    DATABASE_URL=file:/data/urusin.db
# ORIGIN wajib diberikan saat run (mis. https://urusin.example.com); tidak ada default.
LABEL org.opencontainers.image.source="https://github.com/bynguts/urusin" \
      org.opencontainers.image.revision=$GIT_SHA
WORKDIR /app
COPY --from=builder --chown=node:node /out/node_modules ./node_modules
COPY --from=builder --chown=node:node /out/package.json ./package.json
COPY --from=builder --chown=node:node /out/build ./build
COPY --from=builder --chown=node:node /data-empty /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "build"]
