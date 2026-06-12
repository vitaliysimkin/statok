FROM oven/bun:1.2-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY frontend/package.json frontend/
COPY packages/ packages/
RUN bun install --frozen-lockfile
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
WORKDIR /app/frontend
RUN bun run build

FROM nginx:stable-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
