//! Script injection command for re-injecting registered scripts on page load.

use std::collections::HashSet;

use crate::script_registry::{ScriptEntry, SharedScriptRegistry};
use tauri::{command, Runtime, State, WebviewWindow};

/// Request script injection - called by bridge.js when a page loads.
/// Uses the same native evaluation path as initial registration, including under CSP.
/// `skip_ids` lists scripts whose inert marker is already in the current document;
/// the bridge supplies it so a repeated request does not re-run inline scripts or
/// reload URL scripts. Explicit `register_script` calls can still replace a script.
#[command]
pub async fn request_script_injection<R: Runtime>(
    window: WebviewWindow<R>,
    registry: State<'_, SharedScriptRegistry>,
    skip_ids: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let skip: HashSet<String> = skip_ids.unwrap_or_default().into_iter().collect();

    let (scripts, total) = {
        let reg = registry
            .lock()
            .map_err(|e| format!("Failed to lock registry: {e}"))?;
        let all = reg.get_all();
        let pending: Vec<ScriptEntry> = all
            .iter()
            .filter(|e| !skip.contains(&e.id))
            .map(|e| (*e).clone())
            .collect();
        (pending, all.len())
    };

    if scripts.is_empty() {
        let message = if total > 0 {
            "All registered scripts already injected"
        } else {
            "No scripts registered"
        };

        return Ok(serde_json::json!({
            "injected": 0,
            "skipped": total,
            "scriptIds": Vec::<String>::new(),
            "message": message
        }));
    }

    for entry in &scripts {
        crate::websocket::inject_script_to_window(&window, entry)?;
    }

    Ok(serde_json::json!({
        "injected": scripts.len(),
        "skipped": total - scripts.len(),
        "scriptIds": scripts.iter().map(|s| s.id.clone()).collect::<Vec<_>>()
    }))
}
