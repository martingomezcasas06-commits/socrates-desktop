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

/// Capture the primary monitor and return it as a base64-encoded PNG string.
#[tauri::command]
fn capture_screen() -> Result<String, String> {
    let monitors = Monitor::all().map_err(|e| format!("monitor error: {e}"))?;
    // Prefer the primary monitor; fall back to the first one.
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or_else(|| "no monitor found".to_string())?;

    let image = monitor
        .capture_image()
        .map_err(|e| format!("capture error: {e}"))?;

    let mut buf = Cursor::new(Vec::new());
    image
        .write_to(&mut buf, image::ImageFormat::Png)
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

    match action.as_str() {
        "click" => {
            let (px, py) = (x.ok_or("missing x")?, y.ok_or("missing y")?);
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
                    .move_mouse(px, py, Coordinate::Abs)
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
