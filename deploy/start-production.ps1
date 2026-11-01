$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
docker compose version
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop with Compose v2 is required' }
if (-not (Test-Path 'deploy/production.env')) {
  docker run --rm -e TENANT_CODE -e TENANT_NAME -e SEED_ADMIN_PASSWORD -e ADMIN_USERNAME -e APP_URL -e WEB_PORT -v "${PWD}:/work" -w /work node:24-bookworm-slim node deploy/configure-production.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Configuration failed' }
}
docker compose --env-file deploy/production.env -f deploy/compose.production.yml up -d --build --wait --wait-timeout 900
if ($LASTEXITCODE -ne 0) { throw 'Startup failed; inspect deployment logs' }
Write-Host 'CRM started. Use the company code and administrator from deploy/production.env.'
