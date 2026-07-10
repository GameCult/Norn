param([string] $NodePath = "node")

$ErrorActionPreference = "Stop"
& $NodePath (Join-Path $PSScriptRoot "run-eve-cultnet-witness.mjs")
if ($LASTEXITCODE -ne 0) { throw "Norn Eve plugin witness failed with exit code $LASTEXITCODE" }
