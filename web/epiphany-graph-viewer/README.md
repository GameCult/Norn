# Epiphany Graph Viewer

Small React component package for browsing Epiphany's durable typed graph state with `elkjs`.

This is the part where the graphs stop being dead export artifacts and start acting like UI:

- `graphs.architecture` and `graphs.dataflow` render as first-class views
- `graphs.links` show cross-graph correspondences instead of vanishing into a sidecar file
- zoom reveals more node detail instead of trying to print the whole phone book at once
- selection opens purpose, mechanism, metaphor, status, and code references in a detail pane

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
  return <EpiphanyGraphViewer state={state} />;
}
```

## Current Shape

- the viewer lays out each graph with `elkjs` on the client
- `architecture` defaults to layered layout
- `dataflow` defaults to a rightward layered layout with wider stage spacing
- links are exposed in the detail pane and through node badges
- zoom gates title, purpose, and metadata visibility

This is a prototype seam for EpiphanyAgent, not a final cathedral. The point is to package the behavior, the contract, and the rendering policy in one place so the upcoming GUI can steal it without ceremony.
