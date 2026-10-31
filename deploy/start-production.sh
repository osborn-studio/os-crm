#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker compose version >/dev/null
if [ ! -f deploy/production.env ]; then
  : "${TENANT_CODE:?Set company code}" "${TENANT_NAME:?Set company name}" "${SEED_ADMIN_PASSWORD:?Set administrator password}"
  docker run --rm --user "$(id -u):$(id -g)" -e TENANT_CODE -e TENANT_NAME -e SEED_ADMIN_PASSWORD -e ADMIN_USERNAME -e APP_URL -e WEB_PORT -v "$PWD:/work" -w /work node:24-bookworm-slim node deploy/configure-production.mjs
fi
docker compose --env-file deploy/production.env -f deploy/compose.production.yml up -d --build --wait --wait-timeout 900
printf '\nCRM installation started. Use the company code and administrator from deploy/production.env.\n'
