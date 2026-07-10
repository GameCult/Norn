param(
  [string] $EveRoot = "E:\Projects\Eve",
  [string] $OutputPath = "artifacts\eve-plugin\runtime-witness.json"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$output = if ([IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $repoRoot $OutputPath }
$launcher = Join-Path $EveRoot "tools\plugins\run-sidecar-witness.mjs"
$advertisement = Join-Path $repoRoot "plugins\norn-graph.plugin-advertisement.json"
$fixture = Join-Path $repoRoot "plugins\norn-graph.plugin-abi-fixture.json"

foreach ($required in @($launcher, $advertisement, $fixture)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Norn Eve plugin witness path not found: $required" }
}

cargo build --quiet -p norn-eve-plugin
if ($LASTEXITCODE -ne 0) { throw "norn-eve-plugin build failed with exit code $LASTEXITCODE" }
$executable = Join-Path $repoRoot "target\debug\norn-eve-plugin.exe"
if (-not (Test-Path -LiteralPath $executable)) { throw "Norn sidecar executable was not produced: $executable" }

node $launcher `
  --advertisement $advertisement `
  --fixture $fixture `
  --output $output `
  --witness-id "norn.graph.owner-sidecar" `
  --cwd $repoRoot `
  --command $executable
if ($LASTEXITCODE -ne 0) { throw "Norn Eve plugin witness failed with exit code $LASTEXITCODE" }

Write-Host "Norn Eve plugin witness: $output"
