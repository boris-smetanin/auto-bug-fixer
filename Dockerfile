# syntax=docker/dockerfile:1.7

FROM node:22-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 build-essential ca-certificates git gosu \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm install --include=dev
COPY . .
RUN npm run build
RUN npm prune --omit=dev


FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    CORS_ORIGIN=* \
    MIGRATIONS_PATH=/app/server/dist/migrations \
    CLAUDE_PLUGIN_PATH=/app/server/dist/integrations/claude/plugin \
    HOME=/home/node
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gosu \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data /home/node/.config /home/node/.cache \
 && chown -R node:node /data /home/node
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/server/package.json ./server/
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/web/dist ./web/dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost:3000/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server/dist/index.js"]
