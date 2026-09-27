[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$Distro,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z_][a-z0-9_-]*[$]?$')]
    [string]$LinuxUser,

    [Parameter(Mandatory = $true)]
    [string]$LinuxRepo,

    [Parameter(Mandatory = $true)]
    [string]$LauncherSource
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if ($LinuxRepo -notmatch '^/' -or $LinuxRepo -match '[\x00-\x1f"]') {
    throw 'The WSL project path is invalid.'
}
if (-not (Test-Path -LiteralPath $LauncherSource -PathType Leaf)) {
    throw 'The launcher source file was not found.'
}

$installDirectory = Join-Path $env:LOCALAPPDATA 'WhatsErase'
$installedLauncher = Join-Path $installDirectory 'WhatsErase.ps1'
$iconPath = Join-Path $installDirectory 'WhatsErase.ico'
$programsDirectory = [Environment]::GetFolderPath('Programs')
$desktopDirectory = [Environment]::GetFolderPath('Desktop')
$startMenuDirectory = Join-Path $programsDirectory 'WhatsErase'

[void](New-Item -ItemType Directory -Path $installDirectory -Force)
[void](New-Item -ItemType Directory -Path $startMenuDirectory -Force)
Copy-Item -LiteralPath $LauncherSource -Destination $installedLauncher -Force

if (-not ('WhatsErase.IconNative' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
namespace WhatsErase {
    public static class IconNative {
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool DestroyIcon(IntPtr handle);
    }
}
'@
}

$bitmap = New-Object System.Drawing.Bitmap(64, 64)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)
$greenBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(26, 127, 79))
$whitePen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 5)
$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$handle = [IntPtr]::Zero
try {
    $graphics.FillEllipse($greenBrush, 2, 2, 60, 60)
    $graphics.DrawEllipse($whitePen, 15, 15, 34, 34)
    $graphics.DrawLine($whitePen, 32, 20, 32, 33)
    $graphics.DrawLine($whitePen, 32, 33, 42, 39)
    $graphics.FillEllipse($whiteBrush, 28, 29, 8, 8)
    $handle = $bitmap.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($handle)
    $stream = [System.IO.File]::Open($iconPath, [System.IO.FileMode]::Create)
    try {
        $icon.Save($stream)
    }
    finally {
        $stream.Dispose()
        $icon.Dispose()
    }
}
finally {
    if ($handle -ne [IntPtr]::Zero) { [void][WhatsErase.IconNative]::DestroyIcon($handle) }
    $whiteBrush.Dispose()
    $whitePen.Dispose()
    $greenBrush.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

$shell = New-Object -ComObject WScript.Shell
$powershellPath = Join-Path $PSHOME 'powershell.exe'

function ConvertTo-ShortcutArgument {
    param([AllowEmptyString()][string]$Value)

    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') {
        return $Value
    }
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function New-WhatsEraseShortcut {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][ValidateSet('Start', 'Panel', 'Stop')][string]$ShortcutAction,
        [string]$Description,
        [string]$Hotkey = ''
    )

    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $powershellPath
    $argumentTokens = @(
        '-NoLogo',
        '-NoProfile',
        '-STA',
        '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass',
        '-File', $installedLauncher,
        '-Action', $ShortcutAction,
        '-Distro', $Distro,
        '-LinuxUser', $LinuxUser,
        '-LinuxRepo', $LinuxRepo
    )
    $shortcut.Arguments = (($argumentTokens | ForEach-Object { ConvertTo-ShortcutArgument $_ }) -join ' ')
    $shortcut.WorkingDirectory = $installDirectory
    $shortcut.IconLocation = "$iconPath,0"
    $shortcut.Description = $Description
    $shortcut.Hotkey = $Hotkey
    $shortcut.Save()
}

$startShortcut = Join-Path $startMenuDirectory 'WhatsErase - Iniciar.lnk'
$panelShortcut = Join-Path $startMenuDirectory 'WhatsErase - Painel.lnk'
$stopShortcut = Join-Path $startMenuDirectory 'WhatsErase - Encerrar.lnk'
$desktopShortcut = Join-Path $desktopDirectory 'WhatsErase.lnk'

# Preserve a hotkey already owned by this exact launcher. Otherwise clear the
# old link before probing so Explorer can release any stale registration.
$ownsExistingHotkey = $false
if (Test-Path -LiteralPath $startShortcut -PathType Leaf) {
    $existing = $shell.CreateShortcut($startShortcut)
    $ownsExistingHotkey = (
        $existing.Hotkey -eq 'Alt+Ctrl+Shift+E' -and
        $existing.TargetPath -eq $powershellPath -and
        $existing.Arguments -like "*$installedLauncher*"
    )
    if (-not $ownsExistingHotkey) {
        $existing.Hotkey = ''
        $existing.Save()
        Start-Sleep -Milliseconds 500
    }
}

if (-not ('WhatsErase.HotkeyNative' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
namespace WhatsErase {
    public static class HotkeyNative {
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UnregisterHotKey(IntPtr window, int id);
    }
}
'@
}

$hotkey = ''
$hotkeyAvailable = $ownsExistingHotkey
if (-not $hotkeyAvailable) {
    $hotkeyAvailable = [WhatsErase.HotkeyNative]::RegisterHotKey([IntPtr]::Zero, 0x5745, 0x0001 -bor 0x0002 -bor 0x0004, 0x45)
    if ($hotkeyAvailable) {
        [void][WhatsErase.HotkeyNative]::UnregisterHotKey([IntPtr]::Zero, 0x5745)
    }
}
if ($hotkeyAvailable) {
    $hotkey = 'CTRL+ALT+SHIFT+E'
}

New-WhatsEraseShortcut -Path $startShortcut -ShortcutAction 'Start' -Description 'Inicia o WhatsErase e abre o QR Code somente quando necessario.' -Hotkey $hotkey
New-WhatsEraseShortcut -Path $panelShortcut -ShortcutAction 'Panel' -Description 'Inicia o WhatsErase e abre o painel local.'
New-WhatsEraseShortcut -Path $stopShortcut -ShortcutAction 'Stop' -Description 'Para o WhatsErase sem remover dados ou a sessao.'
New-WhatsEraseShortcut -Path $desktopShortcut -ShortcutAction 'Start' -Description 'Inicia o WhatsErase.'

$savedHotkey = $shell.CreateShortcut($startShortcut).Hotkey
if ($hotkeyAvailable -and $savedHotkey -ne 'Alt+Ctrl+Shift+E') {
    $hotkeyAvailable = $false
}

Write-Output "Launcher instalado em: $installDirectory"
Write-Output "Atalho da area de trabalho: $desktopShortcut"
Write-Output "Atalhos do Menu Iniciar: $startMenuDirectory"
if ($hotkeyAvailable) {
    Write-Output 'Atalho global configurado: Ctrl+Alt+Shift+E'
}
else {
    Write-Warning 'Ctrl+Alt+Shift+E ja esta em uso. Os atalhos foram criados sem tecla global.'
}
Write-Output 'Nenhuma inicializacao automatica foi configurada.'
