#!/usr/bin/env bash
set -euo pipefail

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
distro=${WSL_DISTRO_NAME:-}
linux_user=$(id -un)

if [[ -z "$distro" || ! "$distro" =~ ^[A-Za-z0-9._-]+$ ]]; then
  printf '%s\n' 'Nao foi possivel identificar uma distribuicao WSL valida.' >&2
  exit 1
fi
if [[ ! "$linux_user" =~ ^[a-z_][a-z0-9_-]*\$?$ ]]; then
  printf '%s\n' 'Nao foi possivel identificar um usuario Linux valido.' >&2
  exit 1
fi

powershell='/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
if [[ ! -x "$powershell" ]]; then
  printf '%s\n' 'Windows PowerShell 5.1 nao foi encontrado.' >&2
  exit 1
fi

installer_windows=$(wslpath -w "$project_dir/scripts/windows/install-shortcuts.ps1")
launcher_windows=$(wslpath -w "$project_dir/scripts/windows/WhatsErase.ps1")

"$powershell" \
  -NoLogo \
  -NoProfile \
  -ExecutionPolicy Bypass \
  -File "$installer_windows" \
  -Distro "$distro" \
  -LinuxUser "$linux_user" \
  -LinuxRepo "$project_dir" \
  -LauncherSource "$launcher_windows" | tr -d '\r'
