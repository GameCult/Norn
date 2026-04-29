[CmdletBinding()]
param(
    [string]$BindHost = "127.0.0.1",
    [int]$Port = 4177,
    [switch]$Install,
    [switch]$Detached,
    [string]$LogDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path
$viewerDir = Join-Path $repoRoot "web\epiphany-graph-viewer"
$packageJson = Join-Path $viewerDir "package.json"
$nodeModulesDir = Join-Path $viewerDir "node_modules"

if (-not (Test-Path $packageJson)) {
    throw "Could not find viewer package at '$viewerDir'."
}

if ($Install -or -not (Test-Path $nodeModulesDir)) {
    Write-Host "Installing viewer dependencies in $viewerDir ..." -ForegroundColor Cyan
    Push-Location $viewerDir
    try {
        & npm.cmd install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

$npmArgs = @(
    "run",
    "dev",
    "--",
    "--host",
    $BindHost,
    "--port",
    $Port.ToString()
)

if ($Detached) {
    if ([string]::IsNullOrWhiteSpace($LogDir)) {
        $LogDir = Join-Path $repoRoot "out\epiphany-graph-viewer"
    }

    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

    $stdoutPath = Join-Path $LogDir "dev.stdout.log"
    $stderrPath = Join-Path $LogDir "dev.stderr.log"

    $process = Start-Process `
        -FilePath "npm.cmd" `
        -ArgumentList $npmArgs `
        -WorkingDirectory $viewerDir `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru `
        -WindowStyle Hidden

    Start-Sleep -Seconds 2

    Write-Host "Started detached viewer dev server." -ForegroundColor Green
    Write-Host "PID: $($process.Id)"
    Write-Host "Host: http://$BindHost`:$Port/"
    Write-Host "STDOUT: $stdoutPath"
    Write-Host "STDERR: $stderrPath"
    Write-Host "Poll with:"
    Write-Host "  Get-Content '$stdoutPath' -Tail 40"
    return
}

Write-Host "Starting viewer dev server in $viewerDir ..." -ForegroundColor Green
Write-Host "URL: http://$BindHost`:$Port/"
Push-Location $viewerDir
try {
    & npm.cmd @npmArgs
    if ($LASTEXITCODE -ne 0) {
        throw "npm run dev failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
