# syntax=docker/dockerfile:1
# Image web Urusin (SvelteKit + adapter-node). Build dari ROOT repo:
#   docker build -f apps/web/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t urusin-web .
# Multi-arch (linux/amd64 + linux/arm64). Base Debian (glibc) agar prebuilt binary
# better-sqlite3 dan sqlite-vec (sqlite-vec-linux-{x64,arm64}) langsung dipakai tanpa kompilasi musl.
FROM node:26-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \n    HUSKY=0 \n    npm_config_store_dir=/pnpm/store
# Versi pnpm harus sama dengan "packageManager" di package.json.
RUN npm install -g pnpm@11.1.1 --no-fund --no-audit

# ---- builder: toolchain hanya di stage ini (fallback bila prebuilt native tidak tersedia) ----
FROM base AS builder
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
RUN pnpm turbo run build --filter=@urusin/web...
# Paket produksi saja (termasuk modul native) untuk image runtime.
RUN pnpm --filter @urusin/web deploy --prod --legacy /out \
 && cp -r apps/web/build /out/build

# ---- runtime ----
FROM base AS runtime
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
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "build"]
