# Norn

React-first graph viewer for Epiphany typed graph state.

The live package is `web/norn-viewer`. It is what clients and agents
should reach for when they want to render `architecture`, `dataflow`, and typed
cross-links in a UI.

The older .NET generator, MSAGL SVG renderer, and MCP server still exist as support
tools for note exports and legacy inspection. They are not competing client surfaces.
Do not make consumers choose between engines like this repo is a sad little trade
show booth.

## React Viewer

```powershell
cd E:\Projects\Norn\web\norn-viewer
npm install
npm run dev
```

```tsx
import { NornViewer } from "@gamecult/norn-viewer";
import type { NornGraphsState } from "@gamecult/norn-viewer";

export function GraphScreen({ state }: { state: NornGraphsState }) {
  return (
    <NornViewer
      state={state}
      layoutMode="combined-force"
      motion={{ strength: 1.05, flow: 1.1, orbit: 0.85 }}
      performance="fast"
    />
  );
}
```

The public viewer API is intentionally coarse:

- `layoutMode`: `layered`, `stress`, `force`, or `combined-force`
- `motion`: viewer-owned force tuning for Rust-solver combined-force layouts
- `performance`: `quality`, `balanced`, `fast`, or explicit `simulationBudgetMs` realtime knobs
- `selection`, `focusSelection`, `expandedNode`, and callbacks for app integration
- typed state and event payloads

## What It Does

The support generator:

- scans markdown notes under a vault folder
- resolves Obsidian wikilinks and regular markdown note links
- optionally starts from an entry note and keeps only reachable notes
- classifies notes into `source-tree` and `control-flow` graph families
- lays out each family as its own graph partition
- reports cross-links that still jump between those families
- runs Microsoft Automatic Graph Layout
- writes:
  - `manifest.json`
  - `source-tree.svg`
  - `source-tree.msagl.svg`
  - `source-tree.rich.svg`
  - `source-tree.json`
  - `control-flow.svg`
  - `control-flow.msagl.svg`
  - `control-flow.rich.svg`
  - `control-flow.json`
  - `cross-links.json`
  - `warnings.txt`

## CLI Usage

Run from source:

```powershell
dotnet run --project . -- `
  --vault-root "E:\Projects\Aetheria-Economy\Aetheria\Source Tree Map" `
  --entry-note "Source Tree Map" `
  --renderer rich `
  --output-dir ".\out\source-tree-map"
```

After packing as a .NET tool:

```powershell
norn `
  --vault-root "E:\Projects\Aetheria-Economy\Aetheria\Source Tree Map" `
  --entry-note "Source Tree Map" `
  --renderer rich `
  --output-dir ".\out\source-tree-map"
```

## MCP Usage

The MCP server exposes one tool:

- `generate_obsidian_graph_layout`

### Run From Source

Use this in an MCP client config when you want to launch the server straight from the repo:

```json
{
  "mcpServers": {
    "norn": {
      "command": "dotnet",
      "args": [
        "run",
        "--project",
        "E:\\Projects\\Norn\\Norn.csproj",
        "--",
        "--mcp"
      ]
    }
  }
}
```

### Pack As A .NET Tool

Build the package:

```powershell
dotnet pack . -c Release -o .\nupkg
```

Install it from the local package output:

```powershell
dotnet tool install --global --add-source .\nupkg Norn
```

Then point your MCP client at the installed command:

```json
{
  "mcpServers": {
    "norn": {
      "command": "norn",
      "args": ["--mcp"]
    }
  }
}
```

### MCP Tool Arguments

- `vaultRoot`: path to the Obsidian vault folder
- `entryNote`: optional entry note name or relative note path
- `outputDir`: optional output directory, defaults to `./out`
- `layout`: `sugiyama` or `mds`
- `renderer`: `msagl` or `rich`
- `includeUnreachable`: keep notes that are not reachable from the entry note

### MCP Tool Result

The tool writes `manifest.json`, primary partition SVGs, raw `.msagl.svg` variants, custom `.rich.svg` variants, partition JSON files, `cross-links.json`, and `warnings.txt`, then returns:

- output paths for each partition
- seed note IDs used for traversal
- total note and edge counts
- per-partition node and edge counts
- warnings
- the resolved entry note ID, if one was used

## Graph Families

By default, notes whose basename contains `Control Flow` land in the `control-flow` partition, and everything else lands in `source-tree`.

You can override that with frontmatter on a note:

```yaml
---
norn-family: control-flow
---
```

or:

```yaml
---
norn-families:
  - source-tree
  - control-flow
---
```

Supported keys:

- `norn-family`
- `norn-families`
- `graph-family`
- `graph-families`

If your chosen `entryNote` is itself one of the explicit family roots, the generator also seeds traversal from any sibling family roots it can find.

- `Source Tree Map` will also pull in `Control Flow Map`
- `Control Flow Map` will also pull in `Source Tree Map`

That keeps structurally separated note graphs from vanishing just because they no longer link to each other directly.

## Layout Modes

- `sugiyama`: layered, better for hierarchy-heavy note trees
- `mds`: force-ish spread, better when the graph is cross-linked chaos

`mds` is the closest MSAGL-native approximation to the Obsidian or Kamada-Kawai vibe. It is not a named Kamada-Kawai mode.

## Renderer Modes

- `msagl`: the stock MSAGL SVG, useful as the plain baseline
- `rich`: a custom SVG renderer that consumes MSAGL graph geometry and semantic metadata, then draws something with more visual hierarchy and less beige despair

## Support Tool: Norn Viewer Demo

The web-side viewer package lives under `web/norn-viewer/`.

It consumes the typed Epiphany graph state shape directly:

- `graphs.architecture`
- `graphs.dataflow`
- `graphs.links`

and packages:

- Rust hybrid solver layout through bundled WASM
- zoom and pan
- zoom-gated label and detail pop-in
- node, edge, and code-ref inspection
- typed cross-link browsing between architecture and dataflow
- combined-force motion tuning for clients that want the lively overview

Run it locally with:

```powershell
cd E:\Projects\Norn\web\norn-viewer
npm install
npm run dev
```

## Notes

- unresolved and ambiguous links are written to `warnings.txt`
- node IDs in the partition `.json` files are relative note paths without `.md`
- the current implementation estimates label sizes instead of using a platform text measurer, because this is a generator, not a cathedral
- `source-tree.svg` and `control-flow.svg` are the primary outputs for the selected renderer
- raw MSAGL output is always preserved as `*.msagl.svg`
- the custom renderer currently emits `*.rich.svg` from MSAGL geometry, not from post-processing the stock SVG
