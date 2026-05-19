import ELK from "elkjs/lib/elk.bundled.js";
import { layoutWithRustSolver } from "./solver-wasm";
import type {
  EpiphanyGraph,
  EpiphanyGraphEdge,
  EpiphanyGraphLink,
  EpiphanyGraphsState,
  EpiphanyGraphLayoutMode,
  EpiphanyGraphLayoutModeConfig,
  GraphKey,
  GraphLayout,
  PositionedEdge,
  PositionedNode,
  PositionedPoint,
} from "./types";

const elk = new ELK();

type ElkSection = {
  startPoint?: { x: number; y: number };
  endPoint?: { x: number; y: number };
  bendPoints?: Array<{ x: number; y: number }>;
};

type ElkLayoutNode = {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

type ElkLayoutEdge = {
  id?: string;
  sections?: ElkSection[];
};

type ElkLayoutGraph = {
  width?: number;
  height?: number;
  children?: ElkLayoutNode[];
  edges?: ElkLayoutEdge[];
};

type LayoutViewport = {
  width: number;
  height: number;
};

export async function layoutEpiphanyGraphs(
  state: EpiphanyGraphsState,
  mode: EpiphanyGraphLayoutModeConfig = "layered",
  viewport?: LayoutViewport,
): Promise<Record<GraphKey, GraphLayout>> {
  const [architecture, dataflow] = await Promise.all([
    layoutGraph("architecture", state.architecture, state.links, layoutModeFor("architecture", mode), viewport),
    layoutGraph("dataflow", state.dataflow, state.links, layoutModeFor("dataflow", mode), viewport),
  ]);

  return { architecture, dataflow };
}

async function layoutGraph(
  graphKey: GraphKey,
  graph: EpiphanyGraph,
  links: EpiphanyGraphLink[],
  mode: EpiphanyGraphLayoutMode = "layered",
  viewport?: LayoutViewport,
): Promise<GraphLayout> {
  try {
    return await layoutGraphWithRustSolver(graphKey, graph, links, mode, viewport);
  } catch (error) {
    console.warn("Epiphany Rust graph solver failed; falling back to ELK.", error);
  }

  return layoutGraphWithElk(graphKey, graph, links, mode, viewport);
}

async function layoutGraphWithElk(
  graphKey: GraphKey,
  graph: EpiphanyGraph,
  links: EpiphanyGraphLink[],
  mode: EpiphanyGraphLayoutMode = "layered",
  viewport?: LayoutViewport,
): Promise<GraphLayout> {
  const algorithm = elkAlgorithmForMode(mode);
  const nodeDegrees = buildNodeDegrees(graph);
  const linkCounts = buildLinkCounts(graphKey, links);
  const nodes = graph.nodes.map((node) => {
    const size = estimateNodeSize(node, graphKey, algorithm, graph.nodes.length, viewport);
    return {
      id: node.id,
      width: size.width,
      height: size.height,
      labels: [{ text: node.title }],
    };
  });
  const edges = graph.edges.map((edge, index) => ({
    id: resolveEdgeId(edge, index),
    sources: [edge.source_id],
    targets: [edge.target_id],
  }));

  const elkGraph = {
    id: graphKey,
    layoutOptions: {
      "elk.algorithm": algorithm,
      ...layoutOptionsFor(graphKey, algorithm),
    },
    children: nodes,
    edges,
  };

  const layout = (await elk.layout(elkGraph)) as ElkLayoutGraph;
  const childLookup = new Map((layout.children ?? []).map((child) => [child.id, child]));

  const positionedNodes: PositionedNode[] = graph.nodes.map((node) => {
    const child = childLookup.get(node.id);
    const degree = nodeDegrees.get(node.id) ?? 0;
    const linkCount = linkCounts.get(node.id) ?? 0;
    return {
      ...node,
      code_refs: node.code_refs ?? [],
      graphKey,
      x: child?.x ?? 0,
      y: child?.y ?? 0,
      width: child?.width ?? estimateNodeSize(node, graphKey, algorithm, graph.nodes.length, viewport).width,
      height: child?.height ?? estimateNodeSize(node, graphKey, algorithm, graph.nodes.length, viewport).height,
      degree,
      linkCount,
      badgeText: nodeBadgeText(node.title),
      fill: nodeFill(graphKey, node.status),
      stroke: nodeStroke(graphKey, node.status),
    };
  });
  const separatedNodes = normalizeNodeBounds(resizeNodesForSeparation(positionedNodes, algorithm));

  const layoutEdgeLookup = new Map((layout.edges ?? []).map((edge, index) => [edge.id ?? `edge-${graphKey}-${index}`, edge]));
  const nodeLookup = new Map(separatedNodes.map((node) => [node.id, node]));
  const positionedEdges: PositionedEdge[] = graph.edges.map((source, index) => {
    const resolvedId = resolveEdgeId(source, index);
    const layoutEdge = layoutEdgeLookup.get(resolvedId);
    const points = isCompactAlgorithm(algorithm) ? [] : edgeSectionsToPoints(layoutEdge?.sections ?? []);
    const fallbackPoints = points.length > 0 ? points : straightEdgePoints(source, nodeLookup);
    return {
      ...source,
      id: source.id ?? null,
      label: source.label ?? null,
      mechanism: source.mechanism ?? null,
      code_refs: source.code_refs ?? [],
      graphKey,
      resolvedId,
      points: fallbackPoints,
      path: pointsToPath(fallbackPoints),
      midpoint: edgeMidpoint(fallbackPoints),
    };
  });

  return {
    graphKey,
    width: Math.max(720, layoutBounds(separatedNodes).width, layout.width ?? 720),
    height: Math.max(520, layoutBounds(separatedNodes).height, layout.height ?? 520),
    nodes: separatedNodes,
    edges: positionedEdges,
  };
}

async function layoutGraphWithRustSolver(
  graphKey: GraphKey,
  graph: EpiphanyGraph,
  links: EpiphanyGraphLink[],
  mode: EpiphanyGraphLayoutMode,
  viewport?: LayoutViewport,
): Promise<GraphLayout> {
  const sizingAlgorithm = sizingAlgorithmForMode(mode);
  const nodeDegrees = buildNodeDegrees(graph);
  const linkCounts = buildLinkCounts(graphKey, links);
  const nodeIndex = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const sizes = graph.nodes.map((node) =>
    estimateNodeSize(node, graphKey, sizingAlgorithm, graph.nodes.length, viewport)
  );
  const edgePairs: number[] = [];
  for (const edge of graph.edges) {
    const source = nodeIndex.get(edge.source_id);
    const target = nodeIndex.get(edge.target_id);
    if (source == null || target == null) {
      continue;
    }
    edgePairs.push(source, target);
  }

  const coordinates = await layoutWithRustSolver({
    nodeWeights: new Float32Array(
      graph.nodes.map((node, index) => {
        const degree = nodeDegrees.get(node.id) ?? 0;
        const linkCount = linkCounts.get(node.id) ?? 0;
        return Math.max(0.25, 1 + degree * 0.16 + linkCount * 0.24 + (sizes[index].width * sizes[index].height) / 80_000);
      }),
    ),
    edgePairs: new Uint32Array(edgePairs),
    ...rustSolverConfigFor(graphKey, mode),
  });

  const positionedNodes: PositionedNode[] = graph.nodes.map((node, index) => {
    const size = sizes[index];
    const degree = nodeDegrees.get(node.id) ?? 0;
    const linkCount = linkCounts.get(node.id) ?? 0;
    const offset = index * 4;
    return {
      ...node,
      code_refs: node.code_refs ?? [],
      graphKey,
      x: coordinates[offset] - size.width / 2,
      y: coordinates[offset + 1] - size.height / 2,
      width: size.width,
      height: size.height,
      degree,
      linkCount,
      badgeText: nodeBadgeText(node.title),
      fill: nodeFill(graphKey, node.status),
      stroke: nodeStroke(graphKey, node.status),
    };
  });
  const separatedNodes = normalizeNodeBounds(resizeNodesForSeparation(positionedNodes, sizingAlgorithm));
  const nodeLookup = new Map(separatedNodes.map((node) => [node.id, node]));
  const positionedEdges: PositionedEdge[] = graph.edges.map((source, index) => {
    const resolvedId = resolveEdgeId(source, index);
    const fallbackPoints = straightEdgePoints(source, nodeLookup);
    return {
      ...source,
      id: source.id ?? null,
      label: source.label ?? null,
      mechanism: source.mechanism ?? null,
      code_refs: source.code_refs ?? [],
      graphKey,
      resolvedId,
      points: fallbackPoints,
      path: pointsToPath(fallbackPoints),
      midpoint: edgeMidpoint(fallbackPoints),
    };
  });

  const bounds = layoutBounds(separatedNodes);
  return {
    graphKey,
    width: Math.max(720, bounds.width),
    height: Math.max(520, bounds.height),
    nodes: separatedNodes,
    edges: positionedEdges,
  };
}

function layoutModeFor(
  graphKey: GraphKey,
  mode: EpiphanyGraphLayoutModeConfig,
): EpiphanyGraphLayoutMode {
  if (typeof mode === "string") {
    return mode;
  }

  return mode[graphKey] ?? "layered";
}

function elkAlgorithmForMode(mode: EpiphanyGraphLayoutMode) {
  if (mode === "stress" || mode === "combined-force") {
    return "org.eclipse.elk.stress";
  }

  if (mode === "force") {
    return "org.eclipse.elk.force";
  }

  return "org.eclipse.elk.layered";
}

function sizingAlgorithmForMode(mode: EpiphanyGraphLayoutMode) {
  return mode === "layered" ? "org.eclipse.elk.layered" : "org.eclipse.elk.stress";
}

function rustSolverConfigFor(graphKey: GraphKey, mode: EpiphanyGraphLayoutMode) {
  if (mode === "layered") {
    return {
      iterations: graphKey === "architecture" ? 320 : 300,
      rankGap: graphKey === "architecture" ? 170 : 150,
      nodeGap: graphKey === "architecture" ? 96 : 112,
      edgeLength: graphKey === "architecture" ? 150 : 180,
    };
  }

  if (mode === "force") {
    return {
      iterations: graphKey === "architecture" ? 520 : 420,
      rankGap: graphKey === "architecture" ? 130 : 120,
      nodeGap: graphKey === "architecture" ? 92 : 112,
      edgeLength: graphKey === "architecture" ? 190 : 230,
    };
  }

  return {
    iterations: graphKey === "architecture" ? 380 : 320,
    rankGap: graphKey === "architecture" ? 145 : 132,
    nodeGap: graphKey === "architecture" ? 92 : 116,
    edgeLength: graphKey === "architecture" ? 180 : 220,
  };
}

function normalizeNodeBounds(nodes: PositionedNode[]): PositionedNode[] {
  const bounds = layoutBounds(nodes);
  if (bounds.minX >= 0 && bounds.minY >= 0) {
    return nodes;
  }

  const offsetX = bounds.minX < 0 ? -bounds.minX + 24 : 0;
  const offsetY = bounds.minY < 0 ? -bounds.minY + 24 : 0;
  return nodes.map((node) => ({
    ...node,
    x: node.x + offsetX,
    y: node.y + offsetY,
  }));
}

function layoutBounds(nodes: PositionedNode[]) {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, width: 0, height: 0 };
  }

  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  return {
    minX,
    minY,
    width: maxX - Math.min(0, minX) + 48,
    height: maxY - Math.min(0, minY) + 48,
  };
}

function resizeNodesForSeparation(nodes: PositionedNode[], algorithm: string): PositionedNode[] {
  if (!isCompactAlgorithm(algorithm) || nodes.length < 2) {
    return nodes;
  }

  const nearestDistances = nodes
    .map((node, nodeIndex) => {
      const center = nodeCenter(node);
      let nearest = Number.POSITIVE_INFINITY;

      for (let otherIndex = 0; otherIndex < nodes.length; otherIndex += 1) {
        if (otherIndex === nodeIndex) {
          continue;
        }

        const other = nodeCenter(nodes[otherIndex]);
        const distance = Math.hypot(other.x - center.x, other.y - center.y);
        if (Number.isFinite(distance) && distance > 1) {
          nearest = Math.min(nearest, distance);
        }
      }

      return nearest;
    })
    .filter((distance) => Number.isFinite(distance))
    .sort((left, right) => left - right);

  if (nearestDistances.length === 0) {
    return nodes;
  }

  const separationSampleIndex = Math.min(
    nearestDistances.length - 1,
    Math.max(0, Math.floor(nearestDistances.length * 0.18)),
  );
  const workingSeparation = nearestDistances[separationSampleIndex];
  const targetWidth = clamp(workingSeparation * 0.88, 112, 260);
  const targetHeight = clamp(workingSeparation * 0.48, 56, 126);

  const resizedNodes = nodes.map((node) => {
    const center = nodeCenter(node);
    const width = clamp(targetWidth, 96, Math.max(260, node.width));
    const height = clamp(targetHeight, 48, Math.max(126, node.height));

    return {
      ...node,
      x: center.x - width / 2,
      y: center.y - height / 2,
      width,
      height,
    };
  });

  return relaxOverlappingNodes(resizedNodes);
}

function relaxOverlappingNodes(nodes: PositionedNode[]): PositionedNode[] {
  let relaxedNodes = nodes;

  for (let pass = 0; pass < 16; pass += 1) {
    let moved = false;
    const offsets = new Map<string, { x: number; y: number }>(
      relaxedNodes.map((node) => [node.id, { x: 0, y: 0 }]),
    );

    for (let leftIndex = 0; leftIndex < relaxedNodes.length; leftIndex += 1) {
      const left = relaxedNodes[leftIndex];
      const leftCenter = nodeCenter(left);

      for (let rightIndex = leftIndex + 1; rightIndex < relaxedNodes.length; rightIndex += 1) {
        const right = relaxedNodes[rightIndex];
        const rightCenter = nodeCenter(right);
        const overlapX = (left.width + right.width) / 2 + 18 - Math.abs(rightCenter.x - leftCenter.x);
        const overlapY = (left.height + right.height) / 2 + 14 - Math.abs(rightCenter.y - leftCenter.y);

        if (overlapX <= 0 || overlapY <= 0) {
          continue;
        }

        const pushAxis = overlapX < overlapY ? "x" : "y";
        const leftOffset = offsets.get(left.id);
        const rightOffset = offsets.get(right.id);
        if (!leftOffset || !rightOffset) {
          continue;
        }

        if (pushAxis === "x") {
          const direction = rightCenter.x >= leftCenter.x ? 1 : -1;
          const push = overlapX / 2;
          leftOffset.x -= direction * push;
          rightOffset.x += direction * push;
        } else {
          const direction = rightCenter.y >= leftCenter.y ? 1 : -1;
          const push = overlapY / 2;
          leftOffset.y -= direction * push;
          rightOffset.y += direction * push;
        }
        moved = true;
      }
    }

    if (!moved) {
      return relaxedNodes;
    }

    relaxedNodes = relaxedNodes.map((node) => {
      const offset = offsets.get(node.id);
      if (!offset) {
        return node;
      }

      return {
        ...node,
        x: node.x + offset.x,
        y: node.y + offset.y,
      };
    });
  }

  return relaxedNodes;
}

function isCompactAlgorithm(algorithm: string) {
  return algorithm === "org.eclipse.elk.stress" || algorithm === "org.eclipse.elk.force";
}

function nodeCenter(node: { x: number; y: number; width: number; height: number }) {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
  };
}

function layoutOptionsFor(graphKey: GraphKey, algorithm: string): Record<string, string> {
  if (algorithm === "org.eclipse.elk.stress") {
    return {
      "elk.padding": "[top=96,left=96,bottom=96,right=96]",
      "elk.spacing.nodeNode": graphKey === "architecture" ? "96" : "128",
      "elk.stress.desiredEdgeLength": graphKey === "architecture" ? "260" : "340",
      "elk.stress.iterationLimit": graphKey === "architecture" ? "240" : "180",
      "elk.stress.epsilon": "0.0001",
    };
  }

  if (algorithm === "org.eclipse.elk.force") {
    return {
      "elk.padding": "[top=96,left=96,bottom=96,right=96]",
      "elk.spacing.nodeNode": graphKey === "architecture" ? "96" : "132",
      "elk.force.model": "FRUCHTERMAN_REINGOLD",
      "elk.force.iterations": graphKey === "architecture" ? "650" : "360",
      "elk.force.repulsion": graphKey === "architecture" ? "72" : "120",
      "elk.force.temperature": "0.1",
      "elk.randomSeed": "17",
    };
  }

  return graphKey === "architecture"
    ? {
        "elk.direction": "DOWN",
        "elk.edgeRouting": "SPLINES",
        "elk.spacing.nodeNode": "48",
        "elk.layered.spacing.nodeNodeBetweenLayers": "88",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.padding": "[top=40,left=40,bottom=40,right=40]",
      }
    : {
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "SPLINES",
        "elk.spacing.nodeNode": "88",
        "elk.layered.spacing.nodeNodeBetweenLayers": "176",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.unnecessaryBendpoints": "true",
        "elk.padding": "[top=72,left=84,bottom=72,right=96]",
      };
}

function buildNodeDegrees(graph: EpiphanyGraph) {
  const degrees = new Map<string, number>();
  for (const node of graph.nodes ?? []) {
    degrees.set(node.id, 0);
  }
  for (const edge of graph.edges ?? []) {
    degrees.set(edge.source_id, (degrees.get(edge.source_id) ?? 0) + 1);
    degrees.set(edge.target_id, (degrees.get(edge.target_id) ?? 0) + 1);
  }
  return degrees;
}

function buildLinkCounts(graphKey: GraphKey, links: EpiphanyGraphLink[]) {
  const counts = new Map<string, number>();
  for (const link of links ?? []) {
    const nodeId =
      graphKey === "architecture" ? link.architecture_node_id : link.dataflow_node_id;
    counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
  }
  return counts;
}

function resolveEdgeId(edge: EpiphanyGraphEdge, index: number) {
  return edge.id?.trim() ? edge.id : `${edge.source_id}->${edge.target_id}:${edge.kind}:${index}`;
}

function estimateNodeSize(
  node: { title: string; purpose: string; mechanism?: string | null; metaphor?: string | null },
  graphKey: GraphKey,
  algorithm: string,
  nodeCount: number,
  viewport?: LayoutViewport,
) {
  const compact = algorithm === "org.eclipse.elk.stress" || algorithm === "org.eclipse.elk.force";
  const densityScale = compact ? graphDensityScale(nodeCount, viewport) : 1;
  const titleWeight = Math.min(node.title.length, 36);
  const purposeWeight = Math.min(node.purpose.length, 110);
  const widthFloor = graphKey === "architecture" ? 232 : 248;
  const compactWidthFloor = graphKey === "architecture" ? 128 : 154;
  const compactWidthCeiling = graphKey === "architecture" ? 248 : 280;
  const layeredWidth = clamp(widthFloor + titleWeight * 2.3 + purposeWeight * 0.22, widthFloor, 360);
  const compactWidth = clamp(
    (compactWidthFloor + titleWeight * 1.8 + purposeWeight * 0.12) * densityScale,
    compactWidthFloor,
    compactWidthCeiling,
  );
  const width = compact ? compactWidth : layeredWidth;
  const titleChars = estimateCharacterCapacity(
    compact ? width - 44 : width - (node.mechanism?.trim() ? 154 : 92),
    7.4,
  );
  const bodyChars = estimateCharacterCapacity(width - 34, 6.1);
  const titleLines = estimateTextLines(node.title, titleChars, 2);
  const purposeLines = estimateTextLines(node.purpose, bodyChars, compact ? 1 : 3);
  const mechanismLines = node.mechanism?.trim()
    ? estimateTextLines(node.mechanism, bodyChars, compact ? 0 : 2)
    : 0;
  const metaphorLines = node.metaphor?.trim()
    ? estimateTextLines(node.metaphor, bodyChars, compact ? 0 : 2)
    : 0;
  const layeredHeight = clamp(
    54 +
      titleLines * 15 +
      purposeLines * 12.5 +
      mechanismLines * 11.5 +
      metaphorLines * 11.2 +
      32,
    124,
    196,
  );
  const compactHeight = clamp(
    (40 + titleLines * 14 + purposeLines * 11 + 18) * densityScale,
    64,
    graphKey === "architecture" ? 116 : 132,
  );
  const height = compact ? compactHeight : layeredHeight;
  return { width, height };
}

function graphDensityScale(nodeCount: number, viewport?: LayoutViewport) {
  if (!viewport || viewport.width <= 0 || viewport.height <= 0 || nodeCount <= 0) {
    return 0.72;
  }

  const availableArea = viewport.width * viewport.height;
  const nodeSlotArea = availableArea / nodeCount;
  return clamp(Math.sqrt(nodeSlotArea / 34_000), 0.54, 0.92);
}

function estimateTextLines(text: string, maxChars: number, maxLines: number) {
  if (maxLines <= 0) {
    return 0;
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return 0;
  }

  const words = normalized.split(" ");
  let lines = 1;
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    lines += 1;
    current = word;
    if (lines >= maxLines) {
      return maxLines;
    }
  }

  return Math.min(lines, maxLines);
}

function estimateCharacterCapacity(pixelWidth: number, averageCharWidth: number) {
  return Math.max(12, Math.floor(pixelWidth / averageCharWidth));
}

function edgeSectionsToPoints(sections: ElkSection[]) {
  const points: PositionedPoint[] = [];
  for (const section of sections) {
    if (section.startPoint) {
      points.push(section.startPoint);
    }
    for (const bendPoint of section.bendPoints ?? []) {
      points.push(bendPoint);
    }
    if (section.endPoint) {
      points.push(section.endPoint);
    }
  }
  return dedupeSequentialPoints(points);
}

function straightEdgePoints(
  edge: EpiphanyGraphEdge,
  nodes: Map<string, PositionedNode>,
) {
  const source = nodes.get(edge.source_id);
  const target = nodes.get(edge.target_id);

  if (!source || !target) {
    return [];
  }

  return [
    {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    },
    {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
    },
  ];
}

function pointsToPath(points: PositionedPoint[]) {
  if (points.length === 0) {
    return "";
  }
  const [first, ...rest] = points;
  return `M ${fmt(first.x)} ${fmt(first.y)} ${rest
    .map((point) => `L ${fmt(point.x)} ${fmt(point.y)}`)
    .join(" ")}`;
}

function edgeMidpoint(points: PositionedPoint[]) {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  const midIndex = Math.floor(points.length / 2);
  return points[midIndex];
}

function dedupeSequentialPoints(points: PositionedPoint[]) {
  const deduped: PositionedPoint[] = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (!previous || previous.x !== point.x || previous.y !== point.y) {
      deduped.push(point);
    }
  }
  return deduped;
}

function nodeBadgeText(title: string) {
  const words = title.split(/[\s/_-]+/).filter(Boolean);
  if (words.length === 0) {
    return "??";
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}

function nodeFill(graphKey: GraphKey, status?: string | null) {
  if (status === "verified") {
    return graphKey === "architecture" ? "rgba(15, 118, 110, 0.28)" : "rgba(120, 53, 15, 0.3)";
  }
  if (status === "active") {
    return "rgba(67, 56, 202, 0.3)";
  }
  if (status === "prototype") {
    return "rgba(91, 33, 182, 0.28)";
  }
  return graphKey === "architecture" ? "rgba(8, 47, 73, 0.66)" : "rgba(58, 12, 33, 0.68)";
}

function nodeStroke(graphKey: GraphKey, status?: string | null) {
  if (status === "verified") {
    return "#5eead4";
  }
  if (status === "in_progress") {
    return "#fbbf24";
  }
  if (status === "active") {
    return "#93c5fd";
  }
  if (status === "prototype") {
    return "#c084fc";
  }
  if (status === "proposed") {
    return "#f9a8d4";
  }
  return graphKey === "architecture" ? "#67e8f9" : "#fb7185";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function fmt(value: number) {
  return Number(value).toFixed(2).replace(/\.00$/, "");
}
