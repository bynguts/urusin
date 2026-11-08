# syntax=docker/dockerfile:1
# Image Browser Pendamping (Chromium di server per sesi warga). Build dari ROOT repo:
#   docker build -f apps/pendamping/Dockerfile -t urusin-pendamping .
#
# Builder berjalan di $BUILDPLATFORM (JS identik untuk semua arsitektur), seperti apps/web/Dockerfile.
# BEDA dengan web/fixtures: tahap runtime menjalankan `playwright install --with-deps` untuk arsitektur
# TARGET (paket apt + Chromium headless shell linux-arm64/x64). Build arm64 di mesin arm64 (agent-vm)
# berjalan native; build silang dari amd64 butuh QEMU/binfmt. Karena itu image ini belum masuk matriks
# .github/workflows/release.yml (yang sengaja tanpa QEMU).
#
# Isolasi: Playwright meluncurkan Chromium dengan --no-sandbox (bawaan chromiumSandbox: false) karena
# kontainer berjalan tanpa capability (cap_drop ALL, no-new-privileges); batas keamanannya kontainer +
# proxy egress per sesi (lihat docs/adr/0028-browser-pendamping.md).

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

FROM node:26-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS runtime
ARG GIT_SHA=dev
# PORT=4000 sesuai deploy/compose.prod.yml (layanan `pendamping`, hanya jaringan internal compose).
ENV NODE_ENV=production \
    GIT_SHA=$GIT_SHA \
    PORT=4000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
LABEL org.opencontainers.image.source="https://github.com/bynguts/urusin" \
      org.opencontainers.image.revision=$GIT_SHA
WORKDIR /app
COPY --from=builder --chown=node:node /out/node_modules ./node_modules
COPY --from=builder --chown=node:node /out/package.json ./package.json
COPY --from=builder --chown=node:node /out/dist ./dist
# Hanya Chromium headless shell (tanpa Chrome penuh/ffmpeg) + pustaka sistem & font yang dibutuhkannya.
# Versi browser terkunci oleh playwright-core di lockfile.
RUN node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
 && rm -rf /var/lib/apt/lists/* /root/.cache \
 && chmod -R a+rX /ms-playwright
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
