//! Script injection command for re-injecting registered scripts on page load.

use crate::script_registry::{ScriptEntry, SharedScriptRegistry};
use tauri::{command, Runtime, State, WebviewWindow};

/// Request script injection - called by bridge.js when a page loads.
/// Uses the same native evaluation path as initial registration, including under CSP.
#[command]
pub async fn request_script_injection<R: Runtime>(
    window: WebviewWindow<R>,
    registry: State<'_, SharedScriptRegistry>,
) -> Result<serde_json::Value, String> {
    let scripts: Vec<ScriptEntry> = {
        let reg = registry
            .lock()
            .map_err(|e| format!("Failed to lock registry: {e}"))?;
        reg.get_all().iter().map(|e| (*e).clone()).collect()
    };

    if scripts.is_empty() {
        return Ok(serde_json::json!({
            "injected": 0,
            "message": "No scripts registered"
        }));
    }

    for entry in &scripts {
        crate::websocket::inject_script_to_window(&window, entry)?;
    }

    Ok(serde_json::json!({
        "injected": scripts.len(),
        "scriptIds": scripts.iter().map(|s| s.id.clone()).collect::<Vec<_>>()
    }))
}
