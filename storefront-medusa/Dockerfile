# ─── Build stage ───
FROM node:20-alpine AS build
WORKDIR /app

# Accept build args for tenant branding
# VITE_MEDUSA_BACKEND_URL is intentionally empty so the SPA uses
# same-origin requests (/store/*), which nginx proxies to Medusa.
ARG VITE_MEDUSA_BACKEND_URL=""
ARG VITE_STORE_NAME="My Store"

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─── Production stage ───
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

# nginx:alpine auto-runs envsubst on /etc/nginx/templates/*.template
# at startup, writing results to /etc/nginx/conf.d/.
# We only substitute MEDUSA_BACKEND_URL to avoid clobbering nginx's
# own $uri, $host, $remote_addr variables.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Default backend URL — overridden by Helm deployment env var
ENV MEDUSA_BACKEND_URL=http://localhost:9000

EXPOSE 80

# Run envsubst only on MEDUSA_BACKEND_URL (preserving nginx's $uri etc.),
# then start nginx.
CMD ["/bin/sh", "-c", "envsubst '${MEDUSA_BACKEND_URL}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]

