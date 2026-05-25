# Norn Agent Instructions

## Project Purpose

Norn is the graph-sight organ for Epiphany-style typed state.

The live product surface is the React viewer in `web/norn-viewer`: it renders
architecture graphs, dataflow graphs, and typed cross-links with layout, motion,
selection, inspection, and coarse app integration controls. The older .NET
generator and MCP server remain useful support tools for Obsidian note exports,
legacy inspection, benchmark fixtures, and static SVG/JSON output.

Do not make consumers choose between engines. The viewer owns the client
experience; support tools feed artifacts and evidence.

## Local Doctrine

- Coherence beats velocity. Before adding viewer state, runtime plumbing, cache
  surfaces, layout heuristics, or compatibility glue, name the authority it
  serves and the invariant it protects.
- Norn is an inspection tool, not a shrine to every intermediate coordinate.
  Expose graph truth, selection, links, and readable diagnostics; keep engine
  furniture out of the public API unless it earns a stable contract.
- The Rust solver is the layout authority for realtime viewer force modes. If
  the solver fails, fail loudly. Do not add a shadow layout engine that quietly
  invents a second truth.
- Benchmarks are evidence, not decoration. A graph render that looks impressive
  but does not improve graph-truth recovery is wallpaper with arrows.
- Keep public prose dry, direct, and slightly feral. Keep technical discussion
  plain enough that the next agent can still find the wrench.

## Canonical State

- Treat `state/map.yaml` as the canonical machine-map: slow, distilled, and
  worthy of rehydration.
- Treat `state/scratch.md` as disposable working memory for one bounded task.
  It is a bench, not a reliquary.
- Treat `notes/fresh-workspace-handoff.md` as the current re-entry packet for a
  future session. Keep it short and current.
- Add durable evidence only when it changes what the next agent should believe.
  Routine activity belongs in git history, benchmark artifacts, smoke logs, or
  concise handoff notes.

Update `state/map.yaml` when project understanding changes. Do not turn it into
a diary. If a fact is only true for this afternoon, it probably belongs in
scratch or the handoff.

## Important Paths

- Project root: `E:\Projects\Norn`
- Canonical map: `E:\Projects\Norn\state\map.yaml`
- Scratch: `E:\Projects\Norn\state\scratch.md`
- Handoff: `E:\Projects\Norn\notes\fresh-workspace-handoff.md`
- React viewer package: `E:\Projects\Norn\web\norn-viewer`
- Legacy .NET generator / MCP server: `E:\Projects\Norn\Program.cs`
- Rich SVG renderer: `E:\Projects\Norn\RichSvgRenderer.cs`
- Benchmark docs: `E:\Projects\Norn\benchmarks\README.md`
- Rust solver source lineage: `E:\Projects\norn-rs`

## Session Bootstrap

On fresh awakening, read these first:

1. `state/map.yaml`
2. `notes/fresh-workspace-handoff.md`
3. `README.md`
4. `web/norn-viewer/README.md` when touching the React viewer
5. `benchmarks/README.md` when touching benchmark or visual-quality claims

Then run the smallest useful status check:

```powershell
git status --short --branch
```

Restate the active objective and the relevant invariant before substantial
implementation. If the user only asked to rehydrate or reorient, stop after
orientation and wait for explicit continuation.

## Useful Commands

React viewer:

```powershell
cd E:\Projects\Norn\web\norn-viewer
npm install
npm run typecheck
npm run build
npm run dev
```

Rust solver WASM bundle:

```powershell
cd E:\Projects\Norn\web\norn-viewer
npm run build:solver:wasm
```

Realtime benchmark baselines:

```powershell
cd E:\Projects\Norn\web\norn-viewer
npm run tune:simulation
npm run profile:solver
```

Legacy generator / MCP tool:

```powershell
dotnet run --project E:\Projects\Norn -- --help
dotnet run --project E:\Projects\Norn -- --mcp
dotnet pack E:\Projects\Norn -c Release -o E:\Projects\Norn\nupkg
```

## Verification Guardrails

- For React viewer changes, prefer `npm run typecheck` plus `npm run build`.
- For layout, motion, performance, or solver changes, run the relevant realtime
  benchmark script and compare the generated baseline artifacts.
- For static generator or MCP changes, run a focused `dotnet run` invocation
  against a known vault fixture when available, or at least `dotnet build`.
- For visual behavior changes, inspect the actual rendered viewer or generated
  SVG/PNG. State traces alone do not prove a visual invariant.
- Do not claim a layout or realtime heuristic improved unless a benchmark,
  screenshot, or direct visible probe supports it.

## Operating Discipline

- Prefer small, intentional commits over leaving persistent-state or interface
  changes loose in the worktree.
- Preserve the live split: React viewer is the primary client; .NET generator is
  support tooling; Rust solver is layout authority.
- When a compatibility layer survives, document the contract it protects. If the
  sentence is awkward, the layer is probably lying.
- Keep maps and docs aligned with the live machine. Historical scars belong in
  changelogs, rejected-path notes, or benchmark evidence only when they guide
  future decisions.
