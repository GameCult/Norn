use std::io::{self, BufRead, Write};

use anyhow::{Result, anyhow};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use cultnet_rs::{CultNetMessage, CultNetOperationServer};
use norn_eve_plugin::{PLUGIN_ID, PluginRequest, PluginResponse, RESPONSE_SCHEMA, dispatch};
use serde_json::json;

fn main() -> Result<()> {
    if std::env::args().any(|argument| argument == "--stdio") {
        return run_stdio().map_err(Into::into);
    }
    let host = std::env::var("EVE_PLUGIN_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port = std::env::var("EVE_PLUGIN_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let mut server = CultNetOperationServer::bind("norn-graph-plugin", &host, port)?;
    println!(
        "{}",
        json!({ "schema": "gamecult.eve.plugin_endpoint.v1", "pluginId": PLUGIN_ID, "endpoint": server.endpoint() })
    );
    loop {
        server.serve_once(handle_operation)?;
    }
}

fn handle_operation(message: CultNetMessage) -> Result<CultNetMessage> {
    let CultNetMessage::OperationRequest {
        message_id,
        service_id,
        operation,
        payload_schema,
        payload_encoding,
        payload,
        ..
    } = message
    else {
        return Err(anyhow!("expected operation request"));
    };
    if service_id != PLUGIN_ID
        || payload_schema != "gamecult.eve.plugin_abi.request.v1"
        || payload_encoding != "messagepack-base64"
    {
        return Err(anyhow!("unsupported Norn plugin operation envelope"));
    }
    let request: PluginRequest = rmp_serde::from_slice(&BASE64.decode(payload)?)?;
    let response = dispatch(request);
    let status = response.status.to_string();
    let diagnostics = response
        .diagnostics
        .iter()
        .map(|item| item.message.clone())
        .collect();
    Ok(CultNetMessage::OperationResponse {
        message_id,
        service_id,
        operation,
        status,
        payload_schema: RESPONSE_SCHEMA.into(),
        payload_encoding: "messagepack-base64".into(),
        payload: BASE64.encode(rmp_serde::to_vec_named(&response)?),
        diagnostics,
        source_runtime_id: Some("norn-graph-plugin".into()),
    })
}

fn run_stdio() -> io::Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
        let line = line.trim_start_matches('\u{feff}');
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<PluginRequest>(&line) {
            Ok(request) => dispatch(request),
            Err(error) => malformed_response(error.to_string()),
        };
        serde_json::to_writer(&mut stdout, &response)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
    }
    Ok(())
}

fn malformed_response(message: String) -> PluginResponse {
    PluginResponse {
        schema: RESPONSE_SCHEMA,
        plugin_id: PLUGIN_ID,
        operation: "invalid".into(),
        request_id: "invalid-request".into(),
        status: "rejected",
        output: json!({}),
        diagnostics: vec![norn_eve_plugin::Diagnostic {
            code: "malformed-request",
            message,
        }],
    }
}
