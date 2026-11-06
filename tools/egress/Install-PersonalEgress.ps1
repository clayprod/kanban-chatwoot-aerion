#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('100.117.55.18','100.80.200.77')][string]$TailnetAddress,
  [Parameter(Mandatory)][ValidateSet('Jasque','CLAYTON-PC')][string]$DeviceName,
  [Parameter(Mandatory)][string]$RegistrationPath,
  [string]$ArchivePath,
  [switch]$Unattended
)
$ErrorActionPreference = 'Stop'
$installDir = Join-Path $env:ProgramData 'Aerion\ResearchEgress'
$configPath = Join-Path $installDir '3proxy.cfg'
$binaryPath = Join-Path $installDir '3proxy.exe'
if (Get-Service -Name '3proxy' -ErrorAction SilentlyContinue) { throw 'Já existe um serviço 3proxy. Revisar antes de instalar.' }
if (Test-Path -LiteralPath $configPath) { throw 'Já existe uma configuração. Preserve-a; não gere outra senha sobre o serviço instalado.' }
$self = & 'C:\Program Files\Tailscale\tailscale.exe' ip -4
if ($self.Trim() -ne $TailnetAddress) { throw 'O IP Tailscale deste dispositivo não corresponde ao informado.' }
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
# Only Administrators and SYSTEM can read the plaintext daemon configuration.
& icacls.exe $installDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível proteger o diretório.' }
$archive = Join-Path $installDir '3proxy-1.0.2-x64.zip'
if ($ArchivePath) {
  $sourceArchive = (Resolve-Path -LiteralPath $ArchivePath).Path
  if ($sourceArchive -ne $archive) { Copy-Item -LiteralPath $sourceArchive -Destination $archive -Force }
} else {
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/3proxy/3proxy/releases/download/1.0.2/3proxy-1.0.2-x64.zip' -OutFile $archive
}
$expected = 'a09526d714d5f928b7a94493035923de733fa026ef57d78c137e1925593f705a'
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'SHA256 do pacote oficial não confere.' }
Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $installDir 'package') -Force
$binary = Get-ChildItem -LiteralPath (Join-Path $installDir 'package') -Recurse -File -Filter 3proxy.exe | Select-Object -First 1
if (!$binary) { throw 'Binário não encontrado no pacote oficial.' }
Copy-Item -LiteralPath $binary.FullName -Destination $binaryPath
$secretBytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($secretBytes)
$password = -join ($secretBytes | ForEach-Object { $_.ToString('x2') })
$rng.Dispose()
$config = @"
maxconn 4
timeouts 1 5 30 60 180 1800 15 60
auth strong
users aerion-egress:CL:$password
deny * * 0.0.0.0/8,10.0.0.0/8,100.64.0.0/10,127.0.0.0/8,169.254.0.0/16,172.16.0.0/12,192.168.0.0/16,198.18.0.0/15,224.0.0.0/3
allow aerion-egress 100.97.22.81 * 80,443
deny *
bandlimin 5000000 aerion-egress
bandlimout 5000000 aerion-egress
proxy -4 -p3128 -i$TailnetAddress
"@
[IO.File]::WriteAllText($configPath, $config, [Text.Encoding]::ASCII)
New-NetFirewallRule -DisplayName 'Aerion research via Tailscale' -Direction Inbound -Action Allow -Protocol TCP -LocalAddress $TailnetAddress -LocalPort 3128 -RemoteAddress '100.97.22.81' -Program $binaryPath | Out-Null
& $binaryPath $configPath --install
if ($LASTEXITCODE -ne 0) { throw 'Instalação do serviço falhou.' }
Set-Service -Name '3proxy' -StartupType Automatic
& sc.exe config 3proxy start= delayed-auto depend= Tailscale | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível configurar a inicialização automática.' }
# Service restart handles boot ordering when the Tailscale interface is not ready.
& sc.exe failure 3proxy reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null
if ($Unattended) {
  & 'C:\Program Files\Tailscale\tailscale.exe' set --unattended=true
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível habilitar Tailscale sem sessão de usuário.' }
}
$proxyService = Get-Service -Name '3proxy'
if ($proxyService.Status -ne 'Running') { Start-Service -Name '3proxy' }
$registration = @{id=$DeviceName;proxy="http://aerion-egress:$password@${TailnetAddress}:3128"} | ConvertTo-Json -Compress
$protected = ConvertTo-SecureString $registration -AsPlainText -Force | ConvertFrom-SecureString
[IO.File]::WriteAllText([IO.Path]::GetFullPath($RegistrationPath), $protected)
$password = $null; $registration = $null; $config = $null
Write-Output "Proxy instalado em ${TailnetAddress}:3128, restrito à VPS. Registro protegido salvo; nenhuma credencial foi exibida."
