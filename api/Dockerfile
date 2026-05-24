FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

# Runtime Stage

FROM alpine:3.22.4 AS runner

RUN apk add --no-cache nodejs

RUN addgroup -S node && adduser -S node -G node

USER node

WORKDIR /app

COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node index.js .

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["node","index.js"]