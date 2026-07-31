# Runs from source (JIT) on purpose — no compile step. Self-written tools in
# /data/tools must be loadable as new Dart source after a restart, which a
# compiled binary cannot do. See ARCHITECTURE.md §3.
FROM dart:stable

# sqlite3 for package:sqlite3; Node.js 22 + obsidian-headless for vault sync (§13).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libsqlite3-0 \
        ca-certificates \
        curl \
        gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g obsidian-headless \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pubspec.* ./
RUN dart pub get

COPY . .

RUN chmod +x supervisor/entrypoint.sh \
    && dart run tool/generate_tool_registry.dart

# Layer-2 supervisor: tool sync, Obsidian sidecar, registry, restart protocol.
ENTRYPOINT ["supervisor/entrypoint.sh"]
