# Epiphany Graph Viewer

React component package for browsing Epiphany's durable typed graph state.

This package is the live client surface. The viewer owns layout, motion, selection,
inspection, and rendering policy; consuming apps provide typed graph state and coarse
viewer intent. Nobody needs to learn which engine coughed up which coordinates. That
was how we got the little public API landfill.

- `graphs.architecture` and `graphs.dataflow` render as first-class views
- `graphs.links` show cross-graph correspondences instead of vanishing into a sidecar file
- zoom reveals more node detail instead of trying to print the whole phone book at once
- selection opens purpose, mechanism, metaphor, status, and code references in a detail pane
- `layoutMode="combined-force"` gives clients the compact ELK shape plus live force motion

## Install

```powershell
cd E:\Projects\EpiphanyGraph\web\epiphany-graph-viewer
npm install
```

## Run The Demo

```powershell
npm run dev
```

The demo uses mocked JSON shaped like the current Epiphany typed state contract.

## Build

```powershell
npm run build
```

This writes:

- `dist/index.js`
- `dist/index.cjs`
- `dist/index.d.ts`
- `dist/demo/`

## Use In Another App

```tsx
import { EpiphanyGraphViewer } from "@epiphanygraph/epiphany-graph-viewer";
import type { EpiphanyGraphsState } from "@epiphanygraph/epiphany-graph-viewer";

const state: EpiphanyGraphsState = {
  architecture: { nodes: [], edges: [] },
  dataflow: { nodes: [], edges: [] },
  links: [],
};

export function Screen() {
  return (
    <EpiphanyGraphViewer
      state={state}
      layoutMode="combined-force"
      motion={{ strength: 1.05, flow: 1.1, orbit: 0.85 }}
    />
  );
}
```

## Public API

The package exports:

- `EpiphanyGraphViewer`
- state, selection, node, edge, layout mode, motion, and event payload types

The package does not export demo data, validation helpers, ELK probes, SVG renderers,
or engine controls. Those are implementation furniture. Consumers get the couch, not
the warehouse inventory.

## Layout Modes

- `layered`: stable default for hierarchy-heavy graphs
- `stress`: compact overview shape for dense graphs
- `force`: ELK force layout without browser-side motion
- `combined-force`: compact overview plus viewer-owned force motion

`layoutMode` accepts one mode for both graphs or per-graph modes:

```tsx
<EpiphanyGraphViewer
  state={state}
  layoutMode={{ architecture: "layered", dataflow: "combined-force" }}
/>
```

## Motion

`combined-force` enables motion automatically. Pass `motion={false}` to freeze it, or
tune the viewer-owned model:

```tsx
<EpiphanyGraphViewer
  state={state}
  layoutMode="combined-force"
  motion={{
    strength: 1.1,
    damping: 0.84,
    flow: 1.15,
    orbit: 0.8,
    lift: 0.9,
    pulse: 1,
    emitNodeEnvelopes: true,
  }}
/>
```

`emitNodeEnvelopes` dispatches `epiphanygraph-node-envelopes` from the viewport for
backdrops that want node-aware effects without owning graph physics.
