use super::{Screenshot, ScreenshotError};
use tauri::{Runtime, WebviewWindow};

#[cfg(target_os = "macos")]
const LOG_SCOPE: &str = "SCREENSHOT_MACOS";

/// macOS-specific screenshot implementation using WKWebView's takeSnapshot
///
/// This implementation captures only the visible viewport, not the full document.
/// It uses the native WKWebView takeSnapshot API to get a high-quality screenshot.
pub fn capture_viewport<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<Screenshot, ScreenshotError> {
    #[cfg(target_os = "macos")]
    {
        use block2::RcBlock;
        use objc2_app_kit::NSImage;
        use objc2_foundation::NSError;
        use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
        use std::sync::mpsc;
        use std::sync::{Arc, Mutex};

        let (tx, rx) = mpsc::channel::<Result<Screenshot, ScreenshotError>>();
        let tx = Arc::new(Mutex::new(Some(tx)));

        if let Err(e) = crate::utils::prepare_window_for_screenshot(window) {
            crate::logging::mcp_log_error(LOG_SCOPE, &format!("Failed to prepare window: {e}"));
        }

        // Use Tauri's with_webview to access the platform-specific webview
        window
            .with_webview(move |webview| {
                unsafe {
                    // Get the WKWebView from Tauri's webview handle
                    let wkwebview: &WKWebView = &*(webview.inner() as *const _ as *const WKWebView);

                    // Create snapshot configuration (nil means capture visible viewport)
                    let config = WKSnapshotConfiguration::new();

                    // Create completion handler block
                    let tx_clone = tx.clone();
                    let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                        if let Some(tx) = tx_clone.lock().unwrap().take() {
                            if !error.is_null() {
                                let err = &*error;
                                let desc = err.localizedDescription();
                                let error_string = desc.to_string();
                                crate::logging::mcp_log_error(
                                    LOG_SCOPE,
                                    &format!("takeSnapshot returned NSError: {error_string}"),
                                );
                                let _ = tx.send(Err(ScreenshotError::CaptureFailed(error_string)));
                            } else if !image.is_null() {
                                let img = &*image;
                                // Convert NSImage to PNG data
                                match convert_nsimage_to_png(img) {
                                    Ok(data) => {
                                        let _ = tx.send(Ok(Screenshot { data }));
                                    }
                                    Err(e) => {
                                        crate::logging::mcp_log_error(
                                            LOG_SCOPE,
                                            &format!("NSImage -> PNG conversion failed: {e}"),
                                        );
                                        let _ = tx.send(Err(e));
                                    }
                                }
                            } else {
                                crate::logging::mcp_log_error(
                                    LOG_SCOPE,
                                    "takeSnapshot completion handler received nil image and nil error",
                                );
                                let _ = tx.send(Err(ScreenshotError::CaptureFailed(
                                    "No image returned from snapshot".to_string(),
                                )));
                            }
                        }
                    });

                    // Take snapshot
                    wkwebview
                        .takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler);
                }
            })
            .map_err(|e| {
                crate::logging::mcp_log_error(
                    LOG_SCOPE,
                    &format!("with_webview failed before scheduling takeSnapshot: {e}"),
                );
                ScreenshotError::CaptureFailed(format!("Failed to access webview: {e}"))
            })?;

        // Wait for result
        match rx.recv_timeout(std::time::Duration::from_secs(10)) {
            Ok(result) => result,
            Err(_) => {
                crate::logging::mcp_log_error(
                    LOG_SCOPE,
                    "Timed out waiting 10s for takeSnapshot completion handler",
                );
                Err(ScreenshotError::Timeout)
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err(ScreenshotError::PlatformUnsupported)
    }
}

#[cfg(target_os = "macos")]
unsafe fn convert_nsimage_to_png(
    image: &objc2_app_kit::NSImage,
) -> Result<Vec<u8>, ScreenshotError> {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_foundation::NSDictionary;

    // Get TIFF representation
    let tiff_data = image.TIFFRepresentation().ok_or_else(|| {
        ScreenshotError::EncodeFailed("Failed to get TIFF representation".to_string())
    })?;

    // Create bitmap representation from TIFF data
    let bitmap = NSBitmapImageRep::imageRepWithData(&tiff_data).ok_or_else(|| {
        ScreenshotError::EncodeFailed("Failed to create bitmap representation".to_string())
    })?;

    // Convert to PNG
    let properties = NSDictionary::new();
    let png_data = bitmap
        .representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
        .ok_or_else(|| ScreenshotError::EncodeFailed("Failed to create PNG data".to_string()))?;

    // Convert NSData to Vec<u8>
    let length = png_data.len();
    let bytes = png_data.bytes();
    let data = std::slice::from_raw_parts(bytes.as_ptr(), length).to_vec();

    Ok(data)
}

struct CaptureDirectory(std::path::PathBuf);

impl Drop for CaptureDirectory {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.0) {
            crate::logging::mcp_log_error(
                LOG_SCOPE,
                &format!(
                    "Failed to remove private capture directory {:?}: {error}",
                    self.0
                ),
            );
        }
    }
}

/// Capture only the selected window through macOS, bypassing WebKit snapshots.
pub async fn capture_window<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<Screenshot, ScreenshotError> {
    use std::os::unix::fs::DirBuilderExt;
    use std::time::Duration;

    let unavailable = |reason: String| {
        ScreenshotError::CaptureFailed(format!(
            "macOS window capture unavailable: {reason}. Check Screen Recording access and window visibility"
        ))
    };
    if !has_screen_capture_access() {
        return Err(unavailable(
            "Screen Recording access is not granted (macOS 10.15 or later is required)".to_string(),
        ));
    }
    let window_id = window_number(window).map_err(|e| unavailable(e.to_string()))?;
    let directory =
        std::env::temp_dir().join(format!("tauri-mcp-capture-{}", uuid::Uuid::new_v4()));

    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(&directory)
        .map_err(|e| unavailable(e.to_string()))?;
    // Remove sensitive image bytes on success, error, timeout, or task cancellation.
    let directory = CaptureDirectory(directory);
    let image_path = directory.0.join("window.png");
    let output = tokio::time::timeout(
        Duration::from_secs(10),
        tokio::process::Command::new("/usr/sbin/screencapture")
            .args(["-x", "-o", "-a", "-t", "png", &format!("-l{window_id}")])
            .arg(&image_path)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| unavailable("OS capture timed out".to_string()))?
    .map_err(|e| unavailable(e.to_string()))?;

    if !output.status.success() {
        return Err(unavailable(format!(
            "screencapture exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    let data = tokio::fs::read(&image_path)
        .await
        .map_err(|e| unavailable(e.to_string()))?;

    image::load_from_memory_with_format(&data, image::ImageFormat::Png)
        .map_err(|e| unavailable(format!("Invalid OS capture image: {e}")))?;

    Ok(Screenshot { data })
}

fn has_screen_capture_access() -> bool {
    use std::ffi::{c_char, c_void};

    extern "C" {
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }

    // Resolve at runtime so older macOS versions can still load the bridge.
    const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;
    let symbol = unsafe {
        dlsym(
            RTLD_DEFAULT,
            b"CGPreflightScreenCaptureAccess\0".as_ptr().cast(),
        )
    };

    if symbol.is_null() {
        return false;
    }

    let preflight: unsafe extern "C" fn() -> bool = unsafe { std::mem::transmute(symbol) };

    unsafe { preflight() }
}

fn window_number<R: Runtime>(window: &WebviewWindow<R>) -> Result<u32, ScreenshotError> {
    use objc2_web_kit::WKWebView;
    use std::sync::mpsc;

    let (tx, rx) = mpsc::channel();

    window
        .with_webview(move |webview| unsafe {
            let wkwebview = &*(webview.inner() as *const _ as *const WKWebView);
            let native_window: *mut objc2::runtime::AnyObject = objc2::msg_send![wkwebview, window];
            let number: isize = if native_window.is_null() {
                0
            } else {
                objc2::msg_send![native_window, windowNumber]
            };

            let _ = tx.send(number);
        })
        .map_err(|e| ScreenshotError::CaptureFailed(e.to_string()))?;

    let number = rx
        .recv_timeout(std::time::Duration::from_secs(2))
        .map_err(|_| ScreenshotError::Timeout)?;

    u32::try_from(number)
        .ok()
        .filter(|number| *number > 0)
        .ok_or_else(|| ScreenshotError::CaptureFailed("No native window ID available".to_string()))
}

#[cfg(test)]
mod tests {
    use super::CaptureDirectory;

    #[test]
    fn removes_temporary_image_when_capture_scope_exits() {
        let path = std::env::temp_dir().join(format!("tauri-mcp-cleanup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("window.png"), b"private capture bytes").unwrap();

        {
            let _directory = CaptureDirectory(path.clone());
        }

        assert!(!path.exists());
    }
}
