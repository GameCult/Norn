# EpiphanyGraph

Small .NET tool for turning an Obsidian note subtree into an MSAGL layout. It still works as a CLI, and now it can also sit on stdio as an MCP server.

## What It Does

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
epiphanygraph `
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
    "epiphanygraph": {
      "command": "dotnet",
      "args": [
        "run",
        "--project",
        "E:\\Projects\\EpiphanyGraph\\EpiphanyGraph.csproj",
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
dotnet tool install --global --add-source .\nupkg EpiphanyGraph
```

Then point your MCP client at the installed command:

```json
{
  "mcpServers": {
    "epiphanygraph": {
      "command": "epiphanygraph",
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
epiphany-graph-family: control-flow
---
```

or:

```yaml
---
epiphany-graph-families:
  - source-tree
  - control-flow
---
```

Supported keys:

- `epiphany-graph-family`
- `epiphany-graph-families`
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

## ELK Probe

There is also a small web-side `elkjs` probe under `web/elk-probe/`. It inspects which algorithms and options are actually present in the installed `elkjs` build and can relayout existing `source-tree.json` / `control-flow.json` outputs without crossing the C# boundary.

## Epiphany Graph Viewer

There is now also a real web-side viewer package under `web/epiphany-graph-viewer/`.

It consumes the typed Epiphany graph state shape directly:

- `graphs.architecture`
- `graphs.dataflow`
- `graphs.links`

and packages:

- `elkjs` layout
- zoom and pan
- zoom-gated label and detail pop-in
- node, edge, and code-ref inspection
- typed cross-link browsing between architecture and dataflow

Run it locally with:

```powershell
cd E:\Projects\EpiphanyGraph\web\epiphany-graph-viewer
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
