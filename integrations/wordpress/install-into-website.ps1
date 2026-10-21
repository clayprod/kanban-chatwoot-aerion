param(
    [Parameter(Mandatory = $true)][string]$WebsiteRoot,
    [string]$ExpectedPreviousHash = '',
    [string]$ExpectedPreviousMerchantHash = ''
)
$ErrorActionPreference = 'Stop'
$resolvedRoot = (Resolve-Path -LiteralPath $WebsiteRoot).Path.TrimEnd('\')
$dockerfile = Join-Path $resolvedRoot 'wordpress\Dockerfile'
$entrypoint = Join-Path $resolvedRoot 'wordpress\docker\entrypoint.sh'
$pluginDirectory = Join-Path $resolvedRoot 'wordpress\wp-content\plugins\aerion-ecommerce-reports'
$pluginTarget = Join-Path $pluginDirectory 'aerion-ecommerce-reports.php'
$pluginSource = Join-Path $PSScriptRoot 'aerion-ecommerce-reports.php'
$hashMarker = Join-Path $pluginDirectory '.crm-plugin-source.sha256'
$merchantTarget = Join-Path $resolvedRoot 'wordpress\wp-content\plugins\aerion-commerce\includes\class-aerion-google-merchant.php'
$merchantSource = Join-Path $PSScriptRoot 'class-aerion-google-merchant.php'
if (-not (Test-Path -LiteralPath $dockerfile) -or -not (Test-Path -LiteralPath $entrypoint)) {
    throw 'O destino precisa conter o projeto WordPress Aerion esperado.'
}
foreach ($target in @($dockerfile, $entrypoint, $pluginTarget)) {
    if (-not ([IO.Path]::GetFullPath($target).StartsWith($resolvedRoot + '\', [StringComparison]::OrdinalIgnoreCase))) {
        throw 'Destino fora do projeto informado.'
    }
}
if (Test-Path -LiteralPath $pluginTarget) {
    $currentHash = (Get-FileHash -LiteralPath $pluginTarget).Hash
    $installedHash = if (Test-Path -LiteralPath $hashMarker) { [IO.File]::ReadAllText($hashMarker).Trim() } else { '' }
    if ($currentHash -ne (Get-FileHash -LiteralPath $pluginSource).Hash -and $currentHash -ne $installedHash -and $currentHash -ne $ExpectedPreviousHash) {
        throw 'Já existe outro conteúdo no plugin de destino. Revise antes de substituir.'
    }
}
if ($ExpectedPreviousMerchantHash -ne '') {
    if (-not (Test-Path -LiteralPath $merchantTarget) -or (Get-FileHash -LiteralPath $merchantTarget).Hash -ne $ExpectedPreviousMerchantHash) {
        throw 'O feed Merchant foi alterado desde a revisão. Nenhum arquivo foi atualizado.'
    }
}
$dockerText = [IO.File]::ReadAllText($dockerfile)
$entrypointText = [IO.File]::ReadAllText($entrypoint)
$dockerAnchor = 'COPY wordpress/wp-content/plugins/aerion-core /opt/aerion/wp-content/plugins/aerion-core'
$dockerLine = 'COPY wordpress/wp-content/plugins/aerion-ecommerce-reports /opt/aerion/wp-content/plugins/aerion-ecommerce-reports'
$entryAnchor = 'for plugin in aerion-core aerion-blocks aerion-commerce aerion-sankhya; do'
$entryLine = 'for plugin in aerion-core aerion-blocks aerion-commerce aerion-sankhya aerion-ecommerce-reports; do'
if (-not $dockerText.Contains($dockerLine) -and -not $dockerText.Contains($dockerAnchor)) {
    throw 'Dockerfile diferente do esperado: integração precisa de revisão.'
}
if (-not $entrypointText.Contains($entryLine) -and -not $entrypointText.Contains($entryAnchor)) {
    throw 'Entrypoint diferente do esperado: integração precisa de revisão.'
}
$encoding = New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Path $pluginDirectory -Force | Out-Null
Copy-Item -LiteralPath $pluginSource -Destination $pluginTarget
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'measurement.php') -Destination (Join-Path $pluginDirectory 'measurement.php')
if ($ExpectedPreviousMerchantHash -ne '') { Copy-Item -LiteralPath $merchantSource -Destination $merchantTarget }
[IO.File]::WriteAllText($hashMarker, (Get-FileHash -LiteralPath $pluginSource).Hash, $encoding)
if (-not $dockerText.Contains($dockerLine)) {
    $newline = if ($dockerText.Contains("`r`n")) { "`r`n" } else { "`n" }
    [IO.File]::WriteAllText($dockerfile, $dockerText.Replace($dockerAnchor, $dockerAnchor + $newline + $dockerLine), $encoding)
}
if (-not $entrypointText.Contains($entryLine)) {
    [IO.File]::WriteAllText($entrypoint, $entrypointText.Replace($entryAnchor, $entryLine), $encoding)
}
Write-Output 'Plugin copiado; Dockerfile e entrypoint integrados. Nenhum deploy foi executado.'
