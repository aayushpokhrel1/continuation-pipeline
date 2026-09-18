# Register a Windows Scheduled Task that starts the Continuation bridge in WSL at logon.
# Runs as the current user, no admin needed. Re-run to update; see the bottom for how to remove.
#
# Usage (from PowerShell):  .\bridge\scripts\setup-autostart.ps1  [-Distro Ubuntu]
param(
  [string]$Distro = "Ubuntu",
  [string]$TaskName = "ContinuationBridge"
)
$ErrorActionPreference = "Stop"

$scriptWin = Join-Path $PSScriptRoot "start-bridge.sh"
if (-not (Test-Path $scriptWin)) { throw "start-bridge.sh not found next to this script" }

# Translate this script's Windows path to a WSL /mnt/c path.
$wslScript = (& wsl.exe -d $Distro wslpath -a "$scriptWin").Trim()
if (-not $wslScript) { throw "could not resolve the WSL path (is the '$Distro' distro installed?)" }

# Run the start script under a login shell so nvm/Node are available.
$argument = "-d $Distro -- bash -lc `"bash '$wslScript'`""

$action   = New-ScheduledTaskAction -Execute "wsl.exe" -Argument $argument
$trigger  = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)

# Replace any existing task of the same name, then register for the current user.
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Start the Continuation mobile bridge at logon." | Out-Null

Write-Host "Registered '$TaskName' (starts the bridge at logon)."
Write-Host "Start it now without logging out:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "Remove it:                          Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
