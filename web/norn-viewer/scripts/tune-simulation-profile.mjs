import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const packageRoot = path.resolve(import.meta.dirname, "..");
const mockStatePath = path.join(packageRoot, "src", "lib", "mock-state.json");
const outputPath = path.join(repoRoot, "benchmarks", "realtime", "simulation-profile-baseline.json");

const state = JSON.parse(await fs.readFile(mockStatePath, "utf8"));

const candidates = [
  {
    id: "quality",
    simulationBudgetMs: 8,
    targetFps: 60,
    maxAnimatedNodes: 5000,
    edgeRefreshRate: 1,
    maxTimeStepMs: 34,
    reduceThreshold: 1.08,
    expandThreshold: 0.55,
    nodeBudgetCutRatio: 0.92,
    nodeBudgetGrowthRatio: 1.16,
    nodeBudgetGrowthAdd: 2,
  },
  {
    id: "balanced",
    simulationBudgetMs: 4,
    targetFps: 40,
    maxAnimatedNodes: 240,
    edgeRefreshRate: 2,
    maxTimeStepMs: 28,
    reduceThreshold: 1.08,
    expandThreshold: 0.55,
    nodeBudgetCutRatio: 0.92,
    nodeBudgetGrowthRatio: 1.16,
    nodeBudgetGrowthAdd: 2,
  },
  {
    id: "fast",
    simulationBudgetMs: 2.5,
    targetFps: 24,
    maxAnimatedNodes: 90,
    edgeRefreshRate: 3,
    maxTimeStepMs: 24,
    reduceThreshold: 1.08,
    expandThreshold: 0.55,
    nodeBudgetCutRatio: 0.92,
    nodeBudgetGrowthRatio: 1.16,
    nodeBudgetGrowthAdd: 2,
  },
];

const corpora = [
  buildCorpus("mock-1x", 1),
  buildCorpus("mock-4x", 4),
  buildCorpus("mock-12x", 12),
];

const run = {
  generatedAtUtc: new Date().toISOString(),
  description:
    "Smoke baseline for React viewer realtime simulation profile. Measures local JS simulation cost/error over synthetic expansions of mock Epiphany state.",
  method: {
    iterations: 180,
    warmupIterations: 30,
    timestepSeconds: 1 / 40,
    groundTruth: "full sample using all nodes and refreshed edges every step",
    score:
      "Candidates are better when they stay under simulationBudgetMs while reducing layout-anchor error and staying close to the full-sample baseline.",
  },
  corpora: [],
  candidates: [],
  recommendation: {},
};

for (const corpus of corpora) {
  const full = runSimulation(corpus, {
    id: "full",
    simulationBudgetMs: Number.POSITIVE_INFINITY,
    targetFps: 60,
    maxAnimatedNodes: Number.POSITIVE_INFINITY,
    edgeRefreshRate: 1,
    maxTimeStepMs: 34,
    reduceThreshold: 1.08,
    expandThreshold: 0.55,
    nodeBudgetCutRatio: 0.92,
    nodeBudgetGrowthRatio: 1.16,
    nodeBudgetGrowthAdd: 2,
  });
  const candidateResults = candidates.map((candidate) => runSimulation(corpus, candidate, full.finalNodes));
  run.corpora.push({
    id: corpus.id,
    nodeCount: corpus.nodes.length,
    edgeCount: corpus.edges.length,
    fullSample: summarizeResult(full),
    candidates: candidateResults.map(summarizeResult),
  });
}

for (const candidate of candidates) {
  const rows = run.corpora.map((corpus) => corpus.candidates.find((entry) => entry.id === candidate.id));
  const budgetHitRate = average(rows.map((row) => row.budgetHitRate));
  const averageCostMs = average(rows.map((row) => row.averageCostMs));
  const baselineError = average(rows.map((row) => row.baselineError));
  const anchorError = average(rows.map((row) => row.anchorError));
  run.candidates.push({
    id: candidate.id,
    budgetHitRate,
    averageCostMs,
    baselineError,
    anchorError,
    profile: candidate,
  });
  run.recommendation[candidate.id] = candidate;
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(`${outputPath}.tmp`, `${JSON.stringify(run, null, 2)}\n`);
await fs.rename(`${outputPath}.tmp`, outputPath);
console.log(`Wrote ${outputPath}`);

function buildCorpus(id, multiplier) {
  const architecture = expandGraph("architecture", state.architecture, multiplier);
  const dataflow = expandGraph("dataflow", state.dataflow, multiplier);
  return {
    id,
    nodes: [...architecture.nodes, ...dataflow.nodes],
    edges: [...architecture.edges, ...dataflow.edges],
  };
}

function expandGraph(graphKey, graph, multiplier) {
  const nodes = [];
  const edges = [];
  for (let copy = 0; copy < multiplier; copy += 1) {
    const suffix = multiplier === 1 ? "" : `-${copy}`;
    for (const node of graph.nodes) {
      nodes.push({
        id: `${graphKey}:${node.id}${suffix}`,
        x: deterministicCoordinate(node.id, copy, 0),
        y: deterministicCoordinate(node.id, copy, 1),
        width: 140 + (node.title.length % 9) * 8,
        height: 72 + (node.purpose.length % 7) * 6,
        degree: 0,
        linkCount: linkCountFor(graphKey, node.id),
      });
    }
    for (const edge of graph.edges) {
      edges.push({
        source_id: `${graphKey}:${edge.source_id}${suffix}`,
        target_id: `${graphKey}:${edge.target_id}${suffix}`,
      });
    }
  }
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    degree.set(edge.source_id, (degree.get(edge.source_id) ?? 0) + 1);
    degree.set(edge.target_id, (degree.get(edge.target_id) ?? 0) + 1);
  }
  return {
    nodes: nodes.map((node) => ({ ...node, degree: degree.get(node.id) ?? 0 })),
    edges,
  };
}

function runSimulation(corpus, candidate, fullNodes = null) {
  const dynamic = new Map(corpus.nodes.map((node) => [node.id, { id: node.id, x: node.x, y: node.y, vx: 0, vy: 0 }]));
  let nodeBudget = Math.min(corpus.nodes.length, candidate.maxAnimatedNodes);
  let edgeRefreshRate = candidate.edgeRefreshRate;
  let averageCostMs = Number.isFinite(candidate.simulationBudgetMs) ? candidate.simulationBudgetMs : 0;
  const costs = [];
  const budgetHits = [];
  const nodeBudgets = [];

  for (let iteration = 0; iteration < 210; iteration += 1) {
    const start = performance.now();
    const selected = selectNodes(corpus.nodes, dynamic, nodeBudget);
    for (const node of selected) {
      stepNode(node, dynamic.get(node.id), 1 / 40, iteration);
    }
    if (iteration % edgeRefreshRate === 0) {
      refreshEdges(corpus.edges, dynamic);
    }
    const costMs = performance.now() - start;

    if (iteration >= 30) {
      costs.push(costMs);
      budgetHits.push(costMs <= candidate.simulationBudgetMs ? 1 : 0);
      nodeBudgets.push(nodeBudget);
    }

    if (Number.isFinite(candidate.simulationBudgetMs)) {
      averageCostMs = averageCostMs * 0.82 + Math.max(0.01, costMs) * 0.18;
      if (averageCostMs > candidate.simulationBudgetMs * candidate.reduceThreshold) {
        const ratio = candidate.simulationBudgetMs / averageCostMs;
        nodeBudget = clampWholeNumber(
          nodeBudget * clamp(ratio * candidate.nodeBudgetCutRatio, 0.35, 0.9),
          1,
          Math.min(corpus.nodes.length, candidate.maxAnimatedNodes),
        );
        edgeRefreshRate = clampWholeNumber(edgeRefreshRate + 1, 1, 12);
      } else if (averageCostMs < candidate.simulationBudgetMs * candidate.expandThreshold) {
        nodeBudget = clampWholeNumber(
          nodeBudget * candidate.nodeBudgetGrowthRatio + candidate.nodeBudgetGrowthAdd,
          1,
          Math.min(corpus.nodes.length, candidate.maxAnimatedNodes),
        );
        if (averageCostMs < candidate.simulationBudgetMs * 0.35) {
          edgeRefreshRate = clampWholeNumber(edgeRefreshRate - 1, 1, 12);
        }
      }
    }
  }

  const finalNodes = new Map([...dynamic.entries()].map(([id, node]) => [id, { ...node }]));
  return {
    id: candidate.id,
    finalNodes,
    averageCostMs: average(costs),
    p95CostMs: percentile(costs, 0.95),
    budgetHitRate: average(budgetHits),
    averageNodeBudget: average(nodeBudgets),
    anchorError: layoutAnchorError(corpus.nodes, finalNodes),
    baselineError: fullNodes ? baselineError(finalNodes, fullNodes) : 0,
  };
}

function summarizeResult(result) {
  return {
    id: result.id,
    averageCostMs: round(result.averageCostMs),
    p95CostMs: round(result.p95CostMs),
    budgetHitRate: round(result.budgetHitRate),
    averageNodeBudget: round(result.averageNodeBudget),
    anchorError: round(result.anchorError),
    baselineError: round(result.baselineError),
  };
}

function selectNodes(nodes, dynamic, count) {
  if (nodes.length <= count) {
    return nodes;
  }
  return [...nodes]
    .sort((left, right) => priority(right, dynamic.get(right.id)) - priority(left, dynamic.get(left.id)))
    .slice(0, count);
}

function priority(node, dynamic) {
  const importance = node.degree * 2 + node.linkCount * 3;
  if (!dynamic) {
    return importance + 1;
  }
  const homeError = Math.hypot(node.x - dynamic.x, node.y - dynamic.y) / Math.max(1, Math.max(node.width, node.height));
  const kineticError = Math.hypot(dynamic.vx, dynamic.vy) / 120;
  return importance + homeError * 6 + kineticError * 4;
}

function stepNode(node, dynamic, dt, iteration) {
  const wave = Math.sin((node.x * 0.003 + node.y * 0.004 + iteration * 0.021) * Math.PI);
  const homeX = node.x - dynamic.x;
  const homeY = node.y - dynamic.y;
  const forceX = homeX * 3.4 + Math.cos(wave) * 58;
  const forceY = homeY * 3.4 + Math.sin(wave) * 58 - Math.max(node.width, node.height) * 0.018;
  dynamic.vx = (dynamic.vx + forceX * dt) * Math.pow(0.82, dt * 60);
  dynamic.vy = (dynamic.vy + forceY * dt) * Math.pow(0.82, dt * 60);
  dynamic.x += dynamic.vx * dt;
  dynamic.y += dynamic.vy * dt;
}

function refreshEdges(edges, dynamic) {
  let total = 0;
  for (const edge of edges) {
    const source = dynamic.get(edge.source_id);
    const target = dynamic.get(edge.target_id);
    if (source && target) {
      total += Math.hypot(source.x - target.x, source.y - target.y);
    }
  }
  return total;
}

function layoutAnchorError(nodes, dynamic) {
  return average(nodes.map((node) => {
    const current = dynamic.get(node.id);
    return current ? Math.hypot(node.x - current.x, node.y - current.y) : 0;
  }));
}

function baselineError(dynamic, baseline) {
  return average([...baseline.entries()].map(([id, target]) => {
    const current = dynamic.get(id);
    return current ? Math.hypot(target.x - current.x, target.y - current.y) : 0;
  }));
}

function linkCountFor(graphKey, nodeId) {
  return state.links.filter((link) =>
    graphKey === "architecture"
      ? link.architecture_node_id === nodeId
      : link.dataflow_node_id === nodeId,
  ).length;
}

function deterministicCoordinate(id, copy, axis) {
  let hash = 2166136261;
  for (const char of `${id}:${copy}:${axis}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 1800 + copy * 46;
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampWholeNumber(value, min, max) {
  return Math.round(clamp(value, min, max));
}

function round(value) {
  return Number(value.toFixed(4));
}
