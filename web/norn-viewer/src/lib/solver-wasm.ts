import { nornGraphSolverWasmBase64 } from "./solver-wasm-bytes";

type SolverExports = {
  memory: WebAssembly.Memory;
  norn_graph_alloc_f32: (count: number) => number;
  norn_graph_dealloc_f32: (ptr: number, count: number) => void;
  norn_graph_alloc_u32: (count: number) => number;
  norn_graph_dealloc_u32: (ptr: number, count: number) => void;
  norn_graph_layout_2d: (
    nodeWeightsPtr: number,
    nodeCount: number,
    edgePairsPtr: number,
    edgeCount: number,
    outputPtr: number,
    iterations: number,
    rankGap: number,
    nodeGap: number,
    edgeLength: number,
  ) => number;
};

export type RustGraphLayoutInput = {
  nodeWeights: Float32Array;
  edgePairs: Uint32Array;
  iterations: number;
  rankGap: number;
  nodeGap: number;
  edgeLength: number;
};

let solverPromise: Promise<SolverExports> | null = null;

export async function layoutWithRustSolver(input: RustGraphLayoutInput): Promise<Float32Array> {
  const solver = await loadSolver();
  const nodeCount = input.nodeWeights.length;
  const edgeCount = input.edgePairs.length / 2;
  const nodeWeightsPtr = solver.norn_graph_alloc_f32(nodeCount);
  const edgePairsPtr = solver.norn_graph_alloc_u32(input.edgePairs.length);
  const outputPtr = solver.norn_graph_alloc_f32(nodeCount * 4);

  try {
    new Float32Array(solver.memory.buffer, nodeWeightsPtr, nodeCount).set(input.nodeWeights);
    new Uint32Array(solver.memory.buffer, edgePairsPtr, input.edgePairs.length).set(input.edgePairs);
    const status = solver.norn_graph_layout_2d(
      nodeWeightsPtr,
      nodeCount,
      edgePairsPtr,
      edgeCount,
      outputPtr,
      input.iterations,
      input.rankGap,
      input.nodeGap,
      input.edgeLength,
    );
    if (status !== 0) {
      throw new Error(`Rust graph solver failed with status ${status}`);
    }

    return new Float32Array(
      new Float32Array(solver.memory.buffer, outputPtr, nodeCount * 4),
    );
  } finally {
    solver.norn_graph_dealloc_f32(nodeWeightsPtr, nodeCount);
    solver.norn_graph_dealloc_u32(edgePairsPtr, input.edgePairs.length);
    solver.norn_graph_dealloc_f32(outputPtr, nodeCount * 4);
  }
}

async function loadSolver(): Promise<SolverExports> {
  solverPromise ??= WebAssembly.instantiate(wasmBytes(), {}).then((result) => {
    const exports = result.instance.exports as Partial<SolverExports>;
    if (
      !(exports.memory instanceof WebAssembly.Memory) ||
      typeof exports.norn_graph_alloc_f32 !== "function" ||
      typeof exports.norn_graph_dealloc_f32 !== "function" ||
      typeof exports.norn_graph_alloc_u32 !== "function" ||
      typeof exports.norn_graph_dealloc_u32 !== "function" ||
      typeof exports.norn_graph_layout_2d !== "function"
    ) {
      throw new Error("Rust graph solver wasm is missing required exports.");
    }

    return exports as SolverExports;
  });

  return solverPromise;
}

function wasmBytes() {
  const maybeBuffer = (globalThis as { Buffer?: { from: (value: string, encoding: "base64") => { toString: (encoding: "binary") => string } } }).Buffer;
  const binary =
    typeof atob === "function"
      ? atob(nornGraphSolverWasmBase64)
      : maybeBuffer?.from(nornGraphSolverWasmBase64, "base64").toString("binary");
  if (!binary) {
    throw new Error("No base64 decoder is available for the Rust graph solver wasm.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
