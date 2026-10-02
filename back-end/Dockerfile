# Coolify (Docker) image for the Louma customer API.
# Multi-stage: build TypeScript in a full toolchain image, ship only
# dist/ + production node_modules in a slim runtime image.

FROM node:20-bookworm-slim AS builder
WORKDIR /app

# argon2 compiles a native binding when no prebuild matches, so the
# builder keeps a compiler toolchain. The runtime stage does not need it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  LOUMA_API_PORT=8000

# Run as an unprivileged user: the app never needs root.
RUN useradd --create-home --shell /usr/sbin/nologin nodejs \
  && chown -R nodejs:nodejs /app
USER nodejs

COPY --from=builder --chown=nodejs:nodejs /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

EXPOSE 8000

# No curl/wget in the slim image: plain node fetch against /health.
# Coolify maps its own check to this endpoint as well.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.LOUMA_API_PORT||process.env.PORT||8000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "--env-file-if-exists=.env.production", "dist/server.js"]
