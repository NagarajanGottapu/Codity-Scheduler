# ============================================================================
# CODITY DISTRIBUTED JOB SCHEDULER - MULTI-STAGE DOCKERFILE
# ============================================================================

# 1. BUILD CLIENT
FROM node:22-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# 2. BUILD SERVER
FROM node:22-alpine AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install
COPY server/ ./
RUN npm run build

# 3. PRODUCTION RUNTIME
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Install production dependencies for server
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Copy compiled backend from server-builder
COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=server-builder /app/server/src/db/schema.sql ./server/dist/db/schema.sql
COPY --from=server-builder /app/server/src/db/schema.sql ./server/src/db/schema.sql

# Copy compiled frontend from client-builder
COPY --from=client-builder /app/client/dist ./client/dist

# Create persistent data directory
RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

WORKDIR /app/server
CMD ["node", "dist/index.js"]
