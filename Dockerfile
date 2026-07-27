# Runs from source (JIT) on purpose — no compile step. Self-written tools in
# /data/tools must be loadable as new Dart source after a restart, which a
# compiled binary cannot do. See ARCHITECTURE.md §3.
FROM dart:stable

WORKDIR /app

COPY pubspec.* ./
RUN dart pub get

COPY . .

CMD ["dart", "run", "bin/main.dart"]
