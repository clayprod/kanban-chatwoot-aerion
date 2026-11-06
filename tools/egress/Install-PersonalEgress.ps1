#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('100.117.55.18','100.80.200.77')][string]$TailnetAddress,
  [Parameter(Mandatory)][ValidateSet('Jasque','CLAYTON-PC')][string]$DeviceName,
  [Parameter(Mandatory)][string]$RegistrationPath,
  [string]$ArchivePath,
  [string]$RestoredBinaryPath,
  [switch]$Resume,
  [switch]$Unattended
)
$ErrorActionPreference = 'Stop'
$installDir = Join-Path $env:ProgramData 'Aerion\ResearchEgress'
$configPath = Join-Path $installDir '3proxy.cfg'
$binaryPath = Join-Path $installDir '3proxy.exe'
$existingService = Get-CimInstance Win32_Service -Filter "Name='3proxy'"
if ($existingService -and (!$Resume -or $existingService.PathName.IndexOf($binaryPath, [StringComparison]::OrdinalIgnoreCase) -lt 0)) { throw 'Já existe um serviço 3proxy. Revisar antes de instalar.' }
$hasConfig = Test-Path -LiteralPath $configPath
if ($hasConfig -and !$Resume) { throw 'Já existe uma configuração. Use Resume para preservar a senha instalada.' }
$self = & 'C:\Program Files\Tailscale\tailscale.exe' ip -4
if ($self.Trim() -ne $TailnetAddress) { throw 'O IP Tailscale deste dispositivo não corresponde ao informado.' }
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
# Only Administrators and SYSTEM can read the plaintext daemon configuration.
& icacls.exe $installDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível proteger o diretório.' }
if ($RestoredBinaryPath) {
  # Payload independently verified against the official, SHA256-pinned 1.0.2 ZIP.
  $expectedBinary = 'ad32b0d35bc55fad81b960f65bdb49b22537112e1eb403876f27206b6922bdb8'
  $installedVerified = (Test-Path -LiteralPath $binaryPath) -and ((Get-FileHash -LiteralPath $binaryPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expectedBinary)
  if (!$installedVerified) {
    if ((Get-FileHash -LiteralPath $RestoredBinaryPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedBinary) { throw 'SHA256 do executável restaurado não confere com o pacote oficial.' }
    Copy-Item -LiteralPath $RestoredBinaryPath -Destination $binaryPath
  }
} else {
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
}
if ($hasConfig) {
  $existingConfig = [IO.File]::ReadAllText($configPath)
  $credentials = [regex]::Match($existingConfig, '(?m)^users aerion-egress:CL:([a-f0-9]{64})\r?$')
  if (!$credentials.Success -or !$existingConfig.Contains("proxy -4 -p3128 -i$TailnetAddress")) { throw 'Configuração existente não corresponde à instalação Aerion deste dispositivo.' }
  $password = $credentials.Groups[1].Value
  $existingConfig = $null
} else {
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
}
if (!(Get-NetFirewallRule -DisplayName 'Aerion research via Tailscale' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'Aerion research via Tailscale' -Direction Inbound -Action Allow -Protocol TCP -LocalAddress $TailnetAddress -LocalPort 3128 -RemoteAddress '100.97.22.81' -Program $binaryPath | Out-Null
}
if (!$existingService) {
  # Match the upstream service ImagePath without the interactive --install dialog.
  $serviceCommand = '"{0}" "{1}" --service' -f $binaryPath, $configPath
  New-Service -Name '3proxy' -DisplayName 'Aerion Research Proxy' -BinaryPathName $serviceCommand -StartupType Automatic -DependsOn 'Tailscale' | Out-Null
}
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
