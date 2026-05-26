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
COPY --chown=node:node index.js metrics.js ./

CMD ["node","index.js"]