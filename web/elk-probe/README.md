# ELK Probe

Small local `elkjs` probe for EpiphanyGraph.

This is not the final viewer. It is a migration scout:

- inspect which algorithms and options are actually present in the installed `elkjs` build
- adapt existing EpiphanyGraph partition JSON into ELK graphs
- run sample layouts without crossing the C# boundary
- emit simple SVG artifacts under `out/elk-probe/` for side-by-side comparison

## Install

```powershell
cd E:\Projects\EpiphanyGraph\web\elk-probe
npm install
```

## Inspect Available ELK Surface

```powershell
npm run inspect
```

Writes:

- `out/elk-probe/inspect/known-layout-algorithms.json`
- `out/elk-probe/inspect/known-layout-options.json`

## Probe Existing Graph Output

Point the probe at a render directory that already contains `source-tree.json` and `control-flow.json`:

```powershell
npm run probe -- --render-dir "E:\Projects\EpiphanyGraph\out\benchmarks\aetheria-source-tree-map\20260425T082539Z\candidates\sugiyama-rich\render"
```

Optional flags:

- `--render-dir <path>` explicit input directory; if omitted, the probe tries to use the newest benchmark candidate render it can find
- `--out-dir <path>` custom output directory
- `--source-tree-algorithm <id>` defaults to `org.eclipse.elk.layered`
- `--control-flow-algorithm <id>` defaults to `org.eclipse.elk.stress`

Writes one folder per partition under `out/elk-probe/<timestamp>/` with:

- `input.json`
- `elk-layout.json`
- `layout.svg`
- `layout-summary.json`

The SVG renderer here is deliberately plain. The point is to test layout integration and algorithm availability, not to declare victory with decorative sludge.
