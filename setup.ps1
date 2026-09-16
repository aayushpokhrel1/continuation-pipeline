<#
.SYNOPSIS
  Continuation Pipeline: enable the terminal path (OpenSSH) on a Windows host.

.DESCRIPTION
  Installs and starts the OpenSSH server, sets it to start at boot, and (when you
  supply a public key) installs that key and switches SSH to key only auth. It does
  NOT touch Tailscale (install that first with: winget install --id tailscale.tailscale)
  and it does NOT forward any router port, because the tailnet is the only route in.

  Run from an ELEVATED PowerShell. Safe to re-run.

.PARAMETER PublicKey
  Your phone's SSH public key as a string (the contents of id_ed25519.pub).

.PARAMETER PublicKeyPath
  Path to a .pub file, as an alternative to -PublicKey.

.EXAMPLE
  .\setup.ps1 -PublicKeyPath C:\Users\me\phone_key.pub
#>
[CmdletBinding()]
param(
  [string]$PublicKey,
  [string]$PublicKeyPath
)

$ErrorActionPreference = 'Stop'

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p  = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this from an elevated PowerShell (Run as administrator)."
  }
}

Assert-Admin

Write-Host "==> Installing OpenSSH Server capability" -ForegroundColor Cyan
$cap = Get-WindowsCapability -Online -Name 'OpenSSH.Server*'
if ($cap.State -ne 'Installed') {
  Add-WindowsCapability -Online -Name $cap.Name | Out-Null
} else {
  Write-Host "    already installed"
}

Write-Host "==> Starting sshd and setting it to start at boot" -ForegroundColor Cyan
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd

# Resolve the public key from either input, if given.
if (-not $PublicKey -and $PublicKeyPath) {
  $PublicKey = (Get-Content -Raw -Path $PublicKeyPath).Trim()
}

if (-not $PublicKey) {
  Write-Host ""
  Write-Host "No public key supplied. sshd is running with its default (password) auth." -ForegroundColor Yellow
  Write-Host "To lock it down to key only, re-run with -PublicKeyPath <your .pub file>." -ForegroundColor Yellow
  Write-Host "Generate one on the phone (Termius/Blink) and paste the .pub contents." -ForegroundColor Yellow
  exit 0
}

# ponytail: Windows OpenSSH ignores per-user keys for admin accounts; the admin
# key file plus its restrictive ACL is the corner that silently eats logins.
$isAdmin = (New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent())
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($isAdmin) {
  $keyFile = 'C:\ProgramData\ssh\administrators_authorized_keys'
  Write-Host "==> Installing key for admin account -> $keyFile" -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path (Split-Path $keyFile) | Out-Null
  # Append only if this exact key is not already present.
  $existing = if (Test-Path $keyFile) { Get-Content -Raw $keyFile } else { '' }
  if ($existing -notmatch [regex]::Escape($PublicKey)) {
    Add-Content -Path $keyFile -Value $PublicKey -Encoding ascii
  }
  # Lock ACL down to Administrators and SYSTEM, or sshd refuses the file.
  icacls $keyFile /inheritance:r /grant 'Administrators:F' 'SYSTEM:F' | Out-Null
} else {
  $keyFile = Join-Path $env:USERPROFILE '.ssh\authorized_keys'
  Write-Host "==> Installing key -> $keyFile" -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path (Split-Path $keyFile) | Out-Null
  $existing = if (Test-Path $keyFile) { Get-Content -Raw $keyFile } else { '' }
  if ($existing -notmatch [regex]::Escape($PublicKey)) {
    Add-Content -Path $keyFile -Value $PublicKey -Encoding ascii
  }
}

Write-Host "==> Switching sshd to key only auth" -ForegroundColor Cyan
$cfg = 'C:\ProgramData\ssh\sshd_config'
$lines = Get-Content $cfg
$lines = $lines -replace '^\s*#?\s*PasswordAuthentication\s+.*', 'PasswordAuthentication no'
$lines = $lines -replace '^\s*#?\s*PubkeyAuthentication\s+.*',   'PubkeyAuthentication yes'
if ($lines -notmatch 'PasswordAuthentication no')  { $lines += 'PasswordAuthentication no' }
if ($lines -notmatch 'PubkeyAuthentication yes')   { $lines += 'PubkeyAuthentication yes' }
Set-Content -Path $cfg -Value $lines -Encoding ascii
Restart-Service sshd

Write-Host ""
Write-Host "Done. From the phone (same Tailscale account):" -ForegroundColor Green
Write-Host "  ssh $env:USERNAME@<this-pc>.<tailnet>.ts.net"
Write-Host "  cc      # inside WSL: attach or start the Claude Code session"
Write-Host ""
Write-Host "Next, prepare WSL once: run scripts\wsl-setup.sh via wsl (see README)." -ForegroundColor Green
