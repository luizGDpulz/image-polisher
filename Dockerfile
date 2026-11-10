# Stage 1: Build Astro Static Assets
FROM --platform=$BUILDPLATFORM node:24-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# Stage 2: Hardened Non-Root Nginx Runtime
FROM nginx:alpine AS runtime

RUN sed -i 's,^\(pid\s*\).*,\1/tmp/nginx.pid;,' /etc/nginx/nginx.conf \
    && sed -i '/^user /d' /etc/nginx/nginx.conf \
    && rm -f /etc/nginx/conf.d/default.conf \
    && chown -R nginx:nginx /var/cache/nginx /var/log/nginx /etc/nginx/conf.d

COPY --chown=nginx:nginx docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
