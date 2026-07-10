use std::collections::{HashMap, HashSet};

use norn_rs::{Graph, LayoutConfig, layout};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const PLUGIN_ID: &str = "norn.graph";
pub const REQUEST_SCHEMA: &str = "gamecult.eve.plugin_abi.request.v1";
pub const RESPONSE_SCHEMA: &str = "gamecult.eve.plugin_abi.response.v1";
const MAX_NODES: usize = 10_000;
const MAX_EDGES: usize = 50_000;
const MAX_ITERATIONS: usize = 10_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRequest {
    pub schema: String,
    pub plugin_id: String,
    pub operation: String,
    pub request_id: String,
    #[serde(default)]
    pub input: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginResponse {
    pub schema: &'static str,
    pub plugin_id: &'static str,
    pub operation: String,
    pub request_id: String,
    pub status: &'static str,
    pub output: Value,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphInput {
    #[serde(default)]
    nodes: Vec<GraphNodeInput>,
    #[serde(default)]
    edges: Vec<GraphEdgeInput>,
    #[serde(default)]
    layout: LayoutInput,
}

#[derive(Debug, Deserialize)]
struct GraphNodeInput {
    id: String,
    #[serde(default = "default_weight")]
    weight: f32,
    #[serde(default = "default_width")]
    width: f32,
    #[serde(default = "default_height")]
    height: f32,
}

#[derive(Debug, Deserialize, Serialize)]
struct GraphEdgeInput {
    source: String,
    target: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayoutInput {
    iterations: Option<usize>,
    rank_gap: Option<f32>,
    node_gap: Option<f32>,
    edge_length: Option<f32>,
}

pub fn dispatch(request: PluginRequest) -> PluginResponse {
    if request.schema != REQUEST_SCHEMA {
        return rejected(&request, "schema", format!("expected {REQUEST_SCHEMA}"));
    }
    if request.plugin_id != PLUGIN_ID {
        return rejected(&request, "plugin-id", format!("expected {PLUGIN_ID}"));
    }

    match request.operation.as_str() {
        "describe" => accepted(&request, describe()),
        "validate" => accepted(&request, validate(&request.input)),
        "project" => project(&request),
        "measure" => measure(&request),
        _ => rejected(
            &request,
            "unsupported-operation",
            format!("Norn does not implement operation {}", request.operation),
        ),
    }
}

fn describe() -> Value {
    json!({
        "pluginId": PLUGIN_ID,
        "ownerRepo": "Norn",
        "componentKinds": ["embed.norn"],
        "commands": ["graph.node.activate", "graph.focus"],
        "capabilities": ["embed.norn", "graph.node.activate"],
        "operations": ["describe", "validate", "project", "measure"],
        "transports": ["stdio-ndjson"],
        "stateAuthority": "proposes-plugin-state-only-provider-accepts"
    })
}

fn validate(input: &Value) -> Value {
    let kinds = input
        .get("componentKinds")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let (accepted_kinds, rejected_kinds): (Vec<_>, Vec<_>) = kinds
        .into_iter()
        .filter_map(|value| value.as_str().map(str::to_owned))
        .partition(|kind| kind == "embed.norn");

    json!({
        "acceptedComponentKinds": accepted_kinds,
        "rejectedComponentKinds": rejected_kinds,
        "requiredCapabilities": ["embed.norn"],
        "valid": rejected_kinds.is_empty()
    })
}

fn project(request: &PluginRequest) -> PluginResponse {
    let kind = request
        .input
        .get("component")
        .and_then(|component| component.get("kind"))
        .and_then(Value::as_str)
        .or_else(|| request.input.get("nodeKind").and_then(Value::as_str));
    if kind != Some("embed.norn") {
        return rejected(
            request,
            "component-kind",
            "project requires embed.norn".into(),
        );
    }

    accepted(
        request,
        json!({
            "projectionKind": "embedded-semantic-surface",
            "ownedComponentKinds": ["embed.norn"],
            "outputSchemas": [
                "norn.graph.document.v1",
                "norn.graph.layout_request.v1",
                "norn.graph.layout_result.v1"
            ],
            "semanticOwner": "Norn",
            "graph": request.input.get("graph").cloned().unwrap_or_else(|| json!({}))
        }),
    )
}

fn measure(request: &PluginRequest) -> PluginResponse {
    let graph_value = request.input.get("graph").unwrap_or(&request.input);
    let input: GraphInput = match serde_json::from_value(graph_value.clone()) {
        Ok(input) => input,
        Err(error) => return rejected(request, "graph-input", error.to_string()),
    };
    let prepared = match prepare_graph(&input) {
        Ok(prepared) => prepared,
        Err(message) => return rejected(request, "graph-input", message),
    };
    let result = layout(&prepared.graph, &prepared.config);
    let nodes_by_index = input.nodes.iter().collect::<Vec<_>>();
    let node_bounds = result
        .nodes
        .iter()
        .map(|node| {
            let source = nodes_by_index[node.id.0];
            json!({
                "id": source.id,
                "x": node.x - source.width / 2.0,
                "y": node.y - source.height / 2.0,
                "width": source.width,
                "height": source.height,
                "rank": node.rank,
                "order": node.order
            })
        })
        .collect::<Vec<_>>();
    let positions = result
        .nodes
        .iter()
        .map(|node| (node.id.0, (node.x, node.y)))
        .collect::<HashMap<_, _>>();
    let edge_routes = input
        .edges
        .iter()
        .map(|edge| {
            let source = prepared.ids[&edge.source];
            let target = prepared.ids[&edge.target];
            let (sx, sy) = positions[&source];
            let (tx, ty) = positions[&target];
            json!({"source": edge.source, "target": edge.target, "points": [[sx, sy], [tx, ty]]})
        })
        .collect::<Vec<_>>();
    let viewport = viewport_bounds(&result.nodes, &input.nodes);

    accepted(
        request,
        json!({
            "measurementKind": "graph-layout-metrics",
            "measurementOutputs": ["nodeBounds", "edgeRoutes", "viewportBounds"],
            "layoutSchema": "norn.graph.layout_result.v1",
            "nodeBounds": node_bounds,
            "edgeRoutes": edge_routes,
            "viewportBounds": viewport,
            "preservesProviderAuthority": true
        }),
    )
}

struct PreparedGraph {
    graph: Graph,
    ids: HashMap<String, usize>,
    config: LayoutConfig,
}

fn prepare_graph(input: &GraphInput) -> Result<PreparedGraph, String> {
    if input.nodes.is_empty() {
        return Err("graph must contain at least one node".into());
    }
    if input.nodes.len() > MAX_NODES {
        return Err(format!("graph exceeds the {MAX_NODES} node limit"));
    }
    if input.edges.len() > MAX_EDGES {
        return Err(format!("graph exceeds the {MAX_EDGES} edge limit"));
    }
    let mut graph = Graph::with_capacity(input.nodes.len(), input.edges.len());
    let mut ids = HashMap::new();
    for node in &input.nodes {
        if node.id.trim().is_empty() || ids.contains_key(&node.id) {
            return Err(format!(
                "node ids must be non-empty and unique: {}",
                node.id
            ));
        }
        if !node.weight.is_finite() || !node.width.is_finite() || !node.height.is_finite() {
            return Err(format!(
                "node {} contains a non-finite measurement",
                node.id
            ));
        }
        if node.width <= 0.0 || node.height <= 0.0 {
            return Err(format!("node {} dimensions must be positive", node.id));
        }
        ids.insert(node.id.clone(), graph.add_node(node.weight).0);
    }
    let mut unique_edges = HashSet::new();
    for edge in &input.edges {
        let source = ids
            .get(&edge.source)
            .ok_or_else(|| format!("unknown edge source: {}", edge.source))?;
        let target = ids
            .get(&edge.target)
            .ok_or_else(|| format!("unknown edge target: {}", edge.target))?;
        if unique_edges.insert((*source, *target)) {
            graph.add_edge(norn_rs::NodeId(*source), norn_rs::NodeId(*target));
        }
    }
    let mut config = LayoutConfig::default();
    if let Some(value) = input.layout.iterations {
        if value == 0 || value > MAX_ITERATIONS {
            return Err(format!(
                "layout iterations must be between 1 and {MAX_ITERATIONS}"
            ));
        }
        config.iterations = value;
    }
    if let Some(value) = input.layout.rank_gap {
        validate_positive_layout_value("rankGap", value)?;
        config.rank_gap = value;
    }
    if let Some(value) = input.layout.node_gap {
        validate_positive_layout_value("nodeGap", value)?;
        config.node_gap = value;
    }
    if let Some(value) = input.layout.edge_length {
        validate_positive_layout_value("edgeLength", value)?;
        config.edge_length = value;
    }
    Ok(PreparedGraph { graph, ids, config })
}

fn validate_positive_layout_value(name: &str, value: f32) -> Result<(), String> {
    if value.is_finite() && value > 0.0 {
        Ok(())
    } else {
        Err(format!("layout {name} must be finite and positive"))
    }
}

fn viewport_bounds(layout: &[norn_rs::NodeLayout], nodes: &[GraphNodeInput]) -> Value {
    let mut min_x = f32::INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    for node in layout {
        let source = &nodes[node.id.0];
        min_x = min_x.min(node.x - source.width / 2.0);
        min_y = min_y.min(node.y - source.height / 2.0);
        max_x = max_x.max(node.x + source.width / 2.0);
        max_y = max_y.max(node.y + source.height / 2.0);
    }
    json!({"x": min_x, "y": min_y, "width": max_x - min_x, "height": max_y - min_y})
}

fn accepted(request: &PluginRequest, output: Value) -> PluginResponse {
    PluginResponse {
        schema: RESPONSE_SCHEMA,
        plugin_id: PLUGIN_ID,
        operation: request.operation.clone(),
        request_id: request.request_id.clone(),
        status: "accepted",
        output,
        diagnostics: Vec::new(),
    }
}

fn rejected(request: &PluginRequest, code: &'static str, message: String) -> PluginResponse {
    PluginResponse {
        schema: RESPONSE_SCHEMA,
        plugin_id: PLUGIN_ID,
        operation: request.operation.clone(),
        request_id: request.request_id.clone(),
        status: "rejected",
        output: json!({}),
        diagnostics: vec![Diagnostic { code, message }],
    }
}

fn default_weight() -> f32 {
    1.0
}
fn default_width() -> f32 {
    120.0
}
fn default_height() -> f32 {
    56.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(operation: &str, input: Value) -> PluginRequest {
        PluginRequest {
            schema: REQUEST_SCHEMA.into(),
            plugin_id: PLUGIN_ID.into(),
            operation: operation.into(),
            request_id: format!("test-{operation}"),
            input,
        }
    }

    #[test]
    fn describes_norn_owned_capabilities() {
        let response = dispatch(request("describe", json!({})));
        assert_eq!(response.status, "accepted");
        assert_eq!(response.output["ownerRepo"], "Norn");
    }

    #[test]
    fn measures_graph_with_solver_owned_coordinates() {
        let response = dispatch(request(
            "measure",
            json!({"graph": {
                "nodes": [{"id":"a"},{"id":"b"},{"id":"c"}],
                "edges": [{"source":"a","target":"b"},{"source":"b","target":"c"}],
                "layout": {"iterations": 20}
            }}),
        ));
        assert_eq!(response.status, "accepted");
        assert_eq!(response.output["nodeBounds"].as_array().unwrap().len(), 3);
        assert_eq!(response.output["edgeRoutes"].as_array().unwrap().len(), 2);
        assert_eq!(response.output["preservesProviderAuthority"], true);
    }

    #[test]
    fn rejects_edges_that_reference_unknown_nodes() {
        let response = dispatch(request(
            "measure",
            json!({"graph": {
                "nodes": [{"id":"a"}], "edges": [{"source":"a","target":"missing"}]
            }}),
        ));
        assert_eq!(response.status, "rejected");
        assert!(
            response.diagnostics[0]
                .message
                .contains("unknown edge target")
        );
    }

    #[test]
    fn rejects_unbounded_solver_work() {
        let response = dispatch(request(
            "measure",
            json!({"graph": {
                "nodes": [{"id":"a"}], "layout": {"iterations": MAX_ITERATIONS + 1}
            }}),
        ));
        assert_eq!(response.status, "rejected");
        assert!(response.diagnostics[0].message.contains("iterations"));
    }
}
