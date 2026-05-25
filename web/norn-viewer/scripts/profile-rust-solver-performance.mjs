import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const packageRoot = path.resolve(import.meta.dirname, "..");
const wasmBytesPath = path.join(packageRoot, "src", "lib", "solver-wasm-bytes.ts");
const outputDir = path.join(repoRoot, "benchmarks", "realtime");
const outputJsonPath = path.join(outputDir, "rust-solver-performance-baseline.json");
const outputCsvPath = path.join(outputDir, "rust-solver-performance-baseline.csv");
const latencySvgPath = path.join(outputDir, "rust-solver-latency.svg");
const convergenceSvgPath = path.join(outputDir, "rust-solver-convergence.svg");

const solver = await loadSolver();

const graphSizes = [24, 64, 128, 256, 512, 1024];
const graphFamilies = [
  "chain",
  "layered-dag",
  "binary-tree",
  "hub-spoke",
  "clustered-modules",
];
const latencyWindowsMs = [1.5, 3, 6, 12];
const parameterProfiles = [
  { id: "fast-flat", rankGap: 96, nodeGap: 76, edgeLength: 130 },
  { id: "balanced-hierarchy", rankGap: 136, nodeGap: 92, edgeLength: 170 },
  { id: "quality-spacious", rankGap: 180, nodeGap: 118, edgeLength: 230 },
];
const iterationBudgets = [32, 96, 224];

const run = {
  generatedAtUtc: new Date().toISOString(),
  description:
    "Smoke baseline for the Rust WASM graph solver used by the React viewer. Measures graph family, size, latency-window, meta-heuristic parameter, and convergence tradeoffs.",
  method: {
    graphSizes,
    graphFamilies,
    latencyWindowsMs,
    parameterProfiles,
    iterationBudgets,
    samplesPerCandidate: 1,
    warmupRuns: 0,
    reference: "quality-spacious parameters at a size-capped high iteration count",
    loss:
      "Normalized RMS node displacement from the reference layout after aligning centroids. Lower is closer to the high-iteration solver result.",
  },
  rows: [],
  latencyWindowFrontier: [],
  summary: {},
};

for (const family of graphFamilies) {
  for (const nodeCount of graphSizes) {
    const graph = buildGraph(family, nodeCount);
    const referenceIterations = nodeCount <= 256 ? 360 : nodeCount <= 512 ? 280 : 220;
    const reference = layoutGraph(graph, {
      ...parameterProfiles[2],
      iterations: referenceIterations,
    });

    for (const profile of parameterProfiles) {
      for (const iterations of iterationBudgets) {
        const candidate = measureCandidate(graph, {
          ...profile,
          iterations,
        });
        run.rows.push({
          family,
          nodeCount,
          edgeCount: graph.edgePairs.length / 2,
          profileId: profile.id,
          iterations,
          rankGap: profile.rankGap,
          nodeGap: profile.nodeGap,
          edgeLength: profile.edgeLength,
          latencyMs: round(candidate.latencyMs),
          p95LatencyMs: round(candidate.p95LatencyMs),
          loss: round(layoutLoss(candidate.coordinates, reference.coordinates)),
          edgeStress: round(edgeStress(graph, candidate.coordinates, profile.edgeLength)),
          referenceIterations,
        });
      }
    }
  }
}

for (const family of graphFamilies) {
  for (const nodeCount of graphSizes) {
    const rows = run.rows.filter((row) => row.family === family && row.nodeCount === nodeCount);
    for (const budgetMs of latencyWindowsMs) {
      const eligible = rows
        .filter((row) => row.p95LatencyMs <= budgetMs)
        .sort((left, right) => left.loss - right.loss || left.p95LatencyMs - right.p95LatencyMs);
      const fallback = rows
        .slice()
        .sort((left, right) => left.p95LatencyMs - right.p95LatencyMs || left.loss - right.loss);
      const best = eligible[0] ?? fallback[0];
      run.latencyWindowFrontier.push({
        family,
        nodeCount,
        budgetMs,
        metBudget: Boolean(eligible[0]),
        profileId: best.profileId,
        iterations: best.iterations,
        p95LatencyMs: best.p95LatencyMs,
        loss: best.loss,
      });
    }
  }
}

run.summary = summarize(run.rows, run.latencyWindowFrontier);

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(`${outputJsonPath}.tmp`, `${JSON.stringify(run, null, 2)}\n`);
await fs.rename(`${outputJsonPath}.tmp`, outputJsonPath);
await fs.writeFile(`${outputCsvPath}.tmp`, csvRows(run.rows));
await fs.rename(`${outputCsvPath}.tmp`, outputCsvPath);
await fs.writeFile(`${latencySvgPath}.tmp`, latencySvg(run.rows));
await fs.rename(`${latencySvgPath}.tmp`, latencySvgPath);
await fs.writeFile(`${convergenceSvgPath}.tmp`, convergenceSvg(run.rows));
await fs.rename(`${convergenceSvgPath}.tmp`, convergenceSvgPath);

console.log(`Wrote ${outputJsonPath}`);
console.log(`Wrote ${outputCsvPath}`);
console.log(`Wrote ${latencySvgPath}`);
console.log(`Wrote ${convergenceSvgPath}`);

async function loadSolver() {
  const source = await fs.readFile(wasmBytesPath, "utf8");
  const match = source.match(/epiphanyGraphSolverWasmBase64\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error(`Could not read embedded solver WASM from ${wasmBytesPath}`);
  }
  const bytes = Buffer.from(match[1], "base64");
  const result = await WebAssembly.instantiate(bytes, {});
  const exports = result.instance.exports;
  for (const name of [
    "memory",
    "epiphany_graph_alloc_f32",
    "epiphany_graph_dealloc_f32",
    "epiphany_graph_alloc_u32",
    "epiphany_graph_dealloc_u32",
    "epiphany_graph_layout_2d",
  ]) {
    if (!(name in exports)) {
      throw new Error(`Rust graph solver wasm is missing ${name}`);
    }
  }
  return exports;
}

function measureCandidate(graph, config) {
  const samples = [];
  let coordinates = null;
  for (let index = 0; index < 1; index += 1) {
    const start = performance.now();
    coordinates = layoutGraph(graph, config).coordinates;
    samples.push(performance.now() - start);
  }

  return {
    coordinates,
    latencyMs: average(samples),
    p95LatencyMs: percentile(samples, 0.95),
  };
}

function layoutGraph(graph, config) {
  const nodeCount = graph.nodeWeights.length;
  const edgeCount = graph.edgePairs.length / 2;
  const nodeWeightsPtr = solver.epiphany_graph_alloc_f32(nodeCount);
  const edgePairsPtr = solver.epiphany_graph_alloc_u32(graph.edgePairs.length);
  const outputPtr = solver.epiphany_graph_alloc_f32(nodeCount * 4);

  try {
    new Float32Array(solver.memory.buffer, nodeWeightsPtr, nodeCount).set(graph.nodeWeights);
    new Uint32Array(solver.memory.buffer, edgePairsPtr, graph.edgePairs.length).set(graph.edgePairs);
    const status = solver.epiphany_graph_layout_2d(
      nodeWeightsPtr,
      nodeCount,
      edgePairsPtr,
      edgeCount,
      outputPtr,
      config.iterations,
      config.rankGap,
      config.nodeGap,
      config.edgeLength,
    );
    if (status !== 0) {
      throw new Error(`Rust graph solver failed with status ${status}`);
    }
    const coordinates = new Float32Array(nodeCount * 2);
    const raw = new Float32Array(solver.memory.buffer, outputPtr, nodeCount * 4);
    for (let index = 0; index < nodeCount; index += 1) {
      coordinates[index * 2] = raw[index * 4];
      coordinates[index * 2 + 1] = raw[index * 4 + 1];
    }
    return { coordinates };
  } finally {
    solver.epiphany_graph_dealloc_f32(nodeWeightsPtr, nodeCount);
    solver.epiphany_graph_dealloc_u32(edgePairsPtr, graph.edgePairs.length);
    solver.epiphany_graph_dealloc_f32(outputPtr, nodeCount * 4);
  }
}

function buildGraph(family, nodeCount) {
  const edges = [];
  if (family === "chain") {
    for (let index = 1; index < nodeCount; index += 1) {
      edges.push(index - 1, index);
    }
  } else if (family === "layered-dag") {
    const width = Math.max(4, Math.round(Math.sqrt(nodeCount)));
    for (let index = 0; index < nodeCount; index += 1) {
      const nextLayer = index + width;
      if (nextLayer < nodeCount) {
        edges.push(index, nextLayer);
      }
      if (index % width !== width - 1 && nextLayer + 1 < nodeCount) {
        edges.push(index, nextLayer + 1);
      }
    }
  } else if (family === "binary-tree") {
    for (let index = 1; index < nodeCount; index += 1) {
      edges.push(Math.floor((index - 1) / 2), index);
    }
  } else if (family === "hub-spoke") {
    const hubs = Math.max(2, Math.floor(Math.sqrt(nodeCount) / 2));
    for (let index = hubs; index < nodeCount; index += 1) {
      edges.push(index % hubs, index);
      if (index + hubs < nodeCount && index % 3 === 0) {
        edges.push(index, index + hubs);
      }
    }
  } else if (family === "clustered-modules") {
    const clusterSize = Math.max(6, Math.round(Math.sqrt(nodeCount)));
    for (let index = 0; index < nodeCount; index += 1) {
      const clusterStart = Math.floor(index / clusterSize) * clusterSize;
      const next = clusterStart + ((index - clusterStart + 1) % clusterSize);
      if (next < nodeCount && next !== index) {
        edges.push(index, next);
      }
      if (index + clusterSize < nodeCount) {
        edges.push(index, index + clusterSize);
      }
    }
  } else {
    throw new Error(`Unknown graph family ${family}`);
  }

  const degrees = new Uint32Array(nodeCount);
  for (let index = 0; index < edges.length; index += 2) {
    degrees[edges[index]] += 1;
    degrees[edges[index + 1]] += 1;
  }

  const nodeWeights = new Float32Array(nodeCount);
  for (let index = 0; index < nodeCount; index += 1) {
    nodeWeights[index] = 1 + degrees[index] * 0.18 + deterministicNoise(family, index) * 0.24;
  }

  return {
    nodeWeights,
    edgePairs: new Uint32Array(edges),
  };
}

function layoutLoss(candidate, reference) {
  const count = candidate.length / 2;
  const candidateCenter = centroid(candidate);
  const referenceCenter = centroid(reference);
  let sum = 0;
  let maxReferenceRadius = 1;

  for (let index = 0; index < count; index += 1) {
    const candidateX = candidate[index * 2] - candidateCenter.x;
    const candidateY = candidate[index * 2 + 1] - candidateCenter.y;
    const referenceX = reference[index * 2] - referenceCenter.x;
    const referenceY = reference[index * 2 + 1] - referenceCenter.y;
    maxReferenceRadius = Math.max(maxReferenceRadius, Math.hypot(referenceX, referenceY));
    sum += (candidateX - referenceX) ** 2 + (candidateY - referenceY) ** 2;
  }

  return Math.sqrt(sum / count) / maxReferenceRadius;
}

function edgeStress(graph, coordinates, targetLength) {
  const stresses = [];
  for (let index = 0; index < graph.edgePairs.length; index += 2) {
    const source = graph.edgePairs[index];
    const target = graph.edgePairs[index + 1];
    const length = Math.hypot(
      coordinates[source * 2] - coordinates[target * 2],
      coordinates[source * 2 + 1] - coordinates[target * 2 + 1],
    );
    stresses.push(Math.abs(length - targetLength) / Math.max(1, targetLength));
  }
  return average(stresses);
}

function summarize(rows, frontier) {
  const bySize = graphSizes.map((nodeCount) => {
    const sizeRows = rows.filter((row) => row.nodeCount === nodeCount);
    return {
      nodeCount,
      bestP95LatencyMs: round(Math.min(...sizeRows.map((row) => row.p95LatencyMs))),
      bestLoss: round(Math.min(...sizeRows.map((row) => row.loss))),
      medianP95LatencyMs: round(percentile(sizeRows.map((row) => row.p95LatencyMs), 0.5)),
    };
  });
  const largestRealtime = [...frontier]
    .filter((row) => row.metBudget)
    .sort((left, right) => right.nodeCount - left.nodeCount || left.budgetMs - right.budgetMs)[0];

  return {
    bySize,
    largestBudgetMeetingRun: largestRealtime ?? null,
    bestOverallLoss: rows.slice().sort((left, right) => left.loss - right.loss)[0],
    fastestOverall: rows.slice().sort((left, right) => left.p95LatencyMs - right.p95LatencyMs)[0],
  };
}

function csvRows(rows) {
  const header = [
    "family",
    "nodeCount",
    "edgeCount",
    "profileId",
    "iterations",
    "rankGap",
    "nodeGap",
    "edgeLength",
    "latencyMs",
    "p95LatencyMs",
    "loss",
    "edgeStress",
    "referenceIterations",
  ];
  return [
    header.join(","),
    ...rows.map((row) => header.map((key) => row[key]).join(",")),
    "",
  ].join("\n");
}

function latencySvg(rows) {
  const fastestBySize = graphSizes.map((nodeCount) => ({
    x: nodeCount,
    y: Math.min(...rows.filter((row) => row.nodeCount === nodeCount).map((row) => row.p95LatencyMs)),
  }));
  return chartSvg({
    title: "Rust Solver P95 Latency By Graph Size",
    xLabel: "nodes",
    yLabel: "p95 ms",
    series: [{ id: "fastest", color: "#22d3ee", points: fastestBySize }],
  });
}

function convergenceSvg(rows) {
  const byIteration = iterationBudgets.map((iterations) => ({
    x: iterations,
    y: average(rows.filter((row) => row.iterations === iterations).map((row) => row.loss)),
  }));
  return chartSvg({
    title: "Rust Solver Convergence Loss By Iterations",
    xLabel: "iterations",
    yLabel: "normalized loss",
    series: [{ id: "average loss", color: "#f472b6", points: byIteration }],
  });
}

function chartSvg({ title, xLabel, yLabel, series }) {
  const width = 920;
  const height = 460;
  const padding = { left: 74, right: 36, top: 58, bottom: 70 };
  const allPoints = series.flatMap((item) => item.points);
  const xMin = Math.min(...allPoints.map((point) => point.x));
  const xMax = Math.max(...allPoints.map((point) => point.x));
  const yMin = 0;
  const yMax = Math.max(0.001, Math.max(...allPoints.map((point) => point.y)) * 1.12);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const sx = (value) => padding.left + ((value - xMin) / Math.max(1, xMax - xMin)) * plotWidth;
  const sy = (value) => padding.top + plotHeight - ((value - yMin) / Math.max(0.001, yMax - yMin)) * plotHeight;
  const paths = series.map((item) => {
    const d = item.points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${sx(point.x).toFixed(2)} ${sy(point.y).toFixed(2)}`)
      .join(" ");
    const circles = item.points
      .map((point) => `<circle cx="${sx(point.x).toFixed(2)}" cy="${sy(point.y).toFixed(2)}" r="4" fill="${item.color}" />`)
      .join("");
    return `<path d="${d}" fill="none" stroke="${item.color}" stroke-width="3" />${circles}`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#071019" />
  <text x="${padding.left}" y="32" fill="#e5eef8" font-family="Arial, sans-serif" font-size="22" font-weight="700">${escapeXml(title)}</text>
  <line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${padding.left + plotWidth}" y2="${padding.top + plotHeight}" stroke="#64748b" />
  <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotHeight}" stroke="#64748b" />
  <text x="${padding.left + plotWidth / 2}" y="${height - 22}" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="14" text-anchor="middle">${escapeXml(xLabel)}</text>
  <text x="22" y="${padding.top + plotHeight / 2}" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="14" text-anchor="middle" transform="rotate(-90 22 ${padding.top + plotHeight / 2})">${escapeXml(yLabel)}</text>
  <text x="${padding.left}" y="${padding.top + plotHeight + 22}" fill="#94a3b8" font-family="Arial, sans-serif" font-size="12">${xMin}</text>
  <text x="${padding.left + plotWidth}" y="${padding.top + plotHeight + 22}" fill="#94a3b8" font-family="Arial, sans-serif" font-size="12" text-anchor="end">${xMax}</text>
  <text x="${padding.left - 10}" y="${padding.top + plotHeight}" fill="#94a3b8" font-family="Arial, sans-serif" font-size="12" text-anchor="end">${round(yMin)}</text>
  <text x="${padding.left - 10}" y="${padding.top + 4}" fill="#94a3b8" font-family="Arial, sans-serif" font-size="12" text-anchor="end">${round(yMax)}</text>
  ${paths}
</svg>
`;
}

function centroid(coordinates) {
  let x = 0;
  let y = 0;
  const count = coordinates.length / 2;
  for (let index = 0; index < count; index += 1) {
    x += coordinates[index * 2];
    y += coordinates[index * 2 + 1];
  }
  return { x: x / count, y: y / count };
}

function deterministicNoise(family, index) {
  let hash = 2166136261;
  for (const char of `${family}:${index}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) {
    return 0;
  }
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function round(value) {
  return Number(value.toFixed(4));
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
