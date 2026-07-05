FROM node:22-alpine

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
