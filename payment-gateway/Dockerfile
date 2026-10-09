# syntax=docker/dockerfile:1
# Pinned to go1.26.6: govulncheck reports 7 reachable stdlib CVEs (net/http et al.)
# under go1.26.4, all fixed in go1.26.6. Do not float this tag without re-scanning.
FROM golang:1.26.6-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/gateway-api ./cmd/api && \
    CGO_ENABLED=0 go build -trimpath -o /out/gateway-worker ./cmd/worker && \
    CGO_ENABLED=0 go build -trimpath -o /out/gateway-migrate ./cmd/migrate

FROM alpine:3.21
RUN adduser -D -u 10001 gateway
COPY --from=build /out/* /usr/local/bin/
USER gateway
EXPOSE 8090
ENTRYPOINT ["gateway-api"]
