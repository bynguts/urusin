# syntax=docker/dockerfile:1
# Image fixtures Urusin (portal palsu Hono untuk demo/uji). Build dari ROOT repo:
#   docker build -f apps/fixtures/Dockerfile -t urusin-fixtures .
# Multi-arch tanpa QEMU: lihat penjelasan di apps/web/Dockerfile (builder di $BUILDPLATFORM, runtime hanya COPY).
# Profil default `public` (jinak). Profil `local` hanya untuk mesin pengembang dan tidak pernah dijadikan default image.

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
    pnpm install --frozen-lockfile --ignore-scripts --filter @urusin/fixtures...
RUN pnpm turbo run build --filter=@urusin/fixtures...
ARG TARGETARCH
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    case "$TARGETARCH" in amd64) cpu=x64 ;; arm64) cpu=arm64 ;; *) echo "arsitektur tidak didukung: $TARGETARCH" >&2; exit 1 ;; esac \
 && printf 'supportedArchitectures:\n  os: [linux]\n  cpu: [%s]\n  libc: [glibc]\n' "$cpu" >> pnpm-workspace.yaml \
 && pnpm --filter @urusin/fixtures deploy --prod --legacy --ignore-scripts /out \
 && cp -r apps/fixtures/dist /out/dist

FROM node:26-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS runtime
ARG GIT_SHA=dev
# PORT=4000 sesuai pemetaan deploy/compose.prod.yml (127.0.0.1:4320 -> 4000).
ENV NODE_ENV=production \
    GIT_SHA=$GIT_SHA \
    FIXTURES_PROFILE=public \
    PORT=4000
LABEL org.opencontainers.image.source="https://github.com/bynguts/urusin" \
      org.opencontainers.image.revision=$GIT_SHA
WORKDIR /app
COPY --from=builder --chown=node:node /out/node_modules ./node_modules
COPY --from=builder --chown=node:node /out/package.json ./package.json
COPY --from=builder --chown=node:node /out/dist ./dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]
