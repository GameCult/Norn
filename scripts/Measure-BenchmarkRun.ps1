param(
    [Parameter(Mandatory = $true)]
    [string]$RunDir
)

$ErrorActionPreference = "Stop"

$resolvedRunDir = (Resolve-Path $RunDir).Path
$manifestPath = Join-Path $resolvedRunDir "run-manifest.json"
if (-not (Test-Path $manifestPath)) {
    throw "No run-manifest.json found in $resolvedRunDir"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$rows = New-Object System.Collections.Generic.List[object]

foreach ($candidate in $manifest.candidates) {
    $candidateDir = $candidate.directory
    $scoresPath = Join-Path $candidateDir "scores.json"
    if (-not (Test-Path $scoresPath)) {
        $rows.Add([pscustomobject]@{
            Candidate = $candidate.id
            Status = "missing scores.json"
            ProbeScore = $null
            ProbeMax = $null
            ProbePercent = $null
            ReadabilityAverage = $null
        })
        continue
    }

    $scores = Get-Content -LiteralPath $scoresPath -Raw | ConvertFrom-Json
    $scoredProbes = @($scores.probeScores | Where-Object { $_.maxScore -gt 0 -and $null -ne $_.score })
    $probeScore = 0.0
    $probeMax = 0.0
    foreach ($probe in $scoredProbes) {
        $probeScore += [double]$probe.score
        $probeMax += [double]$probe.maxScore
    }

    $readabilityScores = @(
        $scores.readability.labelLegibility,
        $scores.readability.edgeTraceability,
        $scores.readability.clusterReadability,
        $scores.readability.flowReadability,
        $scores.readability.clutterControl
    ) | Where-Object { $null -ne $_ }

    $readabilityAverage = $null
    if ($readabilityScores.Count -gt 0) {
        $readabilityAverage = [math]::Round((($readabilityScores | Measure-Object -Average).Average), 2)
    }

    $probePercent = $null
    if ($probeMax -gt 0) {
        $probePercent = [math]::Round(($probeScore / $probeMax) * 100, 1)
    }

    $rows.Add([pscustomobject]@{
        Candidate = $candidate.id
        Status = "scored"
        ProbeScore = [math]::Round($probeScore, 2)
        ProbeMax = [math]::Round($probeMax, 2)
        ProbePercent = $probePercent
        ReadabilityAverage = $readabilityAverage
    })
}

$rows | Sort-Object ProbePercent -Descending | Format-Table -AutoSize
