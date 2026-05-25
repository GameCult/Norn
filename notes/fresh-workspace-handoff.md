# Fresh Workspace Handoff

## Current Status

Norn has been initialized with Epiphany-style persistent state surfaces and the
repo identity has been corrected:

- `AGENTS.md` defines the local operating contract.
- `state/map.yaml` is the canonical slow machine-map.
- `state/scratch.md` is disposable working memory.
- this handoff is the short re-entry packet.

Norn is a React/WASM frontend for the Rust hybrid Sugiyama / Kamada-Kawai 2D and
3D graph layout solver. The root C# project is peripheral bridge/export/MCP
machinery. It may be useful, but it is not the throne.

No active implementation task is in flight.

## Next Sensible Move

When a new task starts, rehydrate from `state/map.yaml`, then choose the narrowest
surface that owns the requested behavior:

- React viewer work starts in `web/norn-viewer`.
- Rust solver or algorithm work starts in `E:\Projects\norn-rs`.
- Static export, C# bridge, or MCP work starts in the root .NET project only
  after its bridge contract is named.
- Visual-quality claims should pass through the benchmark harness or direct
  rendered inspection.

## Verification Notes

This persistence correction tracks the full rebrand: the solver root, frontend
wrapper, package consumers, and embed paths should use Norn names.
