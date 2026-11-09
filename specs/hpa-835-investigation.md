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

Native and html2canvas screenshot results now explicitly report GPU surfaces as unverified and potentially black or missing, including file-save confirmations. They do not infer correctness from image dimensions, a nonempty PNG, or renderer readback. Restoring GPU pixels in the screenshot remains unresolved. `allowScreenCapture: true` only permits a fallback after native and html2canvas errors; a valid black native PNG returns before that fallback, so the flag does not force OS capture. No Screen Recording permission was requested, and no capture implementation claiming to solve WebKit compositing was added. Probe scripts and PNGs were kept locally outside the repository.
