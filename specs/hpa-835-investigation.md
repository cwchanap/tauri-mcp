# HPA-835: helper injection and GPU snapshots

## Helper failure

The test app reproduced `Resolve-ref helper was not available in the webview after registration` on macOS 26.6.2 (25G83), arm64, with this checkout's bridge and server (0.12.0). The debug binary was built with `tauri/custom-protocol`, served `tauri://localhost`, and used Caelum's restrictive CSP. An ordinary inline script tag was blocked, while the bridge's native `execute_js` command worked. The same test passed before the fix under `tauri dev`, so development mode alone did not cover this failure.

`register_script` previously evaluated code that appended an executable script tag. Native evaluation succeeded, but CSP blocked the tag's contents. Both initial registration and page-load restoration now evaluate inline source natively, retaining inert DOM markers. This requires rebuilding the application's bridge plugin; upgrading only the server cannot repair an older bridge's injection path. URL scripts remain subject to CSP.

The packaged-origin regression verifies blocked inline tags, high-level JavaScript execution, ref resolution, screenshot image output, and restoration after a real page reload. The existing script-manager and accessibility snapshot tests also pass under the packaged CSP. See [architecture.md](architecture.md#page-load-re-injection) for the command and CI coverage.

## GPU investigation and limits

A temporary probe in the packaged test app configured a 256 × 128 `bgra8unorm` WebGPU canvas with `RENDER_ATTACHMENT | COPY_SRC`. It cleared to RGBA (0.1, 0.7, 0.2, 1), copied the canvas texture to a mapped buffer, and read BGRA bytes `[51, 178, 26, 255]`. The native WKWebView snapshot returned a 1600 × 1200 PNG whose canvas interior was `[0, 0, 0, 255]`. HTML content remained present.

The document reported `visibilityState: hidden` and `hasFocus(): false`, both before and after activating the test process and repeating native capture. A targeted OS capture with `screencapture -x -l<test-window-id>` failed with `could not create image from window`. Therefore this experiment confirms successful rendering alongside an incomplete WebView snapshot, but does **not** establish visible presentation or isolate occlusion from WebKit's compositing behavior. It also does not verify the original Caelum window. The probe ran without the ticket's isolated HOME or extra outbound-network restrictions, so those conditions were not necessary to reproduce these observations.

[WebKit bug 198107](https://bugs.webkit.org/show_bug.cgi?id=198107) documents related black hardware-accelerated WebGL/video regions in WKWebView snapshots on older iOS. That is supporting context, not proof of the cause for macOS WebGPU here.

On 2026-11-09, the user confirmed that the actual native Caelum map renders normally while the testing agent's MCP capture remains black and includes the new warning. This user observation establishes normal visible presentation for that reported run and narrows the remaining problem to screenshot capture. It is separate from the local hidden-window probe above; no matching OS screenshot was obtained here, and the exact WebKit compositing cause remains unverified.

Native and html2canvas screenshot results explicitly report GPU surfaces as unverified and potentially black or missing, including file-save confirmations. They do not infer correctness from image dimensions, a nonempty PNG, or renderer readback. `allowScreenCapture: true` only permits a fallback after native and html2canvas errors; a valid black native PNG returns before that fallback, so the flag does not force OS capture.

## Explicit OS window capture

`webview_screenshot` now accepts `mode: "window"`. This opt-in path sends a dedicated `capture_window_screenshot` bridge command, resolves the selected window's native ID, and runs the built-in macOS `screencapture` utility for that window only. It captures the window frame and composited content, excludes shadows and attached windows, and reuses the existing format and resizing code. It has no WebView fallback: an old bridge, unsupported platform, or unavailable OS capture returns an error instead of a different screenshot. The default viewport mode remains unchanged.

Authorization is checked without prompting through `CGPreflightScreenCaptureAccess`, resolved at runtime so older macOS versions can still load the bridge. Window capture requires macOS 10.15 or later; a missing API or denied access fails before launching the utility. The utility writes into a unique directory with mode 0700; a scope guard removes the image on success, error, timeout, or cancellation. The process has a 10-second timeout and is killed when its future is dropped. A focused test verifies temporary-file removal, and packaged integration tests verify window targeting and either real OS image output or an explicit OS capture failure.

A fresh local probe reported `visibilityState: visible`, and the default native snapshot contained the expected RGBA `[26, 178, 51, 255]` canvas pixel. This contrasts with the earlier hidden-document probe and shows that native WebGPU capture is not universally unsupported; visibility and the exact scene still matter. It does not reproduce or explain the exact Caelum compositing failure.

The same probe's OS window capture failed with `could not create image from window`; a separate `CGPreflightScreenCaptureAccess()` check in the local launcher context returned `false`. No permission was requested or changed. Positive GPU pixel verification through OS capture is therefore still blocked in this environment. Rebuild the app's bridge and MCP server, grant Screen Recording access to the app or launcher identified by macOS, keep the native window visible, then call `webview_screenshot` with `mode: "window"` and compare the map. Probe scripts and PNGs remain local, outside the repository.

Final validation passed: 77 unit tests; the full packaged suite with `TAURI_MCP_NO_FOREGROUND=1` (174 passed, one existing skip); workspace build and standards; 12 Rust unit tests and 10 doctests (eight ignored examples). Foregrounding-enabled reruns intermittently timed out in legacy native screenshot/evaluation calls, including multi-window and accessibility tests; the passing run does not establish stability under automatic foregrounding. Shared test setup now waits for the real fixture document, and screenshot tests allow the native timeout and JavaScript fallback to finish before their own timeout. OS window mode does not initialize or execute WebView helpers.
