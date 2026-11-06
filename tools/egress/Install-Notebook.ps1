#Requires -RunAsAdministrator
param([string]$ArchivePath,[string]$RestoredBinaryPath)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskDir = Join-Path $workspace '.tmp\research-egress'
New-Item -ItemType Directory -Path $taskDir -Force | Out-Null
try {
  & (Join-Path $PSScriptRoot 'Install-PersonalEgress.ps1') -TailnetAddress '100.117.55.18' -DeviceName 'Jasque' -RegistrationPath (Join-Path $taskDir 'Jasque.dpapi') -ArchivePath $ArchivePath -RestoredBinaryPath $RestoredBinaryPath -Resume -Unattended | Out-Null
  @{ok=$true;device='Jasque'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskDir 'install-result.json')
} catch {
  @{ok=$false;error=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskDir 'install-result.json')
  exit 1
}
