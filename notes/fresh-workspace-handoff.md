# Fresh Workspace Handoff

## Current Status

Norn has been initialized with Epiphany-style persistent state surfaces and the
repo identity has been corrected:

- `AGENTS.md` defines the local operating contract.
- `state/map.yaml` is the canonical slow machine-map.
- `state/scratch.md` is disposable working memory.
- this handoff is the short re-entry packet.

Norn is the Rust hybrid Sugiyama / Kamada-Kawai 2D and 3D graph layout solver.
The React/WASM package and root C# project are windows onto that solver:
inspection, bridge, export, and MCP machinery. Useful, but not the throne.

No active implementation task is in flight.

## Next Sensible Move

When a new task starts, rehydrate from `state/map.yaml`, then choose the narrowest
surface that owns the requested behavior:

- Rust solver or algorithm work starts in `crates/norn-rs`.
- React viewer work starts in `web/norn-viewer`.
- Static export, C# bridge, or MCP work starts in the root .NET project only
  after its bridge contract is named.
- Visual-quality claims should pass through the benchmark harness or direct
  rendered inspection.

## Verification Notes

The solver implementation now lives in-repo under `crates/norn-rs`; do not
rehydrate future solver work from an external neighbor repo.
