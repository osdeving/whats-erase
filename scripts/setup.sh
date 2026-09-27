#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
env_file="$project_dir/.env"

if [ -f "$env_file" ]; then
  printf '%s\n' ".env ja existe; nada foi sobrescrito."
  exit 0
fi

app_db_password=$(openssl rand -hex 24)
evolution_db_password=$(openssl rand -hex 24)
encryption_key=$(openssl rand -base64 32 | tr -d '\n')
session_secret=$(openssl rand -hex 32)
evolution_key=$(openssl rand -hex 32)

umask 077
sed \
  -e "s|change-me-app-db|$app_db_password|" \
  -e "s|change-me-evolution-db|$evolution_db_password|" \
  -e "s|change-me-base64-32-bytes|$encryption_key|" \
  -e "s|change-me-at-least-32-characters|$session_secret|" \
  -e "s|change-me-evolution-api-key|$evolution_key|" \
  "$project_dir/.env.example" > "$env_file"

printf '%s\n' "Segredos gerados em $env_file (permissao 600)."
printf '%s\n' "Agora execute: docker compose up -d --build"
