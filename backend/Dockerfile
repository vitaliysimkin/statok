FROM oven/bun:1.2-alpine
RUN apk add --no-cache postgresql16-client

WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared packages/shared
COPY backend/package.json backend/package.json
RUN bun install --frozen-lockfile

COPY backend/ backend/

EXPOSE 3000
CMD ["bun", "run", "backend/src/index.ts"]
