# ─── Build stage ───
FROM node:20-alpine AS build
WORKDIR /app

# Accept build args for tenant branding
ARG VITE_MEDUSA_BACKEND_URL
ARG VITE_STORE_NAME

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─── Production stage ───
FROM nginx:alpine

# Custom nginx config for SPA routing
COPY --from=build /app/dist /usr/share/nginx/html

RUN printf 'server {\n\
  listen 80;\n\
  server_name _;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
\n\
  # SPA fallback\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
\n\
  # Proxy Medusa API calls\n\
  location /store/ {\n\
    proxy_pass ${MEDUSA_BACKEND_URL:-http://medusa:9000}/store/;\n\
    proxy_set_header Host $host;\n\
    proxy_set_header X-Real-IP $remote_addr;\n\
  }\n\
\n\
  # Cache static assets\n\
  location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {\n\
    expires 30d;\n\
    add_header Cache-Control "public, immutable";\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
