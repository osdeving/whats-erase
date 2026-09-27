#!/usr/bin/env bash
set -euo pipefail

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$project_dir"

action=${1:-status}
qr_destination=${2:-}
internal_qr=""
destination_tmp=""
keep_qr=false
panel_url="http://localhost:3210"

json_error() {
  local code=$1
  local message=$2
  message=${message//\\/\\\\}
  message=${message//\"/\\\"}
  printf '{"schemaVersion":1,"ok":false,"code":"%s","connected":false,"state":null,"daemonEnabled":false,"setupRequired":false,"qrReady":false,"restartRequired":false,"retryAfterMs":0,"panelUrl":"%s","message":"%s"}' "$code" "$panel_url" "$message"
}

cleanup() {
  if [[ -n "$internal_qr" ]]; then
    docker compose exec -T app rm -f "$internal_qr" "$internal_qr.tmp" >/dev/null 2>&1 || true
  fi
  if [[ -n "$destination_tmp" ]]; then
    rm -f -- "$destination_tmp"
  fi
  if [[ "$keep_qr" != true && -n "$qr_destination" ]]; then
    rm -f -- "$qr_destination"
  fi
}
trap cleanup EXIT

if [[ ! -f .env ]]; then
  json_error "CONFIG_REQUIRED" "O arquivo .env nao foi encontrado. Execute o setup primeiro."
  exit 1
fi

app_port=$(sed -n 's/^APP_PORT=//p' .env 2>/dev/null | tail -n 1 | tr -d '\r')
app_port=${app_port:-3210}
if [[ ! "$app_port" =~ ^[0-9]{1,5}$ ]] || (( app_port < 1 || app_port > 65535 )); then
  json_error "CONFIG_INVALID" "A porta do painel no .env e invalida."
  exit 1
fi
panel_url="http://localhost:${app_port}"

if [[ -n "$qr_destination" ]]; then
  canonical_destination=$(realpath -m -- "$qr_destination")
  qr_directory=$(dirname -- "$canonical_destination")
  qr_basename=$(basename -- "$canonical_destination")
  if [[ "$canonical_destination" != "$qr_destination" ||
        ! "$canonical_destination" =~ ^/mnt/[a-zA-Z]/.+ ||
        ! "$qr_basename" =~ ^WhatsErase-qr-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.png$ ||
        ! -d "$qr_directory" ]]; then
    qr_destination=""
    json_error "QR_PATH_REJECTED" "O destino temporario do QR Code foi recusado."
    exit 1
  fi
  destination_tmp="${qr_destination}.tmp"
  rm -f -- "$qr_destination" "$destination_tmp"
fi

if [[ "$action" == "stop" ]]; then
  stop_state_ok=true
  if docker info >/dev/null 2>&1; then
    if [[ -n "$(docker compose ps --status running -q app 2>/dev/null)" ]]; then
      stop_result=$(docker compose exec -T app node apps/server/dist/launcher-cli.js stop-daemon 2>/dev/null) || stop_state_ok=false
      if [[ "$stop_result" != *'"schemaVersion":1'* || "$stop_result" != *'"code":"DAEMON_STOPPED"'* ]]; then
        stop_state_ok=false
      fi
    fi
    if ! docker compose stop >/dev/null 2>&1; then
      json_error "STOP_FAILED" "Nao foi possivel parar os containers."
      exit 1
    fi
  fi
  if [[ "$stop_state_ok" != true ]]; then
    json_error "STOP_STATE_FAILED" "Os servicos pararam, mas o estado do daemon nao pode ser atualizado."
    exit 1
  fi
  printf '{"schemaVersion":1,"ok":true,"code":"STOPPED","connected":false,"state":null,"daemonEnabled":false,"setupRequired":false,"qrReady":false,"restartRequired":false,"retryAfterMs":0,"panelUrl":"%s","message":"WhatsErase parado; dados e sessao foram preservados."}' "$panel_url"
  exit 0
fi

docker_ready=false
for _ in $(seq 1 20); do
  if docker info >/dev/null 2>&1; then
    docker_ready=true
    break
  fi
  sleep 1
done
if [[ "$docker_ready" != true ]]; then
  json_error "DOCKER_UNAVAILABLE" "O Docker do WSL nao esta disponivel."
  exit 1
fi

if ! docker compose config --quiet >/dev/null 2>&1; then
  json_error "CONFIG_INVALID" "A configuracao do Docker Compose e invalida."
  exit 1
fi

if [[ "$action" == "status" && -z "$(docker compose ps --status running -q app 2>/dev/null)" ]]; then
  printf '{"schemaVersion":1,"ok":true,"code":"STACK_STOPPED","connected":false,"state":null,"daemonEnabled":false,"setupRequired":false,"qrReady":false,"restartRequired":false,"retryAfterMs":0,"panelUrl":"%s","message":"WhatsErase esta parado."}' "$panel_url"
  exit 0
fi

if [[ "$action" == "start" ]]; then
  if ! docker compose up -d --wait --wait-timeout 120 >/dev/null 2>&1; then
    json_error "START_FAILED" "Os containers nao ficaram saudaveis dentro do prazo."
    exit 1
  fi
elif [[ "$action" != "status" ]]; then
  json_error "INVALID_ACTION" "Acao de launcher invalida."
  exit 1
fi

cli_action=status
if [[ "$action" == "start" ]]; then
  cli_action=prepare
  internal_qr="/tmp/whats-erase-qr-$(tr -d '\n' < /proc/sys/kernel/random/uuid).png"
fi

result=$(docker compose exec -T \
  -e "LAUNCHER_PANEL_URL=$panel_url" \
  app node apps/server/dist/launcher-cli.js "$cli_action" "$internal_qr" 2>/dev/null) || {
    json_error "BRIDGE_FAILED" "O container iniciou, mas o estado interno nao pode ser consultado."
    exit 1
  }

if [[ "$result" != *'"schemaVersion":1'* || "$result" != *'"code":"'* || "$result" != *'"ok":'* ]]; then
  json_error "BRIDGE_PROTOCOL_ERROR" "O launcher interno devolveu uma resposta invalida."
  exit 1
fi

if [[ "$result" == *'"restartRequired":true'* ]]; then
  if ! docker compose restart app >/dev/null 2>&1 || ! docker compose up -d --wait --wait-timeout 60 app >/dev/null 2>&1; then
    json_error "APP_RESTART_FAILED" "O daemon foi habilitado, mas o app nao reiniciou corretamente."
    exit 1
  fi
  verified=$(docker compose exec -T \
    -e "LAUNCHER_PANEL_URL=$panel_url" \
    app node apps/server/dist/launcher-cli.js status 2>/dev/null) || {
      json_error "APP_RESTART_FAILED" "O app reiniciou, mas o daemon nao pode ser confirmado."
      exit 1
    }
  if [[ "$verified" != *'"connected":true'* || "$verified" != *'"daemonEnabled":true'* ]]; then
    json_error "APP_RESTART_FAILED" "O app reiniciou, mas o daemon nao ficou pronto."
    exit 1
  fi
  result=${result/\"restartRequired\":true/\"restartRequired\":false}
fi

if [[ "$result" == *'"qrReady":true'* ]]; then
  if [[ -z "$qr_destination" ]]; then
    json_error "QR_PATH_REQUIRED" "O QR Code foi gerado sem um destino temporario valido."
    exit 1
  fi
  if ! docker compose cp "app:${internal_qr}" "$destination_tmp" >/dev/null 2>&1; then
    rm -f -- "$destination_tmp"
    json_error "QR_COPY_FAILED" "O QR Code foi gerado, mas nao pode ser exibido no Windows."
    exit 1
  fi
  qr_size=$(wc -c < "$destination_tmp" | tr -d ' ')
  qr_magic=$(od -An -tx1 -N8 "$destination_tmp" | tr -d ' \n')
  if [[ "$qr_size" -lt 100 || "$qr_size" -gt 2097152 || "$qr_magic" != "89504e470d0a1a0a" ]]; then
    rm -f "$destination_tmp"
    json_error "QR_INVALID" "A Evolution devolveu um QR Code invalido."
    exit 1
  fi
  mv -f "$destination_tmp" "$qr_destination"
  keep_qr=true
fi

printf '%s' "$result"
