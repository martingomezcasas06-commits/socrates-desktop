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
    coord_ratio_for(m.width().unwrap_or(0), m.height().unwrap_or(0), m.scale_factor().unwrap_or(1.0), MAX_SIDE)
}

/// The arithmetic behind `coord_ratio`, separated from the monitor so it can be
/// tested. `physical_*` is the capture size, `scale` the backing scale factor.
///
/// NOTE (suspected, untested on Windows): dividing by `scale` targets logical
/// points, which is what enigo uses on macOS. If enigo takes physical pixels on
/// Windows (a per-monitor-DPI-aware process), clicks on a 125%/150% display land
/// at 80%/67% of the intended position. See B12 in docs/testing-plan.md.
fn coord_ratio_for(physical_w: u32, physical_h: u32, scale: f32, max_side: u32) -> f32 {
    let longest = physical_w.max(physical_h) as f32;
    let downscale = if longest > max_side as f32 { max_side as f32 / longest } else { 1.0 };
    if scale <= 0.0 || downscale <= 0.0 { 1.0 } else { 1.0 / (scale * downscale) }
}

/// Size a capture is downscaled to before it is sent: longest side at most `max_side`.
fn downscaled_size(w: u32, h: u32, max_side: u32) -> (u32, u32) {
    if w.max(h) <= max_side {
        return (w, h);
    }
    let k = max_side as f32 / w.max(h) as f32;
    ((w as f32 * k) as u32, (h as f32 * k) as u32)
}

/// Capture the primary monitor, downscale it, and return it as a base64 JPEG.
///
/// Full-resolution PNG screenshots (esp. on Retina/4K) exceed Vercel's 4.5 MB
/// request limit and upload slowly. We cap the longest side at 1366 px and
/// encode as JPEG (q75): ~150-400 KB instead of multiple MB, with text still
/// perfectly legible for the vision model.
/// `max_side` / `quality` are optional and default to the HTTP-route values.
///
/// The realtime voice call needs a MUCH smaller frame: it pushes screenshots over
/// a WebRTC data channel, which refuses any single message over ~256 KB. A
/// 1366px q75 capture is 150-400 KB, so base64 (+33%) blew straight past the
/// limit and `send()` threw — silently — meaning the model never once received a
/// screenshot even with Screen Recording fully granted.
#[tauri::command]
fn capture_screen(max_side: Option<u32>, quality: Option<u8>) -> Result<String, String> {
    let max_side = max_side.unwrap_or(MAX_SIDE);
    let quality = quality.unwrap_or(75);

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
    let resized = if w.max(h) > max_side {
        let (nw, nh) = downscaled_size(w, h, max_side);
        dynamic.resize(nw, nh, image::imageops::FilterType::Triangle)
    } else {
        dynamic
    };

    // JPEG has no alpha channel — convert RGBA → RGB first.
    let rgb = resized.to_rgb8();
    let mut buf = Cursor::new(Vec::new());
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
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

/// Apply / remove `WS_EX_NOACTIVATE` on the main window (Windows only).
///
/// macOS's non-activating NSPanel floats over another app WITHOUT activating Socrates,
/// yet can still take keystrokes. Windows has no single equivalent: a plain always-on-top
/// window activates the moment it is clicked, which yanks focus out of the very app the
/// person is being coached in. `WS_EX_NOACTIVATE` fixes that, but it also makes the window
/// permanently unfocusable — so it is opt-in, used for surfaces with no text input (the
/// voice orb) and skipped for the typeable coaching companion.
/// `WS_EX_TOOLWINDOW` additionally keeps the overlay out of the taskbar and Alt-Tab.
#[cfg(target_os = "windows")]
fn set_noactivate(win: &WebviewWindow, enable: bool) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };
    let Ok(raw) = win.hwnd() else { return };
    // Cast via isize so this compiles whichever `windows`-crate HWND representation
    // (pointer or integer) the linked Tauri version happens to use.
    let hwnd = raw.0 as isize as *mut core::ffi::c_void;
    let flags = (WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW) as isize;
    unsafe {
        let cur = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let next = if enable { cur | flags } else { cur & !flags };
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
    }
}

/// The main window is an ordinary 1120x700 window (never smaller than 960x640).
/// Only the coaching companion floats, and only while a session is running.
const MAIN_W: f64 = 1120.0;
const MAIN_H: f64 = 700.0;
const MIN_W: f64 = 960.0;
const MIN_H: f64 = 640.0;

/// Whether the companion overlay is up (a coaching session is running). The
/// menu-bar icon must not resize or re-dock the window mid-session.
static OVERLAY_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// The companion is far smaller than the main window's minimum, so lift the
/// minimum while it floats and put it back afterwards.
fn set_main_min_size(app: &AppHandle, floating: bool) {
    if let Some(win) = app.get_webview_window("main") {
        let min = if floating { None } else { Some(LogicalSize::new(MIN_W, MIN_H)) };
        let _ = win.set_min_size(min);
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
fn overlay_panel(
    app: &AppHandle,
    enable: bool,
    width: Option<f64>,
    height: Option<f64>,
    _no_activate: bool,
) {
    use tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior as CB;
    use tauri_nspanel::ManagerExt;
    let Ok(panel) = app.get_webview_panel("main") else { return };
    OVERLAY_ACTIVE.store(enable, std::sync::atomic::Ordering::SeqCst);
    set_main_min_size(app, enable);
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
        panel.set_content_size(MAIN_W, MAIN_H);
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.center();
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn overlay_panel(
    app: &AppHandle,
    enable: bool,
    width: Option<f64>,
    height: Option<f64>,
    no_activate: bool,
) {
    // No fullscreen Spaces here, so always-on-top is enough to float over borderless-
    // fullscreen apps. Two things this used to miss: the caller's size was ignored (so the
    // tiny voice orb stayed a full-size window), and clicking the overlay stole focus from
    // the app being taught.
    let Some(win) = app.get_webview_window("main") else { return };
    OVERLAY_ACTIVE.store(enable, std::sync::atomic::Ordering::SeqCst);
    set_main_min_size(app, enable);
    let _ = win.set_always_on_top(enable);
    let _ = win.set_visible_on_all_workspaces(enable);

    #[cfg(target_os = "windows")]
    set_noactivate(&win, enable && no_activate);
    #[cfg(not(target_os = "windows"))]
    let _ = no_activate;

    if enable {
        let _ = win.set_size(LogicalSize::new(
            width.unwrap_or(440.0),
            height.unwrap_or(680.0),
        ));
        position_companion(&win, None);
    } else {
        let _ = win.set_size(LogicalSize::new(MAIN_W, MAIN_H));
        let _ = win.center();
    }
}

/// Frontend hook (enterFloating/exitFloating, voice orb) to toggle the overlay.
/// Optional width/height set the floating size (the voice orb is much smaller).
#[tauri::command]
fn set_fullscreen_overlay(
    app: AppHandle,
    enable: bool,
    width: Option<f64>,
    height: Option<f64>,
    no_activate: Option<bool>,
) {
    // Defaults to false so an overlay stays clickable/typeable unless the caller opts out.
    overlay_panel(&app, enable, width, height, no_activate.unwrap_or(false));
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

/// Where the voice log and the capture probe are written.
///
/// This used to be hardcoded to `$HOME/Library/Logs`. Windows does not set `HOME`
/// (it uses `USERPROFILE`), so the lookup returned `None` and every voice-session log
/// line was silently dropped — the exact diagnostics needed to debug voice on Windows.
/// macOS keeps its historic path; everything else uses Tauri's per-app log dir
/// (`%APPDATA%\app.socrates.desktop\logs` on Windows).
fn log_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        let home = std::env::var_os("HOME")?;
        let mut p = std::path::PathBuf::from(home);
        p.push("Library/Logs");
        let _ = std::fs::create_dir_all(&p);
        Some(p)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let p = app.path().app_log_dir().ok()?;
        let _ = std::fs::create_dir_all(&p);
        Some(p)
    }
}

/// Append a line to the voice log.
///
/// A release Tauri build has no devtools, so a webview `console.log` goes
/// nowhere — which is exactly why voice-call bugs kept being diagnosed by
/// guesswork. This gives the voice session somewhere real to write.
#[tauri::command]
fn debug_log(app: AppHandle, line: String) {
    use std::io::Write;
    let Some(mut path) = log_dir(&app) else { return };
    path.push("socrates-voice.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{line}");
    }
}

/// Write the current capture to ~/Library/Logs/socrates-probe.jpg so a human can
/// LOOK at what the app actually sees. "Can he see my screen?" was argued about
/// for days on inference alone; a denied capture on macOS returns the desktop
/// wallpaper with no error, which is indistinguishable from success unless you
/// open the file.
#[tauri::command]
fn save_capture_probe(app: AppHandle) -> Result<String, String> {
    let b64 = capture_screen(Some(1000), Some(60))?;
    let bytes = general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("decode error: {e}"))?;
    let mut path = log_dir(&app).ok_or_else(|| "no log directory".to_string())?;
    path.push("socrates-probe.jpg");
    std::fs::write(&path, bytes).map_err(|e| format!("write error: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Tray strings per UI language: (open, show/hide, quit, tooltip). The webview
/// owns the language choice and calls `set_tray_language` whenever it changes;
/// until then (first paint of the very first launch) the tray is English.
fn tray_labels(locale: &str) -> (&'static str, &'static str, &'static str, &'static str) {
    if locale.to_ascii_lowercase().starts_with("es") {
        (
            "Abrir Socrates",
            "Mostrar / ocultar Socrates",
            "Salir de Socrates",
            "Socrates: haz clic para abrir tu coach",
        )
    } else {
        (
            "Open Socrates",
            "Show / Hide Socrates",
            "Quit Socrates",
            "Socrates — click to open your coach",
        )
    }
}

/// The tray menu in a given language. Item ids stay the same across languages,
/// so the menu-event handler registered at startup keeps working after a swap.
fn tray_menu<R: tauri::Runtime, M: Manager<R>>(app: &M, locale: &str) -> tauri::Result<Menu<R>> {
    let (open_l, toggle_l, quit_l, _) = tray_labels(locale);
    // "Open" is not a duplicate of "toggle": toggle hides Socrates when it is
    // showing, whereas Open always brings the full window forward. Without it, a
    // Windows user who closes the window has no way back except the tray icon —
    // which Windows 11 hides in the overflow flyout by default.
    let open = MenuItem::with_id(app, "open", open_l, true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", toggle_l, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", quit_l, true, None::<&str>)?;
    Menu::with_items(app, &[&open, &toggle, &quit])
}

/// Relabel the tray menu and tooltip in the UI's language ("en" / "es").
#[tauri::command]
fn set_tray_language(app: AppHandle, locale: String) -> Result<(), String> {
    let tray = app
        .tray_by_id("socrates-tray")
        .ok_or_else(|| "tray not found".to_string())?;
    let menu = tray_menu(&app, &locale).map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(tray_labels(&locale).3))
        .map_err(|e| e.to_string())?;
    Ok(())
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
        // Only macOS reserves the top strip for a menu bar; on Windows/Linux that 30px
        // offset just pushed the panel down for no reason.
        let top_inset = if cfg!(target_os = "macos") { 30.0 } else { 10.0 };
        let menubar = (top_inset * scale) as i32;
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

/// The menu-bar icon shows or hides Socrates. The app itself is an ordinary
/// window; only the coaching call strip floats over other apps. If a call is
/// running, its strip is shown as it is (never resized or re-docked).
fn toggle_companion(app: &AppHandle, _anchor: Option<PhysicalPosition<f64>>) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    if win.is_visible().unwrap_or(false) {
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
    if OVERLAY_ACTIVE.load(std::sync::atomic::Ordering::SeqCst) {
        let _ = win.show();
        #[cfg(target_os = "macos")]
        {
            use tauri_nspanel::ManagerExt;
            if let Ok(panel) = app.get_webview_panel("main") {
                panel.show(); // order_front_regardless — appears without activating the app
            }
        }
        return;
    }
    show_main(app);
}

/// Bring the full app window back to the front — used when the dock icon is clicked
/// (Reopen) or after the window was hidden. Drops any leftover coaching-overlay
/// level/style so it behaves like an ordinary window again, then shows + focuses it.
fn show_main(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    // Mid-call (the strip is floating), just bring it forward: resetting it here
    // would turn a running call back into the full window.
    if OVERLAY_ACTIVE.load(std::sync::atomic::Ordering::SeqCst) {
        let _ = win.show();
        return;
    }
    overlay_panel(app, false, None, None, false); // restore normal chrome/level + 1120x700
    let _ = win.set_size(LogicalSize::new(MAIN_W, MAIN_H));
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

/// A second launch landed in this, the instance already running. On Windows that is
/// usually a sign-in link the OS opened by starting a new process; the single-instance
/// plugin has already re-emitted the link to the webview, so all that is left is to
/// bring the window forward. Deliberately NOT `show_main`: that resets size and the
/// overlay, and the person may be mid-call with the coaching panel floating.
#[cfg(not(target_os = "macos"))]
fn focus_existing(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Must be the first plugin registered, so a duplicate process exits before
    // anything else in it starts up.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        focus_existing(app);
    }));

    let builder = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

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
            request_screen_recording,
            save_capture_probe,
            set_tray_language
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
            // Built in English; the webview relabels it via set_tray_language as soon
            // as it knows the UI language (from its cache, before the first paint).
            let menu = tray_menu(app, "en")?;

            // macOS menu-bar icons are monochrome templates the OS inverts for light/dark.
            // Windows taskbars are dark by default, so that same black glyph is invisible —
            // use the full-colour app icon there.
            #[cfg(target_os = "macos")]
            let icon = Image::from_bytes(include_bytes!("../icons/tray@2x.png"))?;
            #[cfg(not(target_os = "macos"))]
            let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

            let tray = TrayIconBuilder::with_id("socrates-tray")
                .icon(icon)
                .tooltip(tray_labels("en").3)
                .menu(&menu)
                .show_menu_on_left_click(false);

            #[cfg(target_os = "macos")]
            let tray = tray.icon_as_template(true);

            tray
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_labels_follow_the_ui_language() {
        assert_eq!(tray_labels("es").0, "Abrir Socrates");
        assert_eq!(tray_labels("es-CO").2, "Salir de Socrates");
        assert_eq!(tray_labels("en").0, "Open Socrates");
        // Anything unsupported falls back to English rather than failing.
        assert_eq!(tray_labels("fr").2, "Quit Socrates");
    }

    /// Where a click the model aims at the centre of the screenshot actually lands.
    fn centre_lands_at(w: u32, h: u32, scale: f32) -> (f32, f32) {
        let (dw, dh) = downscaled_size(w, h, MAX_SIDE);
        let r = coord_ratio_for(w, h, scale, MAX_SIDE);
        (dw as f32 / 2.0 * r, dh as f32 / 2.0 * r)
    }

    #[test]
    fn captures_never_exceed_max_side() {
        for (w, h) in [(5120, 2880), (2880, 1800), (1920, 1080), (1080, 1920), (1366, 768), (800, 600)] {
            let (dw, dh) = downscaled_size(w, h, MAX_SIDE);
            assert!(dw.max(dh) <= MAX_SIDE, "{w}x{h} -> {dw}x{dh}");
            if w.max(h) <= MAX_SIDE { assert_eq!((dw, dh), (w, h), "small captures are left alone"); }
        }
    }

    #[test]
    fn aspect_ratio_survives_downscaling() {
        let (dw, dh) = downscaled_size(2880, 1800, MAX_SIDE);
        assert!(((dw as f32 / dh as f32) - 1.6).abs() < 0.01);
    }

    #[test]
    fn retina_mac_centre_click_hits_the_logical_centre() {
        // 2880x1800 physical at 2x = a 1440x900 point screen.
        let (x, y) = centre_lands_at(2880, 1800, 2.0);
        assert!((x - 720.0).abs() < 2.0 && (y - 450.0).abs() < 2.0, "({x}, {y})");
    }

    #[test]
    fn standard_1080p_centre_click_hits_the_centre() {
        let (x, y) = centre_lands_at(1920, 1080, 1.0);
        assert!((x - 960.0).abs() < 2.0 && (y - 540.0).abs() < 2.0, "({x}, {y})");
    }

    #[test]
    fn unscaled_small_screen_is_one_to_one() {
        assert_eq!(coord_ratio_for(1366, 768, 1.0, MAX_SIDE), 1.0);
    }

    #[test]
    fn nonsense_monitor_values_fall_back_to_one() {
        assert_eq!(coord_ratio_for(0, 0, 0.0, MAX_SIDE), 1.0);
    }
}
