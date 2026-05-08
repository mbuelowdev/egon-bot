FROM dart:stable AS build

WORKDIR /app

COPY pubspec.yaml ./
COPY pubspec.lock ./
RUN dart pub get

COPY . .
RUN dart compile exe main.dart -o /app/build/egon-bot

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /runtime/ /
COPY --from=build /app/build/egon-bot /app/egon-bot

CMD ["./egon-bot"]
