#!/usr/bin/env bash
# verify-os-crm.sh — verification scaffolding for 伴圆 CRM (os-crm). Not product code.
# Launches an isolated instance (own MySQL container, own ports, own secrets) from this checkout,
# drives it, records evidence outside the repo, and tears down only what it started.
# Usage: RUN_ID=<id> verify-os-crm.sh build|launch|doctor|env|api|ui|acceptance|mcp|db|cleanup ...
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$SKILL_DIR/../../.." && pwd)"
RUN_ID="${RUN_ID:-default}"
[[ "$RUN_ID" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "RUN_ID must match [A-Za-z0-9_.-]+" >&2; exit 2; }
SCRATCH="${OSCRM_VERIFY_SCRATCH:-/tmp/os-crm-verify}/$RUN_ID"
EVIDENCE="${OSCRM_VERIFY_EVIDENCE:-$HOME/os-crm-verify-evidence}/$RUN_ID"
CONTAINER="oscrm-verify-$RUN_ID"
MYSQL_IMAGE="${OSCRM_MYSQL_IMAGE:-mysql:8.4}"   # same major as deploy/compose.yml
RUNENV="$SCRATCH/run.env"                       # secrets live here only (mode 600), never in evidence

die() { echo "verify-os-crm: $*" >&2; exit 1; }
log() { echo "[$(date +%H:%M:%S)] $*"; }

docker_cmd() {
  if [[ -n "${DOCKER:-}" ]]; then $DOCKER "$@"; return; fi
  if docker info >/dev/null 2>&1; then docker "$@";
  elif sudo -n docker info >/dev/null 2>&1; then sudo -n docker "$@";
  else die "docker unavailable (neither 'docker' nor 'sudo -n docker' works); set DOCKER=..."; fi
}

check_node() {
  local major; major="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "$major" == 24 ]] || die "Node 24 required (package.json engines >=24 <25); got $(node -v). Put Node 24 first on PATH."
  export COREPACK_HOME="${COREPACK_HOME:-$HOME/.cache/corepack}"; mkdir -p "$COREPACK_HOME"
}

free_port() { node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
hex() { node -p "require('crypto').randomBytes($1).toString('hex')"; }

load_env() { [[ -f "$RUNENV" ]] || die "no instance for RUN_ID=$RUN_ID (run launch first)"; set -a; . "$RUNENV"; set +a; }

# Environment for every app process. Third-party credentials are forced empty so a developer's
# repo-root .env (which Nest ConfigModule and prisma also read) cannot leak real keys into a run.
app_env() {
  load_env
  export NODE_ENV=production DEMO_MODE=true ENABLE_LEGACY_CRON=false
  export DATABASE_URL="mysql://crm:${MYSQL_PASSWORD}@127.0.0.1:${DB_PORT}/tb_crm_demo"
  export HOST=127.0.0.1 PORT="$API_PORT" WEB_HOST=127.0.0.1 WEB_PORT="$WEB_PORT"
  export APP_URL="http://localhost:$WEB_PORT" API_URL="http://127.0.0.1:$API_PORT"
  export JWT_SECRET ENCRYPTION_KEY SEED_ADMIN_PASSWORD
  export DINGTALK_CORP_ID= DINGTALK_APP_KEY= DINGTALK_APP_SECRET= DINGTALK_AGENT_ID= DINGTALK_TENANT_ID=
  export FEISHU_APP_ID= FEISHU_APP_SECRET= FEISHU_TENANT_ID= DASHSCOPE_API_KEY=
  export YONYOU_API_BASE= YONYOU_APP_KEY= YONYOU_APP_SECRET= OSS_ACCESS_KEY_ID= OSS_ACCESS_KEY_SECRET=
}

pid_is() { # pid_is <pidfile> <cmdline-fragment> <expected-cwd>
  local pid; pid="$(cat "$1" 2>/dev/null || true)"; [[ -n "$pid" && -d /proc/$pid ]] || return 1
  tr '\0' ' ' </proc/$pid/cmdline | grep -qF -- "$2" || return 1
  [[ "$(readlink /proc/$pid/cwd)" == "$3" ]]
}

login_token() { # login_token <username>  -> prints access token (never written to evidence)
  curl -fsS -X POST "http://127.0.0.1:$WEB_PORT/api/v1/auth/login" -H 'Content-Type: application/json' \
    -d "$(node -e 'console.log(JSON.stringify({username:process.argv[1],password:process.env.SEED_ADMIN_PASSWORD}))' "$1")" \
    | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).data.accessToken))'
}

cmd_build() {
  check_node; cd "$REPO"
  pnpm install --frozen-lockfile
  pnpm --filter @partneros/database generate
  pnpm build
  git rev-parse HEAD > "$REPO/apps/api/dist/.verify-build-rev"   # inside gitignored dist/
  log "build ok at $(cat apps/api/dist/.verify-build-rev)"
}

cmd_launch() {
  check_node
  [[ -f "$REPO/apps/api/dist/main.js" && -f "$REPO/apps/web/dist/index.html" ]] || die "no build; run: $0 build"
  [[ ! -e "$SCRATCH" ]] || die "$SCRATCH exists; run cleanup for RUN_ID=$RUN_ID first (or pick a new RUN_ID)"
  docker_cmd inspect "$CONTAINER" >/dev/null 2>&1 && die "container $CONTAINER already exists; run cleanup"
  mkdir -p "$SCRATCH" "$EVIDENCE"; chmod 700 "$SCRATCH"
  umask 077
  cat >"$RUNENV" <<ENV
DB_PORT=$(free_port)
API_PORT=$(free_port)
WEB_PORT=$(free_port)
MYSQL_ROOT_PASSWORD=$(hex 24)
MYSQL_PASSWORD=$(hex 24)
JWT_SECRET=$(hex 32)
ENCRYPTION_KEY=$(hex 32)
SEED_ADMIN_PASSWORD=${OSCRM_SEED_PASSWORD:-$(hex 12)}
ENV
  umask 022
  load_env
  # container env file: only what the mysql image needs
  printf 'MYSQL_ROOT_PASSWORD=%s\nMYSQL_DATABASE=tb_crm_demo\nMYSQL_USER=crm\nMYSQL_PASSWORD=%s\n' \
    "$MYSQL_ROOT_PASSWORD" "$MYSQL_PASSWORD" >"$SCRATCH/mysql.env"; chmod 600 "$SCRATCH/mysql.env"
  log "starting MySQL container $CONTAINER ($MYSQL_IMAGE) on 127.0.0.1:$DB_PORT"
  # Network: on Linux default to host networking with mysqld bound to 127.0.0.1:$DB_PORT. In the box this
  # skill was proven on, `-p` was silently ignored (no port published), so publish mode is opt-in.
  local net=(--network host) mysqld_net=(--bind-address=127.0.0.1 --port="$DB_PORT" --mysqlx=OFF)
  if [[ "${OSCRM_DOCKER_NETWORK:-$( [[ $(uname) == Linux ]] && echo host || echo publish )}" == publish ]]; then
    net=(-p "127.0.0.1:$DB_PORT:$DB_PORT"); mysqld_net=(--port="$DB_PORT" --mysqlx=OFF)
  fi
  docker_cmd run -d --name "$CONTAINER" --label oscrm-verify-run="$RUN_ID" --env-file "$SCRATCH/mysql.env" \
    "${net[@]}" "$MYSQL_IMAGE" "${mysqld_net[@]}" --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci >/dev/null
  # Ready = the FINAL server is up (the entrypoint's init server logs "port: 0" and is then restarted;
  # a query alone can hit that init server and pass too early) AND the crm user can query tb_crm_demo.
  local i; for i in $(seq 1 120); do
    docker_cmd logs "$CONTAINER" 2>&1 | grep -q "ready for connections.*port: $DB_PORT" && \
    docker_cmd exec "$CONTAINER" sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysql -h 127.0.0.1 -P "$0" -u crm -D tb_crm_demo -e "SELECT 1"' "$DB_PORT" >/dev/null 2>&1 && break
    sleep 2; [[ $i == 120 ]] && die "MySQL not ready after 240s (docker logs $CONTAINER)"
  done
  log "mysql ready"
  app_env
  cd "$REPO/packages/database"
  # Same steps as README/CI: migrate:deploy, then demo:seed (= seed.ts + demo.ts). Invoked without
  # --env-file so the run's isolated env is the only source of configuration.
  node node_modules/prisma/build/index.js migrate deploy >"$EVIDENCE/migrate.log" 2>&1 || { tail -20 "$EVIDENCE/migrate.log"; die "migrate failed"; }
  node --import tsx prisma/seed.ts >"$EVIDENCE/seed.log" 2>&1 || { tail -20 "$EVIDENCE/seed.log"; die "seed failed"; }
  node --import tsx prisma/demo.ts >>"$EVIDENCE/seed.log" 2>&1 || { tail -20 "$EVIDENCE/seed.log"; die "demo seed failed"; }
  log "migrated + seeded"
  cd "$REPO/apps/api"
  setsid node dist/main.js >"$SCRATCH/api.log" 2>&1 </dev/null & echo $! >"$SCRATCH/api.pid"
  cd "$REPO"
  setsid node scripts/serve-web.mjs >"$SCRATCH/web.log" 2>&1 </dev/null & echo $! >"$SCRATCH/web.pid"
  for i in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:$WEB_PORT/api/v1/health" >/dev/null 2>&1 && \
       curl -fsS "http://127.0.0.1:$WEB_PORT/" | grep -q '伴圆 CRM'; then break; fi
    pid_is "$SCRATCH/api.pid" dist/main.js "$REPO/apps/api" || { tail -30 "$SCRATCH/api.log"; die "API exited"; }
    sleep 0.5; [[ $i == 120 ]] && die "API/web not ready after 60s"
  done
  # usable, not just up: a seeded user can log in and sees seeded customers
  local tok; tok="$(login_token admin)" || die "admin login failed"
  curl -fsS "http://127.0.0.1:$WEB_PORT/api/v1/workspace/overview" -H "Authorization: Bearer $tok" \
    | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=JSON.parse(s).data;if(!(d.customers>0))process.exit(1)})' \
    || die "overview shows no seeded customers"
  cp "$SCRATCH/api.log" "$EVIDENCE/api-launch.log"
  log "ready: web=http://127.0.0.1:$WEB_PORT api=http://127.0.0.1:$API_PORT db=127.0.0.1:$DB_PORT container=$CONTAINER evidence=$EVIDENCE"
}

cmd_doctor() {
  load_env; local ok=1
  chk() { if eval "$2" >/dev/null 2>&1; then echo "  ok   $1"; else echo "  FAIL $1"; ok=0; fi; }
  echo "doctor RUN_ID=$RUN_ID repo=$REPO"
  chk "api pid alive and is this checkout's apps/api dist/main.js" "pid_is '$SCRATCH/api.pid' dist/main.js '$REPO/apps/api'"
  chk "web pid alive and is this checkout's scripts/serve-web.mjs" "pid_is '$SCRATCH/web.pid' scripts/serve-web.mjs '$REPO'"
  chk "api port $API_PORT owned by our pid" "ss -ltnpH 'sport = :$API_PORT' | grep -q 'pid=$(cat "$SCRATCH/api.pid" 2>/dev/null),'"
  chk "web port $WEB_PORT owned by our pid" "ss -ltnpH 'sport = :$WEB_PORT' | grep -q 'pid=$(cat "$SCRATCH/web.pid" 2>/dev/null),'"
  chk "mysql container $CONTAINER running with our label" "[[ \$(docker_cmd inspect -f '{{.State.Running}} {{index .Config.Labels \"oscrm-verify-run\"}}' $CONTAINER) == 'true $RUN_ID' ]]"
  chk "health via web proxy /api/v1/health = 200" "curl -fsS http://127.0.0.1:$WEB_PORT/api/v1/health"
  chk "web serves <title> 伴圆 CRM" "curl -fsS http://127.0.0.1:$WEB_PORT/ | grep -q '伴圆 CRM'"
  chk "admin login with this run's seed password" "login_token admin"
  local rev head; rev="$(cat "$REPO/apps/api/dist/.verify-build-rev" 2>/dev/null || echo unknown)"; head="$(git -C "$REPO" rev-parse HEAD)"
  if [[ "$rev" == "$head" ]]; then echo "  ok   build rev == HEAD ($head)"; else echo "  WARN build rev $rev != HEAD $head (run build, then cleanup+launch)"; fi
  if [[ -n "$(git -C "$REPO" status --porcelain -- apps packages scripts)" ]]; then echo "  WARN uncommitted app changes; dist may not match"; fi
  if (( ok )); then echo "doctor: healthy (RUN_ID=$RUN_ID web=http://127.0.0.1:$WEB_PORT)"; else echo "doctor: NOT healthy — do not drive"; return 1; fi
}

cmd_env() { load_env; cat <<OUT
export RUN_ID=$RUN_ID CRM_URL=http://127.0.0.1:$WEB_PORT DEMO_URL=http://127.0.0.1:$WEB_PORT
export OSCRM_EVIDENCE=$EVIDENCE
export SEED_ADMIN_PASSWORD=$SEED_ADMIN_PASSWORD CRM_PASSWORD=$SEED_ADMIN_PASSWORD
OUT
}

# api <label> <as-user> <METHOD> <path-under-/api/v1> [json-body]
cmd_api() {
  [[ $# -ge 4 ]] || die "usage: api <label> <user> <METHOD> </path> [json]"
  load_env; local label=$1 user=$2 method=$3 path=$4 body=${5:-} tok out="$EVIDENCE/api"
  mkdir -p "$out"; tok="$(login_token "$user")" || die "login as $user failed"
  printf '%s %s /api/v1%s (as %s)\n%s\n' "$(date -Is)" "$method" "$path" "$user" "$body" >"$out/$label.req.txt"
  local args=(-sS -X "$method" "http://127.0.0.1:$WEB_PORT/api/v1$path" -H "Authorization: Bearer $tok" -o "$out/$label.body.json" -w '%{http_code}')
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' -d "$body")
  local code; code="$(curl "${args[@]}")"; echo "$code" >"$out/$label.status"
  cat "$out/$label.body.json"; echo; echo "HTTP $code -> $out/$label.*" >&2
  [[ "$code" =~ ^2 ]]
}

# ui <label> <steps.json>   (see scripts/crm-browser.mjs for the step language)
cmd_ui() {
  [[ $# -ge 2 ]] || die "usage: ui <label> <steps.json>"
  load_env; mkdir -p "$EVIDENCE/ui"
  CRM_URL="http://127.0.0.1:$WEB_PORT" node "$SKILL_DIR/scripts/crm-browser.mjs" "$2" "$EVIDENCE/ui/$1"
}

cmd_acceptance() { # repo's own read-only deployment acceptance, pointed at this instance
  app_env; mkdir -p "$EVIDENCE/cli"; cd "$REPO"
  set +e; DEMO_URL="http://127.0.0.1:$WEB_PORT" node deploy/verify.mjs >"$EVIDENCE/cli/acceptance.stdout" 2>"$EVIDENCE/cli/acceptance.stderr"; local c=$?; set -e
  echo "$c" >"$EVIDENCE/cli/acceptance.exit"; cat "$EVIDENCE/cli/acceptance.stdout" "$EVIDENCE/cli/acceptance.stderr"; return $c
}

cmd_mcp() { # examples/mcp-client.mjs: MCP handshake + 7 read-only tools + customer.search
  app_env; mkdir -p "$EVIDENCE/cli"; cd "$REPO"
  set +e; CRM_URL="http://127.0.0.1:$WEB_PORT" CRM_USERNAME="${1:-sales}" CRM_KEYWORD="${2:-星河}" CRM_PASSWORD="$SEED_ADMIN_PASSWORD" \
    node examples/mcp-client.mjs >"$EVIDENCE/cli/mcp.stdout" 2>"$EVIDENCE/cli/mcp.stderr"; local c=$?; set -e
  echo "$c" >"$EVIDENCE/cli/mcp.exit"; cat "$EVIDENCE/cli/mcp.stdout" "$EVIDENCE/cli/mcp.stderr"; return $c
}

cmd_db() { # db <label> "<read-only SELECT>"  — side-effect check against this run's MySQL
  [[ $# -ge 2 ]] || die "usage: db <label> \"SELECT ...\""
  [[ "$2" =~ ^[[:space:]]*(SELECT|select|SHOW|show) ]] || die "db only runs SELECT/SHOW"
  load_env; mkdir -p "$EVIDENCE/db"
  printf '%s\n' "$2" >"$EVIDENCE/db/$1.sql"
  docker_cmd exec -i "$CONTAINER" sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysql -h 127.0.0.1 -P "$0" -u crm -D tb_crm_demo --default-character-set=utf8mb4 -t' "$DB_PORT" <"$EVIDENCE/db/$1.sql" | tee "$EVIDENCE/db/$1.out"
}

cmd_cleanup() {
  mkdir -p "$EVIDENCE"
  local name; for name in api web; do
    if pid_is "$SCRATCH/$name.pid" "$( [[ $name == api ]] && echo dist/main.js || echo scripts/serve-web.mjs )" "$( [[ $name == api ]] && echo "$REPO/apps/api" || echo "$REPO" )"; then
      kill "$(cat "$SCRATCH/$name.pid")" && log "stopped $name pid $(cat "$SCRATCH/$name.pid")"
    fi
    [[ -f "$SCRATCH/$name.log" ]] && cp "$SCRATCH/$name.log" "$EVIDENCE/$name-final.log"
  done
  if [[ "$(docker_cmd inspect -f '{{index .Config.Labels "oscrm-verify-run"}}' "$CONTAINER" 2>/dev/null || true)" == "$RUN_ID" ]]; then
    docker_cmd rm -f -v "$CONTAINER" >/dev/null && log "removed container $CONTAINER (and its anonymous volume)"
  fi
  rm -rf "$SCRATCH"
  log "evidence kept: $EVIDENCE"
}

case "${1:-}" in
  build|launch|doctor|env|api|ui|acceptance|mcp|db|cleanup) c=$1; shift; "cmd_$c" "$@";;
  *) sed -n '2,6p' "$0"; echo "commands: build | launch | doctor | env | api <label> <user> <METHOD> <path> [json] | ui <label> <steps.json> | acceptance | mcp [user] [keyword] | db <label> \"SELECT ...\" | cleanup"; exit 2;;
esac
