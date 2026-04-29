import ELK from "elkjs/lib/elk.bundled.js";
import type {
  EpiphanyGraph,
  EpiphanyGraphEdge,
  EpiphanyGraphLink,
  EpiphanyGraphsState,
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

export async function layoutEpiphanyGraphs(
  state: EpiphanyGraphsState,
): Promise<Record<GraphKey, GraphLayout>> {
  const [architecture, dataflow] = await Promise.all([
    layoutGraph("architecture", state.architecture, state.links),
    layoutGraph("dataflow", state.dataflow, state.links),
  ]);

  return { architecture, dataflow };
}

async function layoutGraph(
  graphKey: GraphKey,
  graph: EpiphanyGraph,
  links: EpiphanyGraphLink[],
): Promise<GraphLayout> {
  const nodeDegrees = buildNodeDegrees(graph);
  const linkCounts = buildLinkCounts(graphKey, links);
  const nodes = graph.nodes.map((node) => {
    const size = estimateNodeSize(node, graphKey);
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
      "elk.algorithm":
        "org.eclipse.elk.layered",
      ...(graphKey === "architecture"
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
          }),
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
      width: child?.width ?? estimateNodeSize(node, graphKey).width,
      height: child?.height ?? estimateNodeSize(node, graphKey).height,
      degree,
      linkCount,
      badgeText: nodeBadgeText(node.title),
      fill: nodeFill(graphKey, node.status),
      stroke: nodeStroke(graphKey, node.status),
    };
  });

  const edgeLookup = new Map(graph.edges.map((edge, index) => [resolveEdgeId(edge, index), edge]));
  const positionedEdges: PositionedEdge[] = (layout.edges ?? []).map((edge, index) => {
    const resolvedId = edge.id ?? `edge-${graphKey}-${index}`;
    const source = edgeLookup.get(resolvedId) ?? graph.edges[index];
    const points = edgeSectionsToPoints(edge.sections ?? []);
    return {
      ...source,
      id: source.id ?? null,
      label: source.label ?? null,
      mechanism: source.mechanism ?? null,
      code_refs: source.code_refs ?? [],
      graphKey,
      resolvedId,
      points,
      path: pointsToPath(points),
      midpoint: edgeMidpoint(points),
    };
  });

  return {
    graphKey,
    width: Math.max(720, layout.width ?? 720),
    height: Math.max(520, layout.height ?? 520),
    nodes: positionedNodes,
    edges: positionedEdges,
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
) {
  const titleWeight = Math.min(node.title.length, 36);
  const purposeWeight = Math.min(node.purpose.length, 110);
  const widthFloor = graphKey === "architecture" ? 232 : 248;
  const width = clamp(widthFloor + titleWeight * 2.3 + purposeWeight * 0.22, widthFloor, 360);
  const titleChars = estimateCharacterCapacity(
    width - (node.mechanism?.trim() ? 154 : 92),
    7.4,
  );
  const bodyChars = estimateCharacterCapacity(width - 34, 6.1);
  const titleLines = estimateTextLines(node.title, titleChars, 2);
  const purposeLines = estimateTextLines(node.purpose, bodyChars, 3);
  const mechanismLines = node.mechanism?.trim()
    ? estimateTextLines(node.mechanism, bodyChars, 2)
    : 0;
  const metaphorLines = node.metaphor?.trim()
    ? estimateTextLines(node.metaphor, bodyChars, 2)
    : 0;
  const height = clamp(
    54 +
      titleLines * 15 +
      purposeLines * 12.5 +
      mechanismLines * 11.5 +
      metaphorLines * 11.2 +
      32,
    124,
    196,
  );
  return { width, height };
}

function estimateTextLines(text: string, maxChars: number, maxLines: number) {
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
