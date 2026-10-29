# Ad Week server. Node 26 runs the TypeScript directly and has SQLite built in, so there's no build step.
FROM node:26-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/adweek.db \
    TZ=America/Chicago

WORKDIR /app

# Runtime dependencies only (TypeScript is a dev dependency used for type-checking).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

# The database (deals cache + your list) lives in a volume so it survives rebuilds.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
USER node

EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:3000/api/config').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.ts"]
