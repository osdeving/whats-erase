[CmdletBinding()]
param(
    [ValidateSet('Start', 'Panel', 'Stop', 'Status')]
    [string]$Action = 'Start',

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$Distro,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z_][a-z0-9_-]*[$]?$')]
    [string]$LinuxUser,

    [Parameter(Mandatory = $true)]
    [string]$LinuxRepo
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

if ($LinuxRepo -notmatch '^/' -or $LinuxRepo -match '[\x00-\x1f"]') {
    throw 'The WSL project path is invalid.'
}

$script:InstallDirectory = Join-Path $env:LOCALAPPDATA 'WhatsErase'
$script:LogPath = Join-Path $script:InstallDirectory 'launcher.log'
$script:IconPath = Join-Path $script:InstallDirectory 'WhatsErase.ico'
$script:PanelUrl = 'http://localhost:3210'
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-LauncherLog {
    param(
        [Parameter(Mandatory = $true)][string]$Stage,
        [Parameter(Mandatory = $true)][string]$Code
    )

    try {
        if (-not (Test-Path -LiteralPath $script:InstallDirectory)) {
            [void](New-Item -ItemType Directory -Path $script:InstallDirectory -Force)
        }
        if ((Test-Path -LiteralPath $script:LogPath) -and
            (Get-Item -LiteralPath $script:LogPath).Length -gt 262144) {
            $previous = Join-Path $script:InstallDirectory 'launcher.previous.log'
            Move-Item -LiteralPath $script:LogPath -Destination $previous -Force
        }

        $safeStage = $Stage -replace '[^A-Za-z0-9_.-]', '_'
        $safeCode = $Code -replace '[^A-Za-z0-9_.-]', '_'
        $line = "{0:o}`taction={1}`tstage={2}`tcode={3}{4}" -f [DateTime]::UtcNow, $Action, $safeStage, $safeCode, [Environment]::NewLine
        [System.IO.File]::AppendAllText($script:LogPath, $line, $script:Utf8NoBom)
    }
    catch {
        # Logging must never prevent the launcher from operating.
    }
}

function Get-LauncherIcon {
    if (Test-Path -LiteralPath $script:IconPath) {
        try {
            return New-Object System.Drawing.Icon($script:IconPath)
        }
        catch {
            # Fall through to the system icon.
        }
    }
    return [System.Drawing.SystemIcons]::Application.Clone()
}

function Show-Balloon {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet('Info', 'Warning', 'Error')][string]$Kind = 'Info'
    )

    $icon = Get-LauncherIcon
    $notify = New-Object System.Windows.Forms.NotifyIcon
    try {
        $notify.Icon = $icon
        $notify.Text = 'WhatsErase'
        $notify.Visible = $true
        $tipIcon = switch ($Kind) {
            'Error' { [System.Windows.Forms.ToolTipIcon]::Error }
            'Warning' { [System.Windows.Forms.ToolTipIcon]::Warning }
            default { [System.Windows.Forms.ToolTipIcon]::Info }
        }
        $notify.ShowBalloonTip(3000, $Title, $Message, $tipIcon)
        $until = [DateTime]::UtcNow.AddMilliseconds(3400)
        while ([DateTime]::UtcNow -lt $until) {
            [System.Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 80
        }
    }
    finally {
        $notify.Visible = $false
        $notify.Dispose()
        $icon.Dispose()
    }
}

function New-ProgressWindow {
    param(
        [Parameter(Mandatory = $true)][string]$Heading,
        [Parameter(Mandatory = $true)][string]$Detail
    )

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'WhatsErase'
    $form.ClientSize = New-Object System.Drawing.Size(390, 126)
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.ControlBox = $false
    $form.ShowInTaskbar = $false
    $form.TopMost = $true
    $form.BackColor = [System.Drawing.Color]::FromArgb(250, 251, 248)
    $form.Icon = Get-LauncherIcon

    $stripe = New-Object System.Windows.Forms.Panel
    $stripe.Location = New-Object System.Drawing.Point(0, 0)
    $stripe.Size = New-Object System.Drawing.Size(8, 126)
    $stripe.BackColor = [System.Drawing.Color]::FromArgb(26, 127, 79)
    $form.Controls.Add($stripe)

    $title = New-Object System.Windows.Forms.Label
    $title.AutoSize = $true
    $title.Location = New-Object System.Drawing.Point(30, 28)
    $title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 13)
    $title.ForeColor = [System.Drawing.Color]::FromArgb(24, 43, 34)
    $title.Text = $Heading
    $form.Controls.Add($title)

    $subtitle = New-Object System.Windows.Forms.Label
    $subtitle.AutoSize = $true
    $subtitle.Location = New-Object System.Drawing.Point(31, 67)
    $subtitle.Font = New-Object System.Drawing.Font('Segoe UI', 9)
    $subtitle.ForeColor = [System.Drawing.Color]::FromArgb(80, 94, 87)
    $subtitle.Text = $Detail
    $form.Controls.Add($subtitle)

    $form.Show()
    $form.Activate()
    [System.Windows.Forms.Application]::DoEvents()
    return $form
}

function ConvertTo-NativeArgument {
    param([AllowEmptyString()][string]$Value)

    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') {
        return $Value
    }
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function Invoke-NativeProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [int]$TimeoutSeconds = 180
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = (($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        if (-not $process.Start()) {
            throw 'The process could not be started.'
        }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        while (-not $process.WaitForExit(100)) {
            [System.Windows.Forms.Application]::DoEvents()
            if ($stopwatch.Elapsed.TotalSeconds -gt $TimeoutSeconds) {
                try { $process.Kill() } catch { }
                throw 'The process timed out.'
            }
        }
        $process.WaitForExit()
        $stdout = $stdoutTask.Result
        $stderr = $stderrTask.Result
        if ($stdout.Length -gt 262144 -or $stderr.Length -gt 262144) {
            throw 'The process returned too much data.'
        }
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Stdout = $stdout
            Stderr = $stderr
        }
    }
    finally {
        $stopwatch.Stop()
        $process.Dispose()
    }
}

function ConvertFrom-BridgeOutput {
    param([string]$Output)

    if ([string]::IsNullOrWhiteSpace($Output)) {
        return $null
    }

    $candidates = New-Object System.Collections.Generic.List[string]
    $candidates.Add($Output.Trim())
    $lines = $Output -split "`r?`n"
    for ($index = $lines.Length - 1; $index -ge 0; $index--) {
        if ($lines[$index].Trim().StartsWith('{')) {
            $candidates.Add($lines[$index].Trim())
        }
    }

    foreach ($candidate in $candidates) {
        try {
            $value = $candidate | ConvertFrom-Json -ErrorAction Stop
            $required = @(
                'schemaVersion', 'ok', 'code', 'connected', 'state', 'daemonEnabled',
                'setupRequired', 'qrReady', 'restartRequired', 'retryAfterMs',
                'panelUrl', 'message'
            )
            $propertyNames = @($value.PSObject.Properties.Name)
            $missing = @($required | Where-Object { $propertyNames -notcontains $_ })
            if ($missing.Count -gt 0) { continue }
            if ([int]$value.schemaVersion -ne 1) { continue }
            if ([string]$value.code -notmatch '^[A-Z][A-Z0-9_]{0,63}$') { continue }
            if ($value.ok -isnot [bool] -or
                $value.connected -isnot [bool] -or
                $value.daemonEnabled -isnot [bool] -or
                $value.setupRequired -isnot [bool] -or
                $value.qrReady -isnot [bool] -or
                $value.restartRequired -isnot [bool]) { continue }
            if ($null -ne $value.state -and $value.state -isnot [string]) { continue }
            $retryAfter = 0L
            if (-not [long]::TryParse([string]$value.retryAfterMs, [ref]$retryAfter) -or
                $retryAfter -lt 0 -or $retryAfter -gt 300000) { continue }
            if ([string]$value.panelUrl -notmatch '^http://localhost:[0-9]{2,5}/?$') { continue }
            if ($value.message -isnot [string] -or ([string]$value.message).Length -gt 1000) { continue }
            return $value
        }
        catch {
            # Try the next candidate without logging raw output.
        }
    }
    return $null
}

function ConvertTo-WslPath {
    param([Parameter(Mandatory = $true)][string]$WindowsPath)

    $fullPath = [System.IO.Path]::GetFullPath($WindowsPath)
    if ($fullPath -notmatch '^([A-Za-z]):\\(.*)$') {
        throw 'The temporary QR path is not on a local Windows drive.'
    }
    $drive = $Matches[1].ToLowerInvariant()
    $relative = $Matches[2] -replace '\\', '/'
    return "/mnt/$drive/$relative"
}

function New-BridgeFailure {
    param([string]$Code, [string]$Message)

    return [pscustomobject]@{
        schemaVersion = 1
        ok = $false
        code = $Code
        connected = $false
        state = $null
        daemonEnabled = $false
        setupRequired = $false
        qrReady = $false
        restartRequired = $false
        retryAfterMs = 0
        panelUrl = $script:PanelUrl
        message = $Message
        bridgeExitCode = -1
    }
}

function Invoke-Bridge {
    param(
        [ValidateSet('start', 'status', 'stop')][string]$BridgeAction,
        [string]$QrWindowsPath = ''
    )

    $wsl = Join-Path $env:SystemRoot 'System32\wsl.exe'
    if (-not (Test-Path -LiteralPath $wsl)) {
        return New-BridgeFailure 'WSL_MISSING' 'O WSL nao esta disponivel neste Windows.'
    }

    $arguments = @(
        '--distribution', $Distro,
        '--user', $LinuxUser,
        '--cd', $LinuxRepo,
        '--exec', 'bash', './scripts/windows/bridge.sh', $BridgeAction
    )
    if (-not [string]::IsNullOrWhiteSpace($QrWindowsPath)) {
        try {
            $arguments += ConvertTo-WslPath $QrWindowsPath
        }
        catch {
            return New-BridgeFailure 'QR_PATH_INVALID' 'Nao foi possivel preparar o QR Code temporario.'
        }
    }

    try {
        $native = Invoke-NativeProcess -FilePath $wsl -Arguments $arguments
    }
    catch {
        return New-BridgeFailure 'WSL_FAILED' 'O WSL demorou demais ou nao conseguiu executar o launcher.'
    }

    $result = ConvertFrom-BridgeOutput $native.Stdout
    if ($null -eq $result) {
        return New-BridgeFailure 'BRIDGE_OUTPUT_INVALID' 'O launcher interno nao devolveu um estado valido.'
    }
    Add-Member -InputObject $result -NotePropertyName bridgeExitCode -NotePropertyValue $native.ExitCode -Force

    $candidateUrl = [string]$result.panelUrl
    if ($candidateUrl -match '^http://localhost:[0-9]{2,5}/?$') {
        $script:PanelUrl = $candidateUrl.TrimEnd('/')
    }
    return $result
}

function Get-SafeMessage {
    param($Result)

    $message = [string]$Result.message
    $message = $message -replace '[\x00-\x08\x0b\x0c\x0e-\x1f]', ' '
    if ([string]::IsNullOrWhiteSpace($message)) {
        return 'Nao foi possivel concluir a operacao.'
    }
    if ($message.Length -gt 360) {
        return $message.Substring(0, 360)
    }
    return $message
}

function Open-ControlPanel {
    Start-Process $script:PanelUrl
}

function Show-FailureDialog {
    param($Result)

    $message = Get-SafeMessage $Result
    $text = "$message`r`n`r`nDeseja abrir o painel para verificar?"
    $choice = [System.Windows.Forms.MessageBox]::Show(
        $text,
        'WhatsErase',
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    )
    if ($choice -eq [System.Windows.Forms.DialogResult]::Yes) {
        Open-ControlPanel
    }
}

function Set-QrPicture {
    param(
        [Parameter(Mandatory = $true)][System.Windows.Forms.PictureBox]$Picture,
        [Parameter(Mandatory = $true)][string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return $false
    }
    $file = Get-Item -LiteralPath $Path
    if ($file.Length -lt 100 -or $file.Length -gt 2097152) {
        return $false
    }

    [byte[]]$bytes = [System.IO.File]::ReadAllBytes($Path)
    [byte[]]$magic = @(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    for ($index = 0; $index -lt $magic.Length; $index++) {
        if ($bytes[$index] -ne $magic[$index]) {
            return $false
        }
    }

    $stream = New-Object System.IO.MemoryStream(, $bytes)
    $source = $null
    try {
        $source = [System.Drawing.Image]::FromStream($stream, $true, $true)
        $copy = New-Object System.Drawing.Bitmap($source)
    }
    catch {
        return $false
    }
    finally {
        if ($null -ne $source) { $source.Dispose() }
        $stream.Dispose()
    }

    $previous = $Picture.Image
    $Picture.Image = $copy
    if ($null -ne $previous) { $previous.Dispose() }
    return $true
}

function Show-QrDialog {
    param(
        [Parameter(Mandatory = $true)][string]$QrPath,
        [Parameter(Mandatory = $true)]$InitialResult
    )

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Conectar WhatsApp - WhatsErase'
    $form.ClientSize = New-Object System.Drawing.Size(470, 590)
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.TopMost = $true
    $form.BackColor = [System.Drawing.Color]::FromArgb(250, 251, 248)
    $form.Icon = Get-LauncherIcon

    $accent = New-Object System.Windows.Forms.Panel
    $accent.Location = New-Object System.Drawing.Point(0, 0)
    $accent.Size = New-Object System.Drawing.Size(470, 8)
    $accent.BackColor = [System.Drawing.Color]::FromArgb(26, 127, 79)
    $form.Controls.Add($accent)

    $heading = New-Object System.Windows.Forms.Label
    $heading.AutoSize = $true
    $heading.Location = New-Object System.Drawing.Point(35, 29)
    $heading.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 16)
    $heading.ForeColor = [System.Drawing.Color]::FromArgb(24, 43, 34)
    $heading.Text = 'Conectar WhatsApp'
    $form.Controls.Add($heading)

    $instructions = New-Object System.Windows.Forms.Label
    $instructions.Location = New-Object System.Drawing.Point(38, 67)
    $instructions.Size = New-Object System.Drawing.Size(395, 42)
    $instructions.Font = New-Object System.Drawing.Font('Segoe UI', 9)
    $instructions.ForeColor = [System.Drawing.Color]::FromArgb(74, 88, 81)
    $instructions.Text = 'No celular: WhatsApp > Aparelhos conectados > Conectar um aparelho.'
    $form.Controls.Add($instructions)

    $picture = New-Object System.Windows.Forms.PictureBox
    $picture.Location = New-Object System.Drawing.Point(75, 115)
    $picture.Size = New-Object System.Drawing.Size(320, 320)
    $picture.BackColor = [System.Drawing.Color]::White
    $picture.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $picture.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::Zoom
    $form.Controls.Add($picture)

    $statusLabel = New-Object System.Windows.Forms.Label
    $statusLabel.Location = New-Object System.Drawing.Point(38, 452)
    $statusLabel.Size = New-Object System.Drawing.Size(394, 38)
    $statusLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
    $statusLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9)
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(55, 76, 66)
    $statusLabel.Text = 'Aguardando a leitura do QR Code...'
    $form.Controls.Add($statusLabel)

    $refreshButton = New-Object System.Windows.Forms.Button
    $refreshButton.Location = New-Object System.Drawing.Point(38, 510)
    $refreshButton.Size = New-Object System.Drawing.Size(120, 36)
    $refreshButton.Text = 'Atualizar QR'
    $refreshButton.FlatStyle = [System.Windows.Forms.FlatStyle]::System
    $form.Controls.Add($refreshButton)

    $panelButton = New-Object System.Windows.Forms.Button
    $panelButton.Location = New-Object System.Drawing.Point(174, 510)
    $panelButton.Size = New-Object System.Drawing.Size(120, 36)
    $panelButton.Text = 'Abrir painel'
    $panelButton.FlatStyle = [System.Windows.Forms.FlatStyle]::System
    $form.Controls.Add($panelButton)

    $closeButton = New-Object System.Windows.Forms.Button
    $closeButton.Location = New-Object System.Drawing.Point(310, 510)
    $closeButton.Size = New-Object System.Drawing.Size(120, 36)
    $closeButton.Text = 'Fechar'
    $closeButton.FlatStyle = [System.Windows.Forms.FlatStyle]::System
    $form.Controls.Add($closeButton)

    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 3500
    # GetNewClosure creates a dynamic module in Windows PowerShell 5.1. Capture
    # FunctionInfo objects so event callbacks retain the original session state.
    $invokeBridgeCommand = Get-Command Invoke-Bridge
    $writeLauncherLogCommand = Get-Command Write-LauncherLog
    $setQrPictureCommand = Get-Command Set-QrPicture
    $getSafeMessageCommand = Get-Command Get-SafeMessage
    $openControlPanelCommand = Get-Command Open-ControlPanel
    $state = @{
        Busy = $false
        Connected = $false
        LastRefresh = if ([bool]$InitialResult.qrReady) { [DateTime]::UtcNow } else { [DateTime]::UtcNow.AddSeconds(-30) }
    }

    if (Set-QrPicture -Picture $picture -Path $QrPath) {
        Remove-Item -LiteralPath $QrPath -Force -ErrorAction SilentlyContinue
    }
    else {
        $statusLabel.Text = 'Preparando um QR Code novo...'
    }

    $refreshAction = {
        if ($state.Busy) { return }
        $state.Busy = $true
        $timer.Stop()
        $refreshButton.Enabled = $false
        $statusLabel.Text = 'Atualizando o QR Code...'
        [System.Windows.Forms.Application]::DoEvents()
        try {
            $next = & $invokeBridgeCommand -BridgeAction 'start' -QrWindowsPath $QrPath
            & $writeLauncherLogCommand -Stage 'qr_refresh' -Code ([string]$next.code)
            if ([bool]$next.connected -and [string]$next.code -eq 'READY') {
                $state.Connected = $true
                $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
                $form.Close()
                return
            }
            if ([string]$next.code -eq 'QR_REQUIRED') {
                if (& $setQrPictureCommand -Picture $picture -Path $QrPath) {
                    Remove-Item -LiteralPath $QrPath -Force -ErrorAction SilentlyContinue
                    $statusLabel.Text = 'Leia o codigo com o WhatsApp. A conexao sera detectada automaticamente.'
                }
                else {
                    $statusLabel.Text = 'O QR Code ainda nao ficou disponivel. Tente atualizar.'
                }
                $state.LastRefresh = [DateTime]::UtcNow
                return
            }
            if ([string]$next.code -eq 'QR_PENDING') {
                $statusLabel.Text = 'A Evolution ainda esta preparando o QR Code...'
                $state.LastRefresh = [DateTime]::UtcNow
                return
            }
            $statusLabel.Text = & $getSafeMessageCommand $next
        }
        finally {
            $state.Busy = $false
            if (-not $form.IsDisposed) {
                $refreshButton.Enabled = $true
                $timer.Start()
            }
        }
    }.GetNewClosure()

    $timer.Add_Tick({
        if ($state.Busy) { return }
        $state.Busy = $true
        $timer.Stop()
        try {
            $current = & $invokeBridgeCommand -BridgeAction 'status'
            if ([bool]$current.connected) {
                $state.Busy = $false
                & $refreshAction
                return
            }
            $age = ([DateTime]::UtcNow - $state.LastRefresh).TotalSeconds
            if ($age -ge 20) {
                $state.Busy = $false
                & $refreshAction
                return
            }
            $statusLabel.Text = 'Aguardando a leitura do QR Code...'
        }
        finally {
            $state.Busy = $false
            if (-not $form.IsDisposed) { $timer.Start() }
        }
    }.GetNewClosure())

    $refreshButton.Add_Click({ & $refreshAction }.GetNewClosure())
    $panelButton.Add_Click({ & $openControlPanelCommand }.GetNewClosure())
    $closeButton.Add_Click({ $form.Close() }.GetNewClosure())

    try {
        $timer.Start()
        [void]$form.ShowDialog()
    }
    finally {
        $timer.Stop()
        $timer.Dispose()
        if ($null -ne $picture.Image) {
            $picture.Image.Dispose()
            $picture.Image = $null
        }
        $form.Dispose()
    }
    return [bool]$state.Connected
}

function Invoke-StartWorkflow {
    param([switch]$OpenPanelAfter)

    $qrPath = Join-Path ([System.IO.Path]::GetTempPath()) ("WhatsErase-qr-{0}.png" -f [Guid]::NewGuid().ToString('D'))
    $progress = $null
    try {
        $progress = New-ProgressWindow 'Iniciando WhatsErase' 'Subindo os servicos e verificando o WhatsApp...'
        try {
            $result = Invoke-Bridge -BridgeAction 'start' -QrWindowsPath $qrPath
        }
        finally {
            if ($null -ne $progress) {
                $progress.Close()
                if ($null -ne $progress.Icon) { $progress.Icon.Dispose() }
                $progress.Dispose()
                $progress = $null
            }
        }

        Write-LauncherLog -Stage 'start' -Code ([string]$result.code)
        if ($OpenPanelAfter) {
            Open-ControlPanel
            if (-not [bool]$result.ok -and -not [bool]$result.setupRequired) {
                Show-Balloon 'WhatsErase' (Get-SafeMessage $result) 'Warning'
            }
            return
        }

        if ([bool]$result.connected -and [string]$result.code -eq 'READY') {
            Show-Balloon 'WhatsErase ativo' 'WhatsApp conectado e daemon em execucao.' 'Info'
            return
        }
        if ([string]$result.code -eq 'QR_REQUIRED' -or [string]$result.code -eq 'QR_PENDING') {
            $connected = Show-QrDialog -QrPath $qrPath -InitialResult $result
            if ($connected) {
                Show-Balloon 'WhatsErase ativo' 'WhatsApp conectado e daemon em execucao.' 'Info'
            }
            return
        }
        Show-FailureDialog $result
    }
    finally {
        if ($null -ne $progress) {
            $progress.Close()
            if ($null -ne $progress.Icon) { $progress.Icon.Dispose() }
            $progress.Dispose()
        }
        Remove-Item -LiteralPath $qrPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath ($qrPath + '.tmp') -Force -ErrorAction SilentlyContinue
    }
}

$mutex = $null
$ownsMutex = $false
try {
    $createdNew = $false
    $mutex = New-Object System.Threading.Mutex($true, 'Local\WhatsEraseLauncher', [ref]$createdNew)
    $ownsMutex = $createdNew
    if (-not $createdNew) {
        Show-Balloon 'WhatsErase' 'Uma operacao do WhatsErase ja esta em andamento.' 'Info'
        exit 0
    }

    Write-LauncherLog -Stage 'launch' -Code 'BEGIN'
    switch ($Action) {
        'Start' {
            Invoke-StartWorkflow
        }
        'Panel' {
            Invoke-StartWorkflow -OpenPanelAfter
        }
        'Stop' {
            $choice = [System.Windows.Forms.MessageBox]::Show(
                'Parar o WhatsErase? Os bancos, a sessao e os jobs serao preservados.',
                'Encerrar WhatsErase',
                [System.Windows.Forms.MessageBoxButtons]::YesNo,
                [System.Windows.Forms.MessageBoxIcon]::Question
            )
            if ($choice -eq [System.Windows.Forms.DialogResult]::Yes) {
                $progress = New-ProgressWindow 'Encerrando WhatsErase' 'Parando os servicos sem remover seus dados...'
                try {
                    $result = Invoke-Bridge -BridgeAction 'stop'
                }
                finally {
                    $progress.Close()
                    if ($null -ne $progress.Icon) { $progress.Icon.Dispose() }
                    $progress.Dispose()
                }
                Write-LauncherLog -Stage 'stop' -Code ([string]$result.code)
                if ([bool]$result.ok) {
                    Show-Balloon 'WhatsErase encerrado' 'Servicos parados; dados e sessao preservados.' 'Info'
                }
                else {
                    Show-FailureDialog $result
                }
            }
            else {
                Write-LauncherLog -Stage 'stop' -Code 'CANCELLED'
            }
        }
        'Status' {
            $result = Invoke-Bridge -BridgeAction 'status'
            Write-LauncherLog -Stage 'status' -Code ([string]$result.code)
            $kind = if ([bool]$result.ok) { 'Info' } else { 'Warning' }
            Show-Balloon 'Estado do WhatsErase' (Get-SafeMessage $result) $kind
        }
    }
    Write-LauncherLog -Stage 'launch' -Code 'END'
}
catch {
    Write-LauncherLog -Stage 'fatal' -Code 'UNEXPECTED'
    [void][System.Windows.Forms.MessageBox]::Show(
        'O launcher encontrou um erro inesperado. Abra o painel ou consulte o log local.',
        'WhatsErase',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    )
    exit 1
}
finally {
    if ($null -ne $mutex) {
        if ($ownsMutex) {
            try { $mutex.ReleaseMutex() } catch { }
        }
        $mutex.Dispose()
    }
}
