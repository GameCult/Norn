# EpiphanyGraph Benchmarks

These benchmarks measure whether a rendered graph helps a vision-capable agent recover useful graph truth.

This is not a beauty contest. If a candidate looks cool but does not improve correct answers, it is decorative trash in a nice hat.

Scope boundary: the current harness scores static rendered graph truth. It does not
yet exercise the React viewer's realtime simulation budget, adaptive node sampling,
or edge refresh heuristics.

## Local Workflow

Generate a benchmark run:

```powershell
.\scripts\New-BenchmarkRun.ps1
```

The script creates a timestamped run under `out/benchmarks/`, renders every candidate from the benchmark spec, and writes a review sheet for each candidate.

Review one candidate at a time:

1. Open the candidate PNG listed in `answer-sheet.md`.
2. Answer the blind probe questions before reading any gold data.
3. Treat the SVG as vector reference only, not as the primary image input.
4. Use the layout JSON only when a probe says JSON is allowed.
5. Copy `scores.template.json` to `scores.json`.
6. Fill in the per-probe scores after comparing your answers against the run-level `gold.json`.

Each candidate render directory may also contain sibling `*.msagl.svg` and `*.rich.svg` files. During blind review, ignore those. The candidate under test is always the primary `source-tree.svg` / `control-flow.svg` pair plus their PNG previews.

Aggregate manual scores:

```powershell
.\scripts\Measure-BenchmarkRun.ps1 -RunDir .\out\benchmarks\aetheria-source-tree-map\<run-id>
```

## Benchmark Shape

Each benchmark contains:

- `*.benchmark.json`: corpus path, graph entry note, and render candidates
- `questions.json`: blind probes shown to the evaluator
- `gold.json`: expected answers and scoring criteria

The generated run contains:

- `run-manifest.json`: run metadata and candidate outputs
- `gold.json`: scoring key, kept out of per-candidate answer sheets
- `candidates/<candidate-id>/render/`: EpiphanyGraph outputs
- `candidates/<candidate-id>/render/*.png`: raster previews for image probes
- `candidates/<candidate-id>/render/*.msagl.svg`: preserved stock baseline output
- `candidates/<candidate-id>/render/*.rich.svg`: preserved custom renderer output
- `candidates/<candidate-id>/answer-sheet.md`: blind review sheet
- `candidates/<candidate-id>/scores.template.json`: manual scoring skeleton

## Input Modes

Probe questions declare allowed inputs.

- `image`: answer from the rendered SVG only
- `json`: inspect layout JSON or graph data
- `image+json`: use the visual first, then verify against JSON

The useful benchmark result is the delta between these modes. If the image does not help the evaluator answer graph questions better, the render is just wallpaper with arrows.

## Current Corpus

`aetheria-economy/source-tree-map.benchmark.json` targets:

```text
E:\Projects\Aetheria-Economy\Aetheria\Source Tree Map
```

It exercises the current EpiphanyGraph partition output:

- `source-tree.svg` and `source-tree.json`
- `control-flow.svg` and `control-flow.json`
- `cross-links.json`

## Scoring

Start with simple manual scoring. Automation can come later after the probes stop wriggling.

Use:

- `1.0`: correct and specific
- `0.5`: partially correct, vague, or missing one key element
- `0.0`: wrong, hallucinated, or unsupported by the allowed inputs

Diagnostic probes may have `maxScore` set to `0`. They are useful notes, not leaderboard bait.

## Realtime Budget Harness

The React viewer needs a separate harness before anyone claims extensive realtime
heuristic tuning.

Current smoke baseline:

```powershell
cd .\web\epiphany-graph-viewer
npm run tune:simulation
```

This writes `benchmarks/realtime/simulation-profile-baseline.json`. It is a baseline
for the viewer's default meta-heuristic, not a final proof. The corpus is synthetic
mock-state expansion; useful, but not enough to crown anything.

That harness should measure, for each graph corpus and performance profile:

- requested `simulationBudgetMs`
- measured simulation step cost distribution
- adaptive node budget over time
- edge refresh cadence over time
- layout-anchor error for sampled and unsampled nodes
- visual stability during pan, zoom, selection, and graph switching

Ground truth for the realtime layer is the base layout plus the full unconstrained
simulation sample for the same frame window. Budgeted runs should be scored by how
closely they approximate that result while staying inside the requested millisecond
budget.
