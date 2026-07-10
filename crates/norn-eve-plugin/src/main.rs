use std::io::{self, BufRead, Write};

use norn_eve_plugin::{PLUGIN_ID, PluginRequest, PluginResponse, RESPONSE_SCHEMA, dispatch};
use serde_json::json;

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
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
