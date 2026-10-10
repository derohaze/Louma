# syntax=docker/dockerfile:1
# go1.26.9 fixes the reachable stdlib advisories found by the 2026-10-10 scan.
# Keep the toolchain and image digests pinned; re-scan when updating.
FROM golang:1.26.9-alpine@sha256:cdfd4fe2da6b225d8b40c6b7a105736e548e83ff56d5d8f9394446eeb5eb84e0 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download && go mod verify
COPY cmd ./cmd
COPY internal ./internal
COPY web ./web
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/gateway-api ./cmd/api && \
    CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/gateway-worker ./cmd/worker && \
    CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/gateway-migrate ./cmd/migrate

FROM alpine:3.21@sha256:ce64758a109eb420d874a118f87920e625e12d3634e03b4a5573fd9f6e5d3507 AS runtime
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 gateway
WORKDIR /app
ENV GATEWAY_ADDRESS=0.0.0.0:8090
USER 10001:10001
STOPSIGNAL SIGTERM

FROM runtime AS worker
COPY --from=build --chmod=0555 /out/gateway-worker /usr/local/bin/gateway-worker
ENTRYPOINT ["gateway-worker"]

FROM runtime AS migrate
COPY --from=build --chmod=0555 /out/gateway-migrate /usr/local/bin/gateway-migrate
ENTRYPOINT ["gateway-migrate"]

# Default target for Coolify's Dockerfile build pack.
FROM runtime AS api
COPY --from=build --chmod=0555 /out/gateway-api /usr/local/bin/gateway-api
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget -q -T 8 -O /dev/null http://127.0.0.1:8090/readyz || exit 1
ENTRYPOINT ["gateway-api"]
