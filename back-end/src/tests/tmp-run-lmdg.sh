#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1
MONGODB_DATABASE=louma_verify_lmdg \
  node --env-file-if-exists=.env.development \
  --import "data:text/javascript,import dns from 'node:dns';dns.setServers(['1.1.1.1','9.9.9.9']);" \
  --import tsx --test src/tests/mining-device.integration.test.ts
status=$?
echo "EXIT=$status"
exit "$status"
