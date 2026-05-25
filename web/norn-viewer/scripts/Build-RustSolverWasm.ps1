param(
    [string]$SolverRoot = ""
)

$ErrorActionPreference = "Stop"

$packageRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
if ([string]::IsNullOrWhiteSpace($SolverRoot)) {
    $SolverRoot = Join-Path $repoRoot "crates\norn-rs"
}
$solverRootPath = Resolve-Path $SolverRoot
$wasmTargetDir = Join-Path $solverRootPath "target"

Push-Location $solverRootPath
try {
    rustup target add wasm32-unknown-unknown | Out-Host
    cargo build --release --target wasm32-unknown-unknown --target-dir $wasmTargetDir | Out-Host
}
finally {
    Pop-Location
}

$wasmPath = Join-Path $solverRootPath "target\wasm32-unknown-unknown\release\norn_rs.wasm"
$outputPath = Join-Path $packageRoot "src\lib\solver-wasm-bytes.ts"
$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($wasmPath))

@(
    "export const nornGraphSolverWasmBase64 =",
    "  `"$base64`";"
) | Set-Content -LiteralPath $outputPath -Encoding UTF8

Write-Host "Updated $outputPath"
