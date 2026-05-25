param(
    [string]$SolverRoot = "E:\Projects\epiphany-graph-rs"
)

$ErrorActionPreference = "Stop"

$packageRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$solverRootPath = Resolve-Path $SolverRoot

Push-Location $solverRootPath
try {
    rustup target add wasm32-unknown-unknown | Out-Host
    cargo build --release --target wasm32-unknown-unknown | Out-Host
}
finally {
    Pop-Location
}

$wasmPath = Join-Path $solverRootPath "target\wasm32-unknown-unknown\release\epiphany_graph_rs.wasm"
$outputPath = Join-Path $packageRoot "src\lib\solver-wasm-bytes.ts"
$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($wasmPath))

@(
    "export const epiphanyGraphSolverWasmBase64 =",
    "  `"$base64`";"
) | Set-Content -LiteralPath $outputPath -Encoding UTF8

Write-Host "Updated $outputPath"
