# Runs from source (JIT) on purpose — no compile step. Self-written tools in
# /data/tools must be loadable as new Dart source after a restart, which a
# compiled binary cannot do. See ARCHITECTURE.md §3 / §10.
FROM dart:stable AS whisper-build

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        git \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git \
    && cmake -S whisper.cpp -B whisper.cpp/build \
    && cmake --build whisper.cpp/build -j"$(nproc)" --target whisper-cli \
    && curl -L --fail \
         -o /src/ggml-small.bin \
         https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin

FROM dart:stable

# sqlite3, ffmpeg, poppler (pdftotext), Node 22 + obsidian-headless.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libsqlite3-0 \
        ca-certificates \
        curl \
        gnupg \
        ffmpeg \
        poppler-utils \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g obsidian-headless \
    && rm -rf /var/lib/apt/lists/*

COPY --from=whisper-build /src/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper-build /src/ggml-small.bin /models/ggml-small.bin

ENV WHISPER_MODEL=small \
    WHISPER_MODEL_PATH=/models/ggml-small.bin \
    WHISPER_CLI=/usr/local/bin/whisper-cli

WORKDIR /app

COPY pubspec.* ./
RUN dart pub get

COPY . .

RUN chmod +x supervisor/entrypoint.sh \
    && dart run tool/generate_tool_registry.dart

# Layer-2 supervisor: tool sync, Obsidian sidecar, registry, restart protocol.
ENTRYPOINT ["supervisor/entrypoint.sh"]
