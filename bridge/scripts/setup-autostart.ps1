# Make the Continuation bridge start automatically at logon (in WSL). No admin required.
# Tries a Scheduled Task first (interactive logon, so it needs no elevation); if the machine
# still refuses (locked-down policy), falls back to a hidden launcher in your Startup folder.
# Re-run any time to update. Removal instructions print at the end.
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

# The command that launches the bridge in WSL under a login shell (so nvm/Node are on PATH).
$wslArgs = "-d $Distro -- bash -lc `"bash '$wslScript'`""

# Returns $true only if the task really exists afterwards. Register-ScheduledTask surfaces
# "Access is denied" as a non-terminating CIM error that try/catch misses, so we verify.
function Install-ViaScheduledTask {
  $action    = New-ScheduledTaskAction -Execute "wsl.exe" -Argument $wslArgs
  $trigger   = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                 -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
    -Settings $settings -Description "Start the Continuation mobile bridge at logon." `
    -ErrorAction SilentlyContinue 2>$null | Out-Null
  return [bool](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
}

function Install-ViaStartupFolder {
  $startup = [Environment]::GetFolderPath("Startup")
  $vbs = Join-Path $startup "$TaskName.vbs"
  # WScript.Shell.Run with window style 0 = hidden, so no console flashes at logon.
  # Double quotes are doubled for VBS string escaping.
  $inner = 'wsl.exe ' + $wslArgs.Replace('"', '""')
  $content = 'CreateObject("WScript.Shell").Run "' + $inner + '", 0, False'
  Set-Content -Path $vbs -Value $content -Encoding ASCII
  return $vbs
}

if (Install-ViaScheduledTask) {
  Write-Host "Auto-start enabled via Scheduled Task '$TaskName' (runs at logon)." -ForegroundColor Green
  Write-Host "Start it now without logging out:  Start-ScheduledTask -TaskName $TaskName"
  Write-Host "Remove it:                          Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
}
else {
  Write-Host "Scheduled Task creation is blocked on this machine; using the Startup folder instead (no admin needed)." -ForegroundColor Yellow
  $vbs = Install-ViaStartupFolder
  Write-Host "Auto-start enabled via Startup launcher: $vbs" -ForegroundColor Green
  Write-Host "It runs hidden at your next logon. Start it now with:  wscript `"$vbs`""
  Write-Host "Remove it:  Remove-Item `"$vbs`""
}
