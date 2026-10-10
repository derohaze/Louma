# Coolify (Docker) image for the Louma customer API.
# Multi-stage: build TypeScript in a full toolchain image, ship only
# dist/ + production node_modules in a slim runtime image.

FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS builder
WORKDIR /app

# argon2 compiles a native binding when no prebuild matches, so the
# builder keeps a compiler toolchain. The runtime stage does not need it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Coolify injects NODE_ENV=production at build time, which makes `npm ci`
# skip devDependencies and leaves `tsc` missing when we build TypeScript.
# --include=dev forces the build toolchain in; the runner stage still ships
# production-only modules via `npm prune --omit=dev` below.
RUN npm ci --include=dev

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY payment-gateway ./payment-gateway
RUN npm run build \
  && npm prune --omit=dev

FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runner
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

# Readiness checks MongoDB, the gateway contract and its configured Redis limiter.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.LOUMA_API_PORT||8000)+'/ready',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Coolify injects runtime settings; the image contains no environment files.
CMD ["node", "dist/src/server.js"]
