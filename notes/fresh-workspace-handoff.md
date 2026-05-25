# Fresh Workspace Handoff

## Current Status

Norn has been initialized with Epiphany-style persistent state surfaces:

- `AGENTS.md` defines the local operating contract.
- `state/map.yaml` is the canonical slow machine-map.
- `state/scratch.md` is disposable working memory.
- this handoff is the short re-entry packet.

No active implementation task is in flight.

## Next Sensible Move

When a new task starts, rehydrate from `state/map.yaml`, then choose the narrowest
surface that owns the requested behavior:

- React viewer work starts in `web/norn-viewer`.
- Static export or MCP work starts in the root .NET project.
- Visual-quality claims should pass through the benchmark harness or direct
  rendered inspection.

## Verification Notes

This pass only added repo state/docs. No application runtime behavior changed.
