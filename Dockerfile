# syntax=docker/dockerfile:1
#
# STATUS: written but not yet built or run by me (no Docker daemon was available while writing it).
# Expect to fix small things on the first `docker compose build`.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ARG WEC_REF=v4.5.0
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 PRIVVY_DATA_DIR=/data \
    PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Chromium comes from Debian, not from Puppeteer's download, so the same image works on amd64 (Unraid)
# and arm64 (Apple Silicon). Fonts matter: pages render and load differently without them.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji git ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

# EDPS Website Evidence Collector, pinned to a release tag, run as a separate process by the cookies plugin.
# The wrapper mirrors the project's own `npm run collect` script (tsx bin/website-evidence-collector.js).
RUN git clone --depth 1 --branch "${WEC_REF}" https://code.europa.eu/EDPS/website-evidence-collector.git /opt/wec \
 && cd /opt/wec && npm install --no-audit --no-fund \
 && printf '#!/bin/sh\ncd /opt/wec && exec npx --no-install tsx bin/website-evidence-collector.js "$@"\n' > /usr/local/bin/website-evidence-collector \
 && chmod +x /usr/local/bin/website-evidence-collector

WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

VOLUME /data
EXPOSE 3000
USER node
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/server/index.js"]
