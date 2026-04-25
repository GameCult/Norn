param(
    [string]$SpecPath,
    [string]$OutputRoot,
    [string]$ProjectPath
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptRoot "..")).Path

if ([string]::IsNullOrWhiteSpace($SpecPath)) {
    $SpecPath = Join-Path $repoRoot "benchmarks\aetheria-economy\source-tree-map.benchmark.json"
}

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $repoRoot "out\benchmarks"
}

if ([string]::IsNullOrWhiteSpace($ProjectPath)) {
    $ProjectPath = Join-Path $repoRoot "EpiphanyGraph.csproj"
}

function Get-SvgRasterizerPath {
    $candidates = @(
        "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        "C:\Program Files\Google\Chrome\Application\chrome.exe"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

function Get-SvgCanvasSize {
    param(
        [string]$SvgPath
    )

    $header = [string]::Join("`n", (Get-Content -LiteralPath $SvgPath -TotalCount 4))
    $width = 2048
    $height = 2048

    $widthMatch = [regex]::Match($header, 'width="([0-9]+(?:\.[0-9]+)?)"')
    if ($widthMatch.Success) {
        $width = [math]::Ceiling([double]$widthMatch.Groups[1].Value)
    }

    $heightMatch = [regex]::Match($header, 'height="([0-9]+(?:\.[0-9]+)?)"')
    if ($heightMatch.Success) {
        $height = [math]::Ceiling([double]$heightMatch.Groups[1].Value)
    }

    $padding = 32
    return [pscustomobject]@{
        Width = [math]::Min([math]::Max($width + $padding, 512), 8192)
        Height = [math]::Min([math]::Max($height + $padding, 512), 8192)
    }
}

function Convert-SvgToPng {
    param(
        [string]$BrowserPath,
        [string]$SvgPath,
        [string]$PngPath
    )

    $canvas = Get-SvgCanvasSize -SvgPath $SvgPath
    $svgUri = [System.Uri]::new((Resolve-Path $SvgPath).Path).AbsoluteUri

    Remove-Item -LiteralPath $PngPath -Force -ErrorAction SilentlyContinue

    $browserArgs = @(
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--window-size=$($canvas.Width),$($canvas.Height)",
        "--screenshot=$PngPath",
        $svgUri
    )

    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()

    try {
        $process = Start-Process `
            -FilePath $BrowserPath `
            -ArgumentList $browserArgs `
            -Wait `
            -NoNewWindow `
            -PassThru `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath

        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            if (Test-Path $PngPath) {
                break
            }

            Start-Sleep -Milliseconds 250
        }
    }
    finally {
        Remove-Item -LiteralPath $stdoutPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path $PngPath)) {
        throw "Failed to rasterize '$SvgPath' to '$PngPath'."
    }
}

function Resolve-BenchmarkPath {
    param(
        [string]$BaseDirectory,
        [string]$PathValue
    )

    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return (Resolve-Path $PathValue).Path
    }

    $fromSpec = Join-Path $BaseDirectory $PathValue
    if (Test-Path $fromSpec) {
        return (Resolve-Path $fromSpec).Path
    }

    return (Resolve-Path (Join-Path $repoRoot $PathValue)).Path
}

$resolvedSpecPath = (Resolve-Path $SpecPath).Path
$specDirectory = Split-Path -Parent $resolvedSpecPath
$spec = Get-Content -LiteralPath $resolvedSpecPath -Raw | ConvertFrom-Json
$questionsPath = Resolve-BenchmarkPath -BaseDirectory $specDirectory -PathValue $spec.questionsPath
$goldPath = Resolve-BenchmarkPath -BaseDirectory $specDirectory -PathValue $spec.goldPath
$questions = Get-Content -LiteralPath $questionsPath -Raw | ConvertFrom-Json
$svgRasterizerPath = Get-SvgRasterizerPath

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$runRoot = Join-Path $OutputRoot $spec.name
$runDir = Join-Path $runRoot $runId
$candidateRoot = Join-Path $runDir "candidates"

New-Item -ItemType Directory -Path $candidateRoot -Force | Out-Null
Copy-Item -LiteralPath $resolvedSpecPath -Destination (Join-Path $runDir "benchmark.json")
Copy-Item -LiteralPath $questionsPath -Destination (Join-Path $runDir "questions.json")
Copy-Item -LiteralPath $goldPath -Destination (Join-Path $runDir "gold.json")

$candidateResults = New-Object System.Collections.Generic.List[object]

foreach ($candidate in $spec.candidates) {
    $candidateId = $candidate.id
    $candidateDir = Join-Path $candidateRoot $candidateId
    $renderDir = Join-Path $candidateDir "render"
    $logPath = Join-Path $candidateDir "generate.log"
    New-Item -ItemType Directory -Path $renderDir -Force | Out-Null

    $dotnetArgs = @(
        "run",
        "--project",
        $ProjectPath,
        "--",
        "--vault-root",
        $spec.vaultRoot,
        "--entry-note",
        $spec.entryNote,
        "--output-dir",
        $renderDir,
        "--layout",
        $candidate.layout
    )

    if ($candidate.PSObject.Properties.Name -contains "renderer" -and -not [string]::IsNullOrWhiteSpace($candidate.renderer)) {
        $dotnetArgs += @(
            "--renderer",
            $candidate.renderer
        )
    }

    if ($spec.includeUnreachable -eq $true) {
        $dotnetArgs += "--include-unreachable"
    }

    Write-Host "Rendering candidate '$candidateId'..."
    & dotnet @dotnetArgs 2>&1 | Tee-Object -FilePath $logPath
    if ($LASTEXITCODE -ne 0) {
        throw "Candidate '$candidateId' failed. See $logPath"
    }

    $pngPreviewPaths = New-Object System.Collections.Generic.List[object]
    if ($svgRasterizerPath) {
        foreach ($graphKey in @("source-tree", "control-flow")) {
            $svgPath = Join-Path $renderDir "$graphKey.svg"
            if (-not (Test-Path $svgPath)) {
                continue
            }

            $pngPath = Join-Path $renderDir "$graphKey.png"
            Convert-SvgToPng -BrowserPath $svgRasterizerPath -SvgPath $svgPath -PngPath $pngPath
            $pngPreviewPaths.Add([ordered]@{
                graph = $graphKey
                pngPath = $pngPath
                svgPath = $svgPath
            })
        }
    }

    Copy-Item -LiteralPath $questionsPath -Destination (Join-Path $candidateDir "questions.json")

    $answerSheetPath = Join-Path $candidateDir "answer-sheet.md"
    $scoreTemplatePath = Join-Path $candidateDir "scores.template.json"

    $renderRelative = "render"
    $answerLines = New-Object System.Collections.Generic.List[string]
    $answerLines.Add("# Benchmark Answer Sheet")
    $answerLines.Add("")
    $answerLines.Add("Candidate: ``$candidateId``")
    $answerLines.Add("")
    $answerLines.Add("Render directory: ``$renderRelative``")
    $answerLines.Add("")
    $answerLines.Add("Important: answer these probes before opening the run-level ``gold.json``. The whole point is not to grade a contaminated oracle. Tiny basement science, yes, but still science.")
    $answerLines.Add("")
    $answerLines.Add("Open as needed:")
    $answerLines.Add("")
    if ($svgRasterizerPath) {
        $answerLines.Add("- ``render\source-tree.png`` for source-tree image probes")
        $answerLines.Add("- ``render\control-flow.png`` for control-flow image probes")
        $answerLines.Add("- ``render\source-tree.svg`` and ``render\control-flow.svg`` only as vector reference for the candidate under test, not as the primary image input")
    }
    else {
        $answerLines.Add("- ``render\source-tree.svg``")
        $answerLines.Add("- ``render\control-flow.svg``")
        $answerLines.Add("- Warning: no local browser rasterizer was found, so PNG previews were not generated.")
    }
    $answerLines.Add("- Ignore ``*.msagl.svg`` and ``*.rich.svg`` during blind review unless you are doing post-hoc renderer autopsy work")
    $answerLines.Add("- ``render\source-tree.json``")
    $answerLines.Add("- ``render\control-flow.json``")
    $answerLines.Add("- ``render\cross-links.json``")
    $answerLines.Add("")
    $answerLines.Add("## Probe Answers")

    foreach ($probe in $questions.probes) {
        $allowedInputs = [string]::Join(", ", @($probe.allowedInputs))
        $answerLines.Add("")
        $answerLines.Add("### $($probe.id)")
        $answerLines.Add("")
        $answerLines.Add("- Graph: ``$($probe.graph)``")
        $answerLines.Add("- Allowed inputs: ``$allowedInputs``")
        $answerLines.Add("- Max score: ``$($probe.maxScore)``")
        $answerLines.Add("")
        $answerLines.Add("Question: $($probe.question)")
        $answerLines.Add("")
        $answerLines.Add("Expected answer format: $($probe.answerFormat)")
        $answerLines.Add("")
        $answerLines.Add("Answer:")
        $answerLines.Add("")
        $answerLines.Add("> ")
    }

    $answerLines | Set-Content -LiteralPath $answerSheetPath

    $probeScores = @(
        foreach ($probe in $questions.probes) {
            [ordered]@{
                probeId = $probe.id
                maxScore = $probe.maxScore
                score = $null
                notes = ""
            }
        }
    )

    $scoreTemplate = [ordered]@{
        candidateId = $candidateId
        scoredBy = ""
        scoredAtUtc = ""
        readability = [ordered]@{
            labelLegibility = $null
            edgeTraceability = $null
            clusterReadability = $null
            flowReadability = $null
            clutterControl = $null
            notes = ""
        }
        probeScores = $probeScores
    }

    $scoreTemplate | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $scoreTemplatePath

    $candidateResults.Add([ordered]@{
        id = $candidateId
        description = $candidate.description
        layout = $candidate.layout
        renderer = if ($candidate.PSObject.Properties.Name -contains "renderer" -and -not [string]::IsNullOrWhiteSpace($candidate.renderer)) { $candidate.renderer } else { "msagl" }
        directory = $candidateDir
        renderDirectory = $renderDir
        rasterizer = $svgRasterizerPath
        imagePreviews = @($pngPreviewPaths.ToArray())
        answerSheet = $answerSheetPath
        scoreTemplate = $scoreTemplatePath
        log = $logPath
    })
}

$candidateArray = @($candidateResults.ToArray())
$runManifest = [ordered]@{
    benchmark = $spec.name
    runId = $runId
    createdAtUtc = (Get-Date).ToUniversalTime().ToString("O")
    specPath = $resolvedSpecPath
    questionsPath = (Join-Path $runDir "questions.json")
    goldPath = (Join-Path $runDir "gold.json")
    outputDirectory = $runDir
    candidates = $candidateArray
}

$manifestPath = Join-Path $runDir "run-manifest.json"
$runManifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $manifestPath

Write-Host ""
Write-Host "Benchmark run created:"
Write-Host $runDir
Write-Host ""
Write-Host "Review each candidate answer-sheet.md before opening gold.json. Don't cheat unless you enjoy measuring pasteurized vibes."
