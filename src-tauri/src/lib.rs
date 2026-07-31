// Socrates desktop — native backend
//
// Exposes two commands to the frontend:
//   capture_screen  — grabs the primary monitor as a base64 PNG
//   execute_action  — performs a mouse/keyboard action via enigo (computer use)

use base64::{engine::general_purpose, Engine as _};
use enigo::{
    Axis, Button, Coordinate,
    Direction::{Click, Press, Release},
    Enigo, Key, Keyboard, Mouse, Settings,
};
use std::io::Cursor;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};
use xcap::Monitor;

/// Longest screenshot side sent to the vision model (shared by capture + coord scaling).
const MAX_SIDE: u32 = 1366;

// macOS Screen Recording permission (CoreGraphics). Without it, screen captures come back
// as just the desktop wallpaper with no windows — so we check and prompt explicitly.
#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// Whether the app currently has macOS Screen Recording permission.
#[tauri::command]
fn screen_recording_allowed() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { CGPreflightScreenCaptureAccess() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Trigger the macOS Screen Recording permission prompt (and register the app in the list).
#[tauri::command]
fn request_screen_recording() {
    #[cfg(target_os = "macos")]
    unsafe {
        let _ = CGRequestScreenCaptureAccess();
    }
}

/// The primary monitor (falls back to the first).
fn primary_monitor() -> Result<Monitor, String> {
    let monitors = Monitor::all().map_err(|e| format!("monitor error: {e}"))?;
    monitors
        .into_iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| Monitor::all().ok().and_then(|mut v| v.drain(..).next()))
        .ok_or_else(|| "no monitor found".to_string())
}

/// Ratio that converts a coordinate in the *downscaled screenshot* (what the vision
/// model sees) into a *logical point* (what enigo moves the cursor in).
///
/// xcap captures physical pixels; we downscale to MAX_SIDE; the model returns coords
/// in that downscaled space. enigo uses logical points (= physical / backing scale,
/// e.g. ÷2 on Retina). So: logical = downscaled × (logicalSize / downscaledSize),
/// which reduces to 1 / (scale_factor × downscale_factor).
fn coord_ratio(m: &Monitor) -> f32 {
    let pw = m.width().unwrap_or(0) as f32;
    let ph = m.height().unwrap_or(0) as f32;
    let scale = m.scale_factor().unwrap_or(1.0);
    let max_side = pw.max(ph);
    let downscale = if max_side > MAX_SIDE as f32 { MAX_SIDE as f32 / max_side } else { 1.0 };
    if scale <= 0.0 || downscale <= 0.0 { 1.0 } else { 1.0 / (scale * downscale) }
}

/// Capture the primary monitor, downscale it, and return it as a base64 JPEG.
///
/// Full-resolution PNG screenshots (esp. on Retina/4K) exceed Vercel's 4.5 MB
/// request limit and upload slowly. We cap the longest side at 1366 px and
/// encode as JPEG (q75): ~150-400 KB instead of multiple MB, with text still
/// perfectly legible for the vision model.
#[tauri::command]
fn capture_screen() -> Result<String, String> {
    let monitors = Monitor::all().map_err(|e| format!("monitor error: {e}"))?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or_else(|| "no monitor found".to_string())?;

    let rgba = monitor
        .capture_image()
        .map_err(|e| format!("capture error: {e}"))?;

    let dynamic = image::DynamicImage::ImageRgba8(rgba);
    let (w, h) = (dynamic.width(), dynamic.height());
    let resized = if w.max(h) > MAX_SIDE {
        let scale = MAX_SIDE as f32 / w.max(h) as f32;
        dynamic.resize(
            (w as f32 * scale) as u32,
            (h as f32 * scale) as u32,
            image::imageops::FilterType::Triangle,
        )
    } else {
        dynamic
    };

    // JPEG has no alpha channel — convert RGBA → RGB first.
    let rgb = resized.to_rgb8();
    let mut buf = Cursor::new(Vec::new());
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 75);
    encoder
        .encode_image(&rgb)
        .map_err(|e| format!("encode error: {e}"))?;

    Ok(general_purpose::STANDARD.encode(buf.into_inner()))
}

/// Execute a single computer-use action on the real screen.
///
/// action: "click" | "type" | "scroll"
/// x, y:   pixel coordinates (for click / scroll)
/// text:   text to type (for type)
/// scroll_direction: "up" | "down"
#[tauri::command]
fn execute_action(
    action: String,
    x: Option<i32>,
    y: Option<i32>,
    text: Option<String>,
    scroll_direction: Option<String>,
) -> Result<String, String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo init: {e}"))?;

    // Convert the model's downscaled-screenshot coords into logical points for enigo.
    let ratio = primary_monitor().map(|m| coord_ratio(&m)).unwrap_or(1.0);
    let conv = |v: i32| (v as f32 * ratio).round() as i32;

    match action.as_str() {
        "click" => {
            let (px, py) = (conv(x.ok_or("missing x")?), conv(y.ok_or("missing y")?));
            enigo
                .move_mouse(px, py, Coordinate::Abs)
                .map_err(|e| format!("move: {e}"))?;
            enigo
                .button(Button::Left, Click)
                .map_err(|e| format!("click: {e}"))?;
            Ok(format!("clicked at ({px}, {py})"))
        }
        "type" => {
            let t = text.ok_or("missing text")?;
            enigo.text(&t).map_err(|e| format!("type: {e}"))?;
            Ok(format!("typed: {t}"))
        }
        "scroll" => {
            let dir = scroll_direction.unwrap_or_else(|| "down".to_string());
            if let (Some(px), Some(py)) = (x, y) {
                enigo
                    .move_mouse(conv(px), conv(py), Coordinate::Abs)
                    .map_err(|e| format!("move: {e}"))?;
            }
            let amount = if dir == "up" { -3 } else { 3 };
            enigo
                .scroll(amount, Axis::Vertical)
                .map_err(|e| format!("scroll: {e}"))?;
            Ok(format!("scrolled {dir}"))
        }
        "key" => {
            // Optional: press a single named key like "enter" or "escape"
            let t = text.unwrap_or_default();
            let key = match t.to_lowercase().as_str() {
                "enter" | "return" => Key::Return,
                "escape" | "esc" => Key::Escape,
                "tab" => Key::Tab,
                "backspace" => Key::Backspace,
                _ => return Err(format!("unknown key: {t}")),
            };
            enigo.key(key, Press).map_err(|e| format!("press: {e}"))?;
            enigo.key(key, Release).map_err(|e| format!("release: {e}"))?;
            Ok(format!("pressed {t}"))
        }
        other => Err(format!("unknown action: {other}")),
    }
}

/// Configure the (panel-ified) main window to float **over another app's native-fullscreen
/// Space** as a non-activating overlay — or restore it to a normal window.
///
/// A plain NSWindow can't draw over another app's fullscreen even with `fullScreenAuxiliary`,
/// because showing/focusing it activates our app and switches away from the fullscreen Space.
/// The window is converted to a non-activating NSPanel (see `to_panel` in setup); here we set
/// the level, collection behaviour and style mask so it appears in place without stealing focus.
#[cfg(target_os = "macos")]
fn overlay_panel(app: &AppHandle, enable: bool, width: Option<f64>, height: Option<f64>) {
    use tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior as CB;
    use tauri_nspanel::ManagerExt;
    let Ok(panel) = app.get_webview_panel("main") else { return };
    // NSWindowStyleMask: Titled(1) | Closable(2) | Miniaturizable(4) | Resizable(8) | NonactivatingPanel(128)
    if enable {
        panel.set_style_mask(1 | 2 | 8 | 128);
        panel.set_level(1000); // NSScreenSaverWindowLevel — above a fullscreen app's content
        panel.set_collection_behaviour(
            CB::NSWindowCollectionBehaviorCanJoinAllSpaces
                | CB::NSWindowCollectionBehaviorFullScreenAuxiliary
                | CB::NSWindowCollectionBehaviorStationary,
        );
        panel.set_floating_panel(true);
        panel.set_hides_on_deactivate(false);
        // Size the panel directly — JS setSize is ignored once the window is an NSPanel.
        // Caller-supplied size (e.g. the tiny voice orb) or the default text companion.
        panel.set_content_size(width.unwrap_or(440.0), height.unwrap_or(680.0));
        if let Some(win) = app.get_webview_window("main") {
            position_companion(&win, None);
        }
        panel.show(); // order_front_regardless — appears without activating the app
    } else {
        panel.set_style_mask(1 | 2 | 4 | 8); // normal window chrome
        panel.set_level(0);
        panel.set_collection_behaviour(CB::empty());
        panel.set_floating_panel(false);
        panel.set_content_size(980.0, 700.0);
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.center();
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn overlay_panel(app: &AppHandle, enable: bool, _width: Option<f64>, _height: Option<f64>) {
    // Windows/Linux have no macOS-style fullscreen Spaces, so a plain always-on-top window
    // already floats over borderless-fullscreen apps (browsers, web tools). Set it directly.
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(enable);
        let _ = win.set_visible_on_all_workspaces(enable);
    }
}

/// Frontend hook (enterFloating/exitFloating, voice orb) to toggle the overlay.
/// Optional width/height set the floating size (the voice orb is much smaller).
#[tauri::command]
fn set_fullscreen_overlay(app: AppHandle, enable: bool, width: Option<f64>, height: Option<f64>) {
    overlay_panel(&app, enable, width, height);
}

/// Perform the realtime WebRTC offer/answer exchange natively.
///
/// The webview cannot do this itself: posting the SDP offer to api.openai.com
/// from origin `tauri://localhost` is cross-origin, and WKWebView drops it with
/// only "TypeError: Load failed" — which made every realtime call fail and fall
/// back to the old voice engine. Doing it from Rust has no CORS at all.
#[tauri::command]
async fn realtime_sdp(secret: String, model: String, offer: String) -> Result<String, String> {
    let url = format!("https://api.openai.com/v1/realtime/calls?model={model}");
    let res = reqwest::Client::new()
        .post(url)
        .header("Authorization", format!("Bearer {secret}"))
        .header("Content-Type", "application/sdp")
        .body(offer)
        .send()
        .await
        .map_err(|e| format!("sdp request failed: {e}"))?;
    let status = res.status();
    let body = res.text().await.map_err(|e| format!("sdp read failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("sdp {}: {}", status, body.chars().take(200).collect::<String>()));
    }
    Ok(body)
}

/// Append a line to ~/Library/Logs/socrates-voice.log.
///
/// A release Tauri build has no devtools, so a webview `console.log` goes
/// nowhere — which is exactly why voice-call bugs kept being diagnosed by
/// guesswork. This gives the voice session somewhere real to write.
#[tauri::command]
fn debug_log(line: String) {
    use std::io::Write;
    let Some(home) = std::env::var_os("HOME") else { return };
    let mut path = std::path::PathBuf::from(home);
    path.push("Library/Logs");
    let _ = std::fs::create_dir_all(&path);
    path.push("socrates-voice.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{line}");
    }
}

/// Park the companion window top-right, just under the menu bar, near the tray icon.
/// Horizontally centred on the click point when we have one; clamped to the screen.
fn position_companion(win: &WebviewWindow, anchor: Option<PhysicalPosition<f64>>) {
    if let Ok(Some(monitor)) = win.current_monitor() {
        let msize: &PhysicalSize<u32> = monitor.size();
        let mpos: &PhysicalPosition<i32> = monitor.position();
        let scale = monitor.scale_factor();
        let wsize = win.outer_size().unwrap_or(PhysicalSize {
            width: (440.0 * scale) as u32,
            height: (680.0 * scale) as u32,
        });
        let margin = (12.0 * scale) as i32;
        let menubar = (30.0 * scale) as i32;
        let max_x = mpos.x + msize.width as i32 - wsize.width as i32 - margin;
        let min_x = mpos.x + margin;
        let mut x = match anchor {
            Some(p) => p.x as i32 - wsize.width as i32 / 2,
            None => max_x,
        };
        x = x.clamp(min_x, max_x.max(min_x));
        let y = mpos.y + menubar;
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }
}

/// Show / hide the Socrates companion from the menu-bar icon. When shown it floats
/// above everything (incl. fullscreen apps) so it can coach without being buried.
fn toggle_companion(app: &AppHandle, anchor: Option<PhysicalPosition<f64>>) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    if win.is_visible().unwrap_or(false) {
        // Already up → tuck it away (panel order_out keeps it non-activating).
        #[cfg(target_os = "macos")]
        {
            use tauri_nspanel::ManagerExt;
            if let Ok(panel) = app.get_webview_panel("main") {
                panel.order_out(None);
                return;
            }
        }
        let _ = win.hide();
        return;
    }
    // Show as a compact floating companion, top-right, over everything (incl. fullscreen).
    let _ = win.set_size(LogicalSize::new(440.0, 680.0));
    position_companion(&win, anchor);
    overlay_panel(app, true, None, None);
}

/// Bring the full app window back to the front — used when the dock icon is clicked
/// (Reopen) or after the window was hidden. Drops any leftover coaching-overlay
/// level/style so it behaves like an ordinary window again, then shows + focuses it.
fn show_main(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    overlay_panel(app, false, None, None); // restore normal chrome/level + 980x700
    let _ = win.set_size(LogicalSize::new(980.0, 700.0));
    let _ = win.center();
    let _ = win.show();
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;
        if let Ok(panel) = app.get_webview_panel("main") {
            panel.show(); // order_front_regardless — actually raise the panel
        }
    }
    let _ = win.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init());

    // The non-activating-panel overlay is macOS-only (tauri-nspanel); skip on Windows/Linux.
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .invoke_handler(tauri::generate_handler![
            capture_screen,
            execute_action,
            set_fullscreen_overlay,
            screen_recording_allowed,
            debug_log,
            realtime_sdp,
            request_screen_recording
        ])
        .on_window_event(|window, event| {
            // Red close button: don't DESTROY the window (that left the app running
            // but inaccessible — you had to force-quit). Hide it instead; the dock
            // icon or the menu-bar icon brings it back. Quit via ⌘Q or the tray.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle();
                #[cfg(target_os = "macos")]
                {
                    use tauri_nspanel::ManagerExt;
                    if let Ok(panel) = app.get_webview_panel("main") {
                        panel.order_out(None);
                        return;
                    }
                }
                let _ = window.hide();
                let _ = app;
            }
        })
        .setup(|app| {
            // Convert the main window into a non-activating NSPanel so it can overlay other
            // apps' fullscreen Spaces during coaching. By default it behaves like a normal
            // window (overlay level/behaviour are only applied while a session is active).
            #[cfg(target_os = "macos")]
            {
                use tauri_nspanel::WebviewWindowExt;
                if let Some(win) = app.get_webview_window("main") {
                    if let Ok(panel) = win.to_panel() {
                        // NSPanel defaults to hiding on app deactivation — keep it visible.
                        panel.set_hides_on_deactivate(false);
                    }
                }
                // Register the app in the Screen Recording list / prompt on first launch.
                unsafe {
                    let _ = CGRequestScreenCaptureAccess();
                }
            }

            // Menu-bar (tray) companion — always reachable, even over fullscreen apps.
            let toggle = MenuItem::with_id(app, "toggle", "Show / Hide Socrates", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Socrates", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &quit])?;
            let icon = Image::from_bytes(include_bytes!("../icons/tray@2x.png"))?;

            TrayIconBuilder::with_id("socrates-tray")
                .icon(icon)
                .icon_as_template(true)
                .tooltip("Socrates — click to open your coach")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle_companion(app, None),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } = event
                    {
                        toggle_companion(tray.app_handle(), Some(position));
                    }
                })
                .build(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Socrates")
        .run(|app_handle, event| {
            // macOS fires Reopen when you click the dock icon (or relaunch) while the
            // app is already running. Bring the window back instead of doing nothing.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = &event {
                show_main(app_handle);
            }
            let _ = (app_handle, &event);
        });
}
