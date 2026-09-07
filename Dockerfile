FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY tsconfig.json ./
COPY src ./src
COPY templates ./templates
COPY docs/godot-cli.md ./docs/godot-cli.md
RUN npm ci && npm run build

# Stock Playwright has no Mesa hardware drivers and silently uses SwiftShader.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
USER root
WORKDIR /app
ENV NODE_ENV=production \
    HOME=/root \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
    GODOT_VERSION=4.7.2 \
    GH_VERSION=2.80.0
ARG TARGETARCH=amd64
ARG GODOT_VERSION=4.7.2
ARG GH_VERSION=2.80.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    wget \
    unzip \
    zip \
    xz-utils \
    bzip2 \
    python3 \
    python3-pip \
    python3-venv \
    python-is-python3 \
    xxd \
    jq \
    ripgrep \
    fd-find \
    file \
    patch \
    make \
    tree \
    less \
    procps \
    bubblewrap \
    xvfb \
    xauth \
    libfontconfig1 \
    libglu1-mesa \
    libx11-6 \
    libxcursor1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxinerama1 \
    libxrandr2 \
    libgl1-mesa-dri \
    libglx-mesa0 \
    libegl-mesa0 \
    libgbm1 \
    libvulkan1 \
    mesa-vulkan-drivers \
    mesa-va-drivers \
  && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  case "${TARGETARCH}" in \
    amd64) GODOT_ARCH=x86_64 ;; \
    arm64) GODOT_ARCH=arm64 ;; \
    *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  curl -fsSL -o /tmp/godot.zip \
    "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-stable/Godot_v${GODOT_VERSION}-stable_linux.${GODOT_ARCH}.zip"; \
  unzip -q /tmp/godot.zip -d /tmp/godot; \
  install -m 0755 /tmp/godot/Godot_v${GODOT_VERSION}-stable_linux.${GODOT_ARCH} /usr/local/bin/godot; \
  curl -fsSL -o /tmp/templates.tpz \
    "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-stable/Godot_v${GODOT_VERSION}-stable_export_templates.tpz"; \
  mkdir -p /root/.local/share/godot/export_templates/${GODOT_VERSION}.stable; \
  unzip -q /tmp/templates.tpz "templates/web_*.zip" -d /tmp/templates; \
  mv /tmp/templates/templates/web_*.zip /root/.local/share/godot/export_templates/${GODOT_VERSION}.stable/; \
  rm -rf /tmp/godot.zip /tmp/godot /tmp/templates.tpz /tmp/templates

RUN set -eux; \
  case "${TARGETARCH}" in \
    amd64) GH_ARCH=amd64 ;; \
    arm64) GH_ARCH=arm64 ;; \
    *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  curl -fsSL -o /tmp/gh.tgz \
    "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${GH_ARCH}.tar.gz"; \
  tar -xzf /tmp/gh.tgz -C /tmp; \
  install -m 0755 "/tmp/gh_${GH_VERSION}_linux_${GH_ARCH}/bin/gh" /usr/local/bin/gh; \
  rm -rf /tmp/gh.tgz "/tmp/gh_${GH_VERSION}_linux_${GH_ARCH}"; \
  gh --version

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev \
  && npx playwright-core install --with-deps --no-shell chromium \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist ./dist
COPY playwright-mcp.json ./
RUN mkdir -p /data /game
VOLUME ["/data", "/game"]
CMD ["node", "dist/index.js"]
