# Runs from source (JIT) on purpose — no compile step. Self-written tools in
# /data/tools must be loadable as new Dart source after a restart, which a
# compiled binary cannot do. See ARCHITECTURE.md §3 / §10.
#
# Dart SDK and the whisper weights are NOT baked into the image: mount them
# from the host (see deployment.json):
#   /opt/dart-sdk          → /usr/lib/dart
#   /opt/whisper/ggml-*.bin → /models/ggml-*.bin
FROM debian:bookworm-slim AS whisper-build

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        git \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git \
    && cmake -S whisper.cpp -B whisper.cpp/build \
    && cmake --build whisper.cpp/build -j"$(nproc)" --target whisper-cli

FROM debian:bookworm-slim

# Host-mounted Dart SDK (deployment.json).
ENV PATH="/usr/lib/dart/bin:${PATH}"

# sqlite3 (dev package provides the libsqlite3.so symlink Dart FFI needs;
# runtime-only libsqlite3-0 only ships libsqlite3.so.0), ffmpeg, poppler
# (pdftotext), Node 22 + obsidian-headless, whisper-cli runtime deps.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libsqlite3-dev \
        ca-certificates \
        curl \
        gnupg \
        ffmpeg \
        poppler-utils \
        libgomp1 \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g obsidian-headless \
    && rm -rf /var/lib/apt/lists/*

COPY --from=whisper-build /src/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli

RUN mkdir -p /models

ENV WHISPER_MODEL=small \
    WHISPER_MODEL_PATH=/models/ggml-small.bin \
    WHISPER_CLI=/usr/local/bin/whisper-cli

WORKDIR /app

COPY . .

# Registry + pub get run at container start (supervisor), using the mounted SDK.
RUN chmod +x supervisor/entrypoint.sh

ENTRYPOINT ["supervisor/entrypoint.sh"]
