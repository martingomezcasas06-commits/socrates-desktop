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
use xcap::Monitor;

/// Longest screenshot side sent to the vision model (shared by capture + coord scaling).
const MAX_SIDE: u32 = 1366;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![capture_screen, execute_action])
        .run(tauri::generate_context!())
        .expect("error while running Socrates");
}
