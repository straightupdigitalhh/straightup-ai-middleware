# ─── Stage 1: Hub-Frontend bauen ─────────────────────────────────
FROM node:22-alpine AS webbuild

WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY web/ ./
RUN npm run build

# ─── Stage 2: Middleware ─────────────────────────────────────────
FROM node:22-alpine

# Git-SHA des Builds als Env verfügbar machen (Startlog, Verifikation
# nach dem Deploy, welcher Stand tatsächlich läuft).
ARG GIT_SHA
ENV GIT_SHA=$GIT_SHA

WORKDIR /app

# Dependencies zuerst (Layer-Caching)
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# TypeScript kompilieren
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm install typescript --save-dev && npx tsc && npm remove typescript

# Cleanup
RUN rm -rf src/ tsconfig.json

# Hub-Frontend aus Stage 1
COPY --from=webbuild /web/dist ./web/dist

# Nicht als root laufen: der Entrypoint startet als root, gibt dem
# node-User das data-Volume (chown) und wechselt dann per su-exec zu ihm.
RUN apk add --no-cache su-exec && chown -R node:node /app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]

EXPOSE 3500

HEALTHCHECK --interval=60s --timeout=5s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:3500/healthz || exit 1

CMD ["node", "dist/index.js"]
