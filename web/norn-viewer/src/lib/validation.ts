import type {
  NornGraph,
  NornGraphsState,
  NornValidationIssue,
  GraphKey,
} from "./types";

export function validateNornGraphsState(state: NornGraphsState): NornValidationIssue[] {
  const issues: NornValidationIssue[] = [];
  const architectureIds = validateGraph("architecture", state.architecture, issues);
  const dataflowIds = validateGraph("dataflow", state.dataflow, issues);
  const linkPairs = new Set<string>();

  for (const link of state.links ?? []) {
    if (!link.dataflow_node_id?.trim()) {
      issues.push({
        scope: "links",
        message: "Link is missing a nonempty dataflow_node_id.",
      });
    }
    if (!link.architecture_node_id?.trim()) {
      issues.push({
        scope: "links",
        message: "Link is missing a nonempty architecture_node_id.",
      });
    }
    if (link.dataflow_node_id?.trim() && !dataflowIds.has(link.dataflow_node_id)) {
      issues.push({
        scope: "links",
        message: `Link references missing dataflow node '${link.dataflow_node_id}'.`,
      });
    }
    if (link.architecture_node_id?.trim() && !architectureIds.has(link.architecture_node_id)) {
      issues.push({
        scope: "links",
        message: `Link references missing architecture node '${link.architecture_node_id}'.`,
      });
    }
    const pairKey = `${link.dataflow_node_id}::${link.architecture_node_id}`;
    if (linkPairs.has(pairKey)) {
      issues.push({
        scope: "links",
        message: `Duplicate cross-link '${pairKey}'.`,
      });
    }
    linkPairs.add(pairKey);
  }

  return issues;
}

function validateGraph(
  graphKey: GraphKey,
  graph: NornGraph,
  issues: NornValidationIssue[],
): Set<string> {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  for (const node of graph.nodes ?? []) {
    if (!node.id?.trim()) {
      issues.push({
        scope: graphKey,
        message: "Node is missing a nonempty id.",
      });
    }
    if (!node.title?.trim()) {
      issues.push({
        scope: graphKey,
        message: `Node '${node.id || "<unknown>"}' is missing a nonempty title.`,
      });
    }
    if (!node.purpose?.trim()) {
      issues.push({
        scope: graphKey,
        message: `Node '${node.id || "<unknown>"}' is missing a nonempty purpose.`,
      });
    }
    if (nodeIds.has(node.id)) {
      issues.push({
        scope: graphKey,
        message: `Duplicate node id '${node.id}'.`,
      });
    }
    nodeIds.add(node.id);
  }

  for (const edge of graph.edges ?? []) {
    if (!edge.source_id?.trim()) {
      issues.push({
        scope: graphKey,
        message: "Edge is missing a nonempty source_id.",
      });
    }
    if (!edge.target_id?.trim()) {
      issues.push({
        scope: graphKey,
        message: "Edge is missing a nonempty target_id.",
      });
    }
    if (!edge.kind?.trim()) {
      issues.push({
        scope: graphKey,
        message: "Edge is missing a nonempty kind.",
      });
    }
    if (edge.source_id?.trim() && !nodeIds.has(edge.source_id)) {
      issues.push({
        scope: graphKey,
        message: `Edge '${edge.id || fallbackEdgeId(edge)}' references missing source node '${edge.source_id}'.`,
      });
    }
    if (edge.target_id?.trim() && !nodeIds.has(edge.target_id)) {
      issues.push({
        scope: graphKey,
        message: `Edge '${edge.id || fallbackEdgeId(edge)}' references missing target node '${edge.target_id}'.`,
      });
    }
    if (edge.id?.trim()) {
      if (edgeIds.has(edge.id)) {
        issues.push({
          scope: graphKey,
          message: `Duplicate edge id '${edge.id}'.`,
        });
      }
      edgeIds.add(edge.id);
    }
  }

  return nodeIds;
}

function fallbackEdgeId(edge: { source_id: string; target_id: string; kind: string }) {
  return `${edge.source_id}->${edge.target_id}:${edge.kind}`;
}
