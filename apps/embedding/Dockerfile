# syntax=docker/dockerfile:1
# Sidecar embedding Urusin: llama.cpp `llama-server --embeddings` (CPU) + EmbeddingGemma-300M Q8_0.
# Pemenang bake-off packages/embedding/eval/HASIL.md (kualitas tertinggi, ukuran terkecil). Multi-arch tanpa QEMU:
# bobot (netral arsitektur) diunduh di platform builder; tahap akhir hanya MENYALIN (tanpa RUN) per arsitektur.
# Bobot TIDAK pernah ada di git: diunduh saat build pada revisi tetap dan dipin sha256 (beda satu bit = build gagal).
# Image akhir ramping: ubuntu:24.04 polos (basis yang sama dengan image llama.cpp) + /app llama.cpp + libgomp.
# Image server llama.cpp utuh 1,2 GB (curl, python, ratusan pustaka) yang tidak dibutuhkan sidecar.

ARG LLAMA_SERVER=ghcr.io/ggml-org/llama.cpp:server-b12004@sha256:b32890309c1a33a534a01b0b461e953dc2c5a6bac20213abcf48e22847a19c85
ARG BASE=ubuntu:24.04@sha256:2198e4c65076e9cb0b3d695219df667c0e3b0072da64ca3c2648aca17dcecaf5

FROM --platform=$BUILDPLATFORM ${LLAMA_SERVER} AS model
# Konversi resmi organisasi llama.cpp (ggml-org) dari google/embeddinggemma-300m, revisi Git HF dipin.
ARG MODEL_URL=https://huggingface.co/ggml-org/embeddinggemma-300M-GGUF/resolve/0f741b5a6585bd53aeb15cd1372c56f2a0f65e12/embeddinggemma-300M-Q8_0.gguf
ARG MODEL_SHA256=b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63
RUN mkdir -p /out \
  && curl -fsSL --retry 3 --proto '=https' -o /out/model.gguf "$MODEL_URL" \
  && echo "$MODEL_SHA256  /out/model.gguf" | sha256sum -c - \
  && chmod 0444 /out/model.gguf

# Biner llama.cpp untuk arsitektur TARGET (hanya sumber COPY; tidak ada RUN di sini).
FROM ${LLAMA_SERVER} AS llama

FROM ${BASE}
ARG GIT_SHA=dev
LABEL org.opencontainers.image.source="https://github.com/bynguts/urusin" \
      org.opencontainers.image.revision=$GIT_SHA \
      org.opencontainers.image.title="urusin-embedding" \
      org.opencontainers.image.description="Sidecar embedding Urusin (llama.cpp + EmbeddingGemma-300M Q8_0)"
COPY --from=llama /app /app
# Satu-satunya pustaka sistem llama-server yang tidak ada di ubuntu:24.04 polos (libssl/libstdc++ sudah ada).
COPY --from=llama /usr/lib/*-linux-gnu/libgomp.so.1* /usr/local/lib/urusin/
COPY --from=model /out/model.gguf /models/model.gguf
COPY --chmod=0444 apps/embedding/NOTICE /models/NOTICE
COPY --chmod=0555 apps/embedding/embed-smoke.sh /usr/local/bin/embed-smoke
COPY --chmod=0555 apps/embedding/embed-sehat.sh /usr/local/bin/embed-sehat
# Konfigurasi lewat env bawaan llama-server. Konteks 1024 dibagi 2 slot (512 token per permintaan, cukup untuk
# kueri warga, prototipe, dan label tautan); 2 thread = cpus compose. UI web dimatikan; hanya /v1/embeddings + /health.
ENV LD_LIBRARY_PATH=/app:/usr/local/lib/urusin \
    LLAMA_ARG_MODEL=/models/model.gguf \
    LLAMA_ARG_EMBEDDINGS=1 \
    LLAMA_ARG_CTX_SIZE=1024 \
    LLAMA_ARG_N_PARALLEL=2 \
    LLAMA_ARG_BATCH=512 \
    LLAMA_ARG_UBATCH=512 \
    LLAMA_ARG_THREADS=2 \
    LLAMA_ARG_UI=false \
    LLAMA_ARG_HOST=0.0.0.0 \
    LLAMA_ARG_PORT=8080
WORKDIR /app
USER 65534:65534
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD ["/usr/local/bin/embed-sehat"]
ENTRYPOINT ["/app/llama-server"]
