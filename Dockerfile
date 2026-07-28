# Runs from source (JIT) on purpose — no compile step. Self-written tools in
# /data/tools must be loadable as new Dart source after a restart, which a
# compiled binary cannot do. See ARCHITECTURE.md §3.
FROM dart:stable

# sqlite3 native library for package:sqlite3 (state lives in /data/egon.db).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pubspec.* ./
RUN dart pub get

COPY . .

CMD ["dart", "run", "bin/main.dart"]
