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

type NodeSizingMode = "layered" | "compact";

type LayoutViewport = {
  width: number;
  height: number;
};

type ForceLayoutInput = {
  graphKey: GraphKey;
  graph: EpiphanyGraph;
  sizes: Array<{ width: number; height: number }>;
  edgePairs: number[];
  nodeDegrees: Map<string, number>;
  linkCounts: Map<string, number>;
  viewport?: LayoutViewport;
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

  const coordinates = usesForceLayout(mode)
    ? layoutWithDeterministicForce({
        graphKey,
        graph,
        sizes,
        edgePairs,
        nodeDegrees,
        linkCounts,
        viewport,
      })
    : await layoutWithRustSolver({
        nodeWeights: buildNodeWeights(graph, sizes, nodeDegrees, linkCounts),
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
  const separatedNodes = normalizeNodeBounds(separateNodeBounds(positionedNodes, sizingAlgorithm));
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

function sizingAlgorithmForMode(mode: EpiphanyGraphLayoutMode): NodeSizingMode {
  return mode === "layered" ? "layered" : "compact";
}

function usesForceLayout(mode: EpiphanyGraphLayoutMode) {
  return mode === "force" || mode === "combined-force";
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

function buildNodeWeights(
  graph: EpiphanyGraph,
  sizes: Array<{ width: number; height: number }>,
  nodeDegrees: Map<string, number>,
  linkCounts: Map<string, number>,
) {
  return new Float32Array(
    graph.nodes.map((node, index) => {
      const degree = nodeDegrees.get(node.id) ?? 0;
      const linkCount = linkCounts.get(node.id) ?? 0;
      return Math.max(0.25, 1 + degree * 0.16 + linkCount * 0.24 + (sizes[index].width * sizes[index].height) / 80_000);
    }),
  );
}

function layoutWithDeterministicForce({
  graphKey,
  graph,
  sizes,
  edgePairs,
  nodeDegrees,
  linkCounts,
  viewport,
}: ForceLayoutInput) {
  const nodeCount = graph.nodes.length;
  const coordinates = new Float32Array(nodeCount * 4);

  if (nodeCount === 0) {
    return coordinates;
  }

  const maxDegree = Math.max(1, ...graph.nodes.map((node) => nodeDegrees.get(node.id) ?? 0));
  const baseWidth = Math.max(viewport?.width ?? 0, 900);
  const baseHeight = Math.max(viewport?.height ?? 0, 620);
  const graphWidth = Math.max(baseWidth * 1.35, Math.sqrt(nodeCount) * 250);
  const graphHeight = Math.max(baseHeight * 1.35, Math.sqrt(nodeCount) * 200);
  const centerX = graphWidth / 2;
  const centerY = graphHeight / 2;
  const area = graphWidth * graphHeight;
  const naturalDistance = Math.sqrt(area / Math.max(1, nodeCount)) * (graphKey === "architecture" ? 0.62 : 0.72);
  const sections = sortedNodeSections(graph);
  const sectionCenters = buildSectionCenters(sections, centerX, centerY, graphWidth, graphHeight);
  const positions = new Float64Array(nodeCount * 2);
  const velocities = new Float64Array(nodeCount * 2);

  for (let index = 0; index < nodeCount; index += 1) {
    const node = graph.nodes[index];
    const section = nodeSection(node.id);
    const sectionCenter = sectionCenters.get(section) ?? { x: centerX, y: centerY };
    const degree = nodeDegrees.get(node.id) ?? 0;
    const hubPull = degree / maxDegree;
    const angle = seededAngle(`${node.id}:angle`);
    const radiusSeed = seededUnit(`${node.id}:radius`);
    const sectionRadius = Math.min(graphWidth, graphHeight) * 0.1;
    const radius = sectionRadius * (0.28 + radiusSeed * 0.72) * (1 - hubPull * 0.78);
    const linkedPull = Math.min(1, (linkCounts.get(node.id) ?? 0) / 10);
    const centrality = Math.max(hubPull, linkedPull);
    const sectionMix = 0.62 - centrality * 0.52;
    const mixedCenterX = lerp(centerX, sectionCenter.x, sectionMix);
    const mixedCenterY = lerp(centerY, sectionCenter.y, sectionMix);

    positions[index * 2] = mixedCenterX + Math.cos(angle) * radius;
    positions[index * 2 + 1] = mixedCenterY + Math.sin(angle) * radius;
  }

  const iterations = graphKey === "architecture" ? 620 : 440;
  let temperature = Math.min(graphWidth, graphHeight) * 0.065;
  const minTemperature = Math.max(10, naturalDistance * 0.045);

  for (let pass = 0; pass < iterations; pass += 1) {
    const displacements = new Float64Array(nodeCount * 2);

    applyRepulsion(positions, displacements, sizes, naturalDistance);
    applyEdgeAttraction(positions, displacements, edgePairs, graph, nodeDegrees, naturalDistance);
    applySectionGravity(positions, displacements, graph, nodeDegrees, linkCounts, sectionCenters, centerX, centerY, maxDegree);
    applyCollisionPush(positions, displacements, sizes, graph.nodes, nodeDegrees, maxDegree);
    applyBoundaryGravity(positions, displacements, graphWidth, graphHeight, centerX, centerY);

    for (let index = 0; index < nodeCount; index += 1) {
      const offset = index * 2;
      const degree = nodeDegrees.get(graph.nodes[index].id) ?? 0;
      const damping = 0.64 + (degree / maxDegree) * 0.16;
      const dx = clamp(displacements[offset], -temperature, temperature);
      const dy = clamp(displacements[offset + 1], -temperature, temperature);
      velocities[offset] = (velocities[offset] + dx) * damping;
      velocities[offset + 1] = (velocities[offset + 1] + dy) * damping;
      positions[offset] += velocities[offset] * 0.08;
      positions[offset + 1] += velocities[offset + 1] * 0.08;
    }

    temperature = Math.max(minTemperature, temperature * 0.992);
  }

  for (let index = 0; index < nodeCount; index += 1) {
    coordinates[index * 4] = positions[index * 2];
    coordinates[index * 4 + 1] = positions[index * 2 + 1];
  }

  return coordinates;
}

function applyRepulsion(
  positions: Float64Array,
  displacements: Float64Array,
  sizes: Array<{ width: number; height: number }>,
  naturalDistance: number,
) {
  const nodeCount = sizes.length;

  for (let leftIndex = 0; leftIndex < nodeCount; leftIndex += 1) {
    const leftOffset = leftIndex * 2;

    for (let rightIndex = leftIndex + 1; rightIndex < nodeCount; rightIndex += 1) {
      const rightOffset = rightIndex * 2;
      let dx = positions[leftOffset] - positions[rightOffset];
      let dy = positions[leftOffset + 1] - positions[rightOffset + 1];
      let distance = Math.hypot(dx, dy);

      if (distance < 0.01) {
        const angle = seededAngle(`${leftIndex}:${rightIndex}:repel`);
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        distance = 1;
      }

      const sizeBias = Math.sqrt((sizes[leftIndex].width * sizes[leftIndex].height + sizes[rightIndex].width * sizes[rightIndex].height) / 2) / 130;
      const force = (naturalDistance * naturalDistance * (0.34 + sizeBias * 0.16)) / Math.max(1, distance);
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;

      displacements[leftOffset] += fx;
      displacements[leftOffset + 1] += fy;
      displacements[rightOffset] -= fx;
      displacements[rightOffset + 1] -= fy;
    }
  }
}

function applyEdgeAttraction(
  positions: Float64Array,
  displacements: Float64Array,
  edgePairs: number[],
  graph: EpiphanyGraph,
  nodeDegrees: Map<string, number>,
  naturalDistance: number,
) {
  for (let edgeIndex = 0; edgeIndex < edgePairs.length; edgeIndex += 2) {
    const sourceIndex = edgePairs[edgeIndex];
    const targetIndex = edgePairs[edgeIndex + 1];
    const sourceOffset = sourceIndex * 2;
    const targetOffset = targetIndex * 2;
    const dx = positions[targetOffset] - positions[sourceOffset];
    const dy = positions[targetOffset + 1] - positions[sourceOffset + 1];
    const distance = Math.max(1, Math.hypot(dx, dy));
    const sourceDegree = nodeDegrees.get(graph.nodes[sourceIndex].id) ?? 0;
    const targetDegree = nodeDegrees.get(graph.nodes[targetIndex].id) ?? 0;
    const desired = naturalDistance * (0.62 + Math.min(sourceDegree, targetDegree) * 0.012);
    const force = (distance - desired) * 0.085;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;

    displacements[sourceOffset] += fx;
    displacements[sourceOffset + 1] += fy;
    displacements[targetOffset] -= fx;
    displacements[targetOffset + 1] -= fy;
  }
}

function applySectionGravity(
  positions: Float64Array,
  displacements: Float64Array,
  graph: EpiphanyGraph,
  nodeDegrees: Map<string, number>,
  linkCounts: Map<string, number>,
  sectionCenters: Map<string, { x: number; y: number }>,
  centerX: number,
  centerY: number,
  maxDegree: number,
) {
  for (let index = 0; index < graph.nodes.length; index += 1) {
    const node = graph.nodes[index];
    const offset = index * 2;
    const degree = nodeDegrees.get(node.id) ?? 0;
    const linkCount = linkCounts.get(node.id) ?? 0;
    const linkedPull = Math.min(1, linkCount / 10);
    const hubPull = Math.max(degree / maxDegree, linkedPull);
    const sectionCenter = sectionCenters.get(nodeSection(node.id)) ?? { x: centerX, y: centerY };
    const targetX = lerp(sectionCenter.x, centerX, hubPull * 0.95);
    const targetY = lerp(sectionCenter.y, centerY, hubPull * 0.95);
    const strength = 0.018 + hubPull * 0.09 + Math.min(linkCount, 8) * 0.003;

    displacements[offset] += (targetX - positions[offset]) * strength;
    displacements[offset + 1] += (targetY - positions[offset + 1]) * strength;
  }
}

function applyCollisionPush(
  positions: Float64Array,
  displacements: Float64Array,
  sizes: Array<{ width: number; height: number }>,
  nodes: EpiphanyGraph["nodes"],
  nodeDegrees: Map<string, number>,
  maxDegree: number,
) {
  const nodeCount = sizes.length;

  for (let leftIndex = 0; leftIndex < nodeCount; leftIndex += 1) {
    const leftOffset = leftIndex * 2;

    for (let rightIndex = leftIndex + 1; rightIndex < nodeCount; rightIndex += 1) {
      const rightOffset = rightIndex * 2;
      const dx = positions[rightOffset] - positions[leftOffset];
      const dy = positions[rightOffset + 1] - positions[leftOffset + 1];
      const gapX = (sizes[leftIndex].width + sizes[rightIndex].width) / 2 + 44;
      const gapY = (sizes[leftIndex].height + sizes[rightIndex].height) / 2 + 34;
      const overlapX = gapX - Math.abs(dx);
      const overlapY = gapY - Math.abs(dy);

      if (overlapX <= 0 || overlapY <= 0) {
        continue;
      }

      const leftDegree = nodeDegrees.get(nodes[leftIndex].id) ?? 0;
      const rightDegree = nodeDegrees.get(nodes[rightIndex].id) ?? 0;
      const leftWeight = 1 + (leftDegree / maxDegree) * 1.8;
      const rightWeight = 1 + (rightDegree / maxDegree) * 1.8;
      const totalWeight = leftWeight + rightWeight;

      if (overlapX < overlapY) {
        const direction = dx >= 0 ? 1 : -1;
        const push = overlapX * 0.42;
        displacements[leftOffset] -= direction * push * (rightWeight / totalWeight);
        displacements[rightOffset] += direction * push * (leftWeight / totalWeight);
      } else {
        const direction = dy >= 0 ? 1 : -1;
        const push = overlapY * 0.42;
        displacements[leftOffset + 1] -= direction * push * (rightWeight / totalWeight);
        displacements[rightOffset + 1] += direction * push * (leftWeight / totalWeight);
      }
    }
  }
}

function applyBoundaryGravity(
  positions: Float64Array,
  displacements: Float64Array,
  graphWidth: number,
  graphHeight: number,
  centerX: number,
  centerY: number,
) {
  const nodeCount = positions.length / 2;
  const marginX = graphWidth * 0.1;
  const marginY = graphHeight * 0.1;

  for (let index = 0; index < nodeCount; index += 1) {
    const offset = index * 2;
    const x = positions[offset];
    const y = positions[offset + 1];

    displacements[offset] += (centerX - x) * 0.006;
    displacements[offset + 1] += (centerY - y) * 0.006;

    if (x < marginX) {
      displacements[offset] += (marginX - x) * 0.08;
    } else if (x > graphWidth - marginX) {
      displacements[offset] -= (x - (graphWidth - marginX)) * 0.08;
    }

    if (y < marginY) {
      displacements[offset + 1] += (marginY - y) * 0.08;
    } else if (y > graphHeight - marginY) {
      displacements[offset + 1] -= (y - (graphHeight - marginY)) * 0.08;
    }
  }
}

function sortedNodeSections(graph: EpiphanyGraph) {
  return Array.from(new Set(graph.nodes.map((node) => nodeSection(node.id)))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function buildSectionCenters(
  sections: string[],
  centerX: number,
  centerY: number,
  graphWidth: number,
  graphHeight: number,
) {
  const centers = new Map<string, { x: number; y: number }>();
  const radiusX = graphWidth * 0.27;
  const radiusY = graphHeight * 0.26;

  sections.forEach((section, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, sections.length)) * Math.PI * 2;
    centers.set(section, {
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    });
  });

  return centers;
}

function nodeSection(nodeId: string) {
  if (nodeId.startsWith("section:")) {
    return nodeId.slice("section:".length);
  }

  return nodeId.includes("/") ? nodeId.split("/")[0] : "Root";
}

function seededAngle(seed: string) {
  return seededUnit(seed) * Math.PI * 2;
}

function seededUnit(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * clamp(amount, 0, 1);
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

function separateNodeBounds(nodes: PositionedNode[], sizingMode: NodeSizingMode): PositionedNode[] {
  if (!isCompactSizingMode(sizingMode) || nodes.length < 2) {
    return relaxOverlappingNodes(nodes);
  }

  return relaxOverlappingNodes(resizeNodesForSeparation(nodes));
}

function resizeNodesForSeparation(nodes: PositionedNode[]): PositionedNode[] {
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

  return resizedNodes;
}

function relaxOverlappingNodes(nodes: PositionedNode[]): PositionedNode[] {
  let relaxedNodes = nodes;
  const gapX = 56;
  const gapY = 40;

  for (let pass = 0; pass < 96; pass += 1) {
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
        const overlapX = (left.width + right.width) / 2 + gapX - Math.abs(rightCenter.x - leftCenter.x);
        const overlapY = (left.height + right.height) / 2 + gapY - Math.abs(rightCenter.y - leftCenter.y);

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

function isCompactSizingMode(sizingMode: NodeSizingMode) {
  return sizingMode === "compact";
}

function nodeCenter(node: { x: number; y: number; width: number; height: number }) {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
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
  sizingMode: NodeSizingMode,
  nodeCount: number,
  viewport?: LayoutViewport,
) {
  const compact = isCompactSizingMode(sizingMode);
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
