FROM node:22-alpine

WORKDIR /app

# Dependencies zuerst (Layer-Caching)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# TypeScript kompilieren
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm install typescript --save-dev && npx tsc && npm remove typescript

# Cleanup
RUN rm -rf src/ tsconfig.json

EXPOSE 3500

CMD ["node", "dist/index.js"]
