# Model Friendliness Rendering Tuner

This tuner guides experiments that make EpiphanyGraph output easier for both humans and vision-capable agents to understand.

The point is not to make a prettier hairball. The point is to render graphs in ways that expose useful structure quickly, with enough machine-readable backing data to verify what the eyes think they saw.

## Working Hypothesis

A rendered graph can give an agent real visual signal about clusters, bridges, density, flow, and suspicious structure. That signal gets stronger when the rendering is stable, readable, semantically colored, and paired with exact layout JSON.

Do not rely on visual intuition alone. Use the image for visceral structure and the JSON for truth.

## Current Scope

Focus now:

- sweep 2D layout algorithms and parameters
- tune readability through color, labels, spacing, stroke weight, background, and edge routing
- preserve exact node and edge data in JSON
- compare outputs using human and agent visual judgement
- support separate but linked graph views, especially source tree versus control flow

Defer for later:

- fake 3D
- layered perspective rendering
- cross-layer pull constraints
- multi-graph alignment driven by CFG-to-source anchors

3D can wait. MSAGL is not a 3D renderer, and shoving depth cues into a 2D layout before the mapping data exists is how we summon decorative mud.

## Design Rule

Use render sweeps to find views that make structure obvious before labels are read, then use structured data to verify the exact interpretation.

## Separate Graphs, Linked Meaning

Keep different graph families visually separate when they represent different kinds of truth.

Use separate canonical views for:

- source tree and ownership structure
- call graph
- control flow graph
- dependency graph
- note or concept graph

Connect them through explicit anchors, not one mega-graph.

Useful anchor chain:

```text
source tree -> file -> symbol/function -> CFG block -> line span
```

This gives the assistant and the human a sane bridge between architecture-scale structure and execution-scale detail.

## Cross-Graph Link Requirements

Before attempting interconnected layered graphs, collect explicit mapping data.

Required link data:

- file path for every symbol and CFG node
- symbol name or stable symbol ID
- source line span for CFG blocks
- containing module or directory
- edge type for every cross-view relationship

Useful edge types:

- `contains`
- `defined_in`
- `calls`
- `branches_to`
- `throws_to`
- `returns_to`
- `imports`
- `references`

Do not ask visual layout to infer these relationships from proximity alone. Proximity is a hint. Typed edges are the receipt.

## Sweep Axes

Run controlled sweeps across layout and rendering parameters. Change one or two variables per batch unless the intent is broad exploration.

Layout algorithms:

- `sugiyama` for hierarchy, flow, and source-tree-like structures
- `mds` for organic shape and cluster discovery
- `ranking` or layered variants if MSAGL exposes useful alternatives
- force-directed or Kamada-Kawai-style layout if added later

Notes:

- MSAGL does not currently expose a named Kamada-Kawai mode in the public settings surface we are using.
- `mds` is the closest MSAGL-native approximation to the Obsidian or Kamada-Kawai feel.
- Treat `mds` as "roughly the same family of organic distance-fitting layouts," not as an exact algorithm match.

Layout parameters:

- node separation
- layer separation
- aspect ratio
- edge routing mode
- spline versus straight edges
- cluster padding
- graph margins
- deterministic ordering
- fixed or pinned anchor nodes when available

Rendering parameters:

- background color
- node fill palette
- label font size
- label wrapping width
- node padding
- stroke width
- edge opacity
- edge arrow style
- edge curvature
- shadow or halo for selected nodes
- cluster boundary style
- warning/error emphasis

Export parameters:

- SVG viewport size
- high-resolution PNG rasterization if needed
- layout JSON precision
- stable IDs in every visual element
- optional image filename that encodes the sweep parameters

## Color Semantics

Use color to encode meaning, not decoration.

Suggested source view categories:

- entry or selected node
- directory or module
- source file
- test file
- generated file
- external dependency
- orphan or unreachable node
- warning or ambiguous link

Suggested CFG categories:

- function entry
- normal block
- branch or decision block
- loop block
- return block
- throw or error block
- call site
- merge point

Color rules:

- keep category colors consistent across sweeps
- use contrast high enough for labels and edge crossings
- avoid palettes where adjacent categories differ only by vibe
- reserve red or hot warning colors for real problems
- prefer subtle backgrounds over pure white only if readability improves

## Readability Rubric

Score each candidate output against the real job.

Use a 1 to 5 score for:

- label legibility
- edge traceability
- cluster readability
- flow readability
- hub visibility
- bridge visibility
- isolate visibility
- visual clutter control
- stability across similar inputs
- correspondence between image and JSON

Reject candidates when:

- labels require zooming before any structure is apparent
- edge crossings dominate the image
- color does not encode meaningful categories
- the layout looks balanced but hides flow
- the graph changes shape wildly after small input changes
- important nodes are visually buried
- the image cannot be explained using the JSON

## Benchmark Harness

Use the local harness in `benchmarks/` when this needs to become measurement instead of taste.

Current command:

```powershell
.\scripts\New-BenchmarkRun.ps1
```

The harness renders each candidate, writes blind probe sheets, keeps gold answers separate, and lets a Codex-only review pass score whether the image actually helped recover graph truth.

Primary metric:

- correct answers to grounded graph probes

Secondary diagnostics:

- label legibility
- edge traceability
- cluster readability
- flow readability
- clutter control

If a render wins on subjective prettiness but loses on grounded probe answers, throw the pretty one into the sea. Lovingly.

## Agent Review Prompt

Use this prompt when asking an agent to review a render sweep:

> Inspect the rendered graph image and the corresponding layout JSON together. First describe the major visible structures: clusters, hubs, bridges, isolates, dense regions, flow direction, and any suspicious crossings or bottlenecks. Then verify the important claims against the JSON node and edge data. Score readability from 1 to 5 for labels, edge traceability, cluster readability, flow readability, and clutter control. Prefer outputs that make meaningful structure visible quickly while preserving exact machine-readable mappings. Do not reward prettiness unless it improves understanding.

## Sweep Output Format

Each sweep candidate should produce:

- rendered SVG
- optional PNG preview
- layout JSON
- warnings file
- parameter manifest
- short review note

Recommended candidate directory shape:

```text
out/sweeps/<sweep-name>/
  manifest.json
  candidates/
    001-sugiyama-light-large-labels/
      graph.svg
      graph.json
      warnings.txt
      review.md
    002-mds-warm-bg-curved-edges/
      graph.svg
      graph.json
      warnings.txt
      review.md
```

## When MSAGL Is Enough

Stay with MSAGL rendering when:

- the graph is single-view
- labels are readable
- colors and shapes are enough to encode categories
- edge routing is acceptable
- the SVG output can carry the needed IDs and metadata

## When To Use A Custom Renderer

Use MSAGL for layout but a custom renderer for drawing when:

- labels need better wrapping or placement
- category styling outgrows MSAGL defaults
- cross-view highlights need stable DOM IDs
- multi-graph overlays need explicit tethers
- the same layout must render in several visual themes
- background, halos, shadows, or cluster containers need careful control
- accessibility or contrast requirements matter

In that mode, MSAGL produces coordinates and routing. The custom renderer turns `graph.json` into the final SVG or canvas output. MSAGL gets to do math. The renderer gets to do taste. Everyone stays in their lane, blessedly.

## Renderer Direction

Assume the built-in MSAGL SVG is a baseline diagnostic artifact, not the final visual language.

What the raw SVG is good at:

- proving the layout exists
- exposing coordinates and routing
- making technical regressions visible
- giving the benchmark something immediate to chew on

What the raw SVG is bad at:

- dense structural insight
- semantic emphasis
- expressive labels
- rich cluster treatment
- visual hierarchy across node classes
- overlays, focus states, and linked-view affordances

Current renderer target:

- MSAGL computes coordinates and edge routing
- `graph.json` remains the source of truth for node and edge semantics
- a custom renderer draws the actual human-and-agent-facing artifact

Custom renderer priorities:

- semantically meaningful node styling by category and role
- stronger label treatment, wrapping, truncation, and halo rules
- visually distinct edge classes and emphasis states
- cluster containers or region shading when it improves structure
- linked-view highlighting between source-tree and control-flow graphs
- stable DOM IDs and metadata hooks for interaction and benchmarking
- multiple themes optimized for overview, dense inspection, and presentation

If we want rich, dense structural insight, we should stop pretending the stock SVG is the product. It is the scaffolding.

## Future Layered Views

For multiple interconnected graph layers, use explicit constraints and anchors.

Possible future layout model:

- source tree layer stays stable
- control flow layer renders separately
- CFG nodes align near their owning symbols or files
- cross-layer tethers connect CFG regions to source anchors
- selected paths highlight touched files and symbols
- unrelated layers dim instead of disappearing

Do not attempt this until the code analysis pipeline can emit reliable CFG-to-file and CFG-to-symbol mappings.

## Short Version

- sweep layout algorithms and visual parameters deliberately
- score outputs by readability and reasoning usefulness
- color should encode meaningful categories
- keep source graphs and CFGs separate but explicitly linked
- use visual layout for intuition and JSON for truth
- defer 3D until cross-layer mappings and constraints exist
- switch to a custom renderer when MSAGL layout is useful but MSAGL drawing is too blunt
