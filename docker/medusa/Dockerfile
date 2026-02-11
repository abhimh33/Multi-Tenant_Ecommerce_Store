# MedusaJS v1 backend — local development image
# Build: docker build -t medusa-backend:local -f docker/medusa/Dockerfile docker/medusa/
FROM node:20-alpine

WORKDIR /app

# Copy package manifest and config
COPY package.json ./
COPY medusa-config.js ./

# Install dependencies (v1 is much lighter than v2)
RUN npm install && npm cache clean --force

# Create directories Medusa expects at runtime and set ownership
# so the container can run as non-root (uid 1000) in Kubernetes
RUN mkdir -p /app/uploads /app/dist && chown -R 1000:1000 /app

USER 1000

EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
    CMD wget -qO- http://localhost:9000/health || exit 1

# Run migrations then start Medusa server
CMD ["sh", "-c", "npx medusa migrations run && npx medusa start"]
