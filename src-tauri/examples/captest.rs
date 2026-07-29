// Standalone check of the SAME capture path the app uses (xcap → downscale → JPEG).
// Run with:  cargo run --release --example captest
// (lives in examples/, NOT src/bin/ — an extra [[bin]] target makes the Tauri
//  bundler package the wrong executable and the app silently fails to launch.)
use base64::{engine::general_purpose, Engine as _};
use std::io::Cursor;
use xcap::Monitor;

fn main() {
    let monitors = match Monitor::all() { Ok(m) => m, Err(e) => { println!("MONITOR ERROR: {e}"); return; } };
    println!("monitors found: {}", monitors.len());
    let monitor = match monitors.iter().find(|m| m.is_primary().unwrap_or(false)).or_else(|| monitors.first()) {
        Some(m) => m, None => { println!("NO MONITOR"); return; }
    };
    println!("primary: {}x{}", monitor.width().unwrap_or(0), monitor.height().unwrap_or(0));
    let rgba = match monitor.capture_image() { Ok(i) => i, Err(e) => { println!("CAPTURE ERROR: {e}"); return; } };
    let dynamic = image::DynamicImage::ImageRgba8(rgba);
    let (w, h) = (dynamic.width(), dynamic.height());
    println!("captured: {w}x{h}");
    let resized = if w.max(h) > 1366 {
        let s = 1366.0 / w.max(h) as f32;
        dynamic.resize((w as f32 * s) as u32, (h as f32 * s) as u32, image::imageops::FilterType::Triangle)
    } else { dynamic };
    let rgb = resized.to_rgb8();
    // crude "is it just wallpaper" check: count distinct-ish colors
    let mut buckets = std::collections::HashSet::new();
    for p in rgb.pixels() { buckets.insert((p[0]/32, p[1]/32, p[2]/32)); }
    println!("distinct color buckets: {} (low = flat wallpaper, high = real windows)", buckets.len());
    let mut buf = Cursor::new(Vec::new());
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 75);
    enc.encode_image(&rgb).unwrap();
    let bytes = buf.into_inner();
    println!("jpeg bytes: {}", bytes.len());
    println!("base64 len: {}", general_purpose::STANDARD.encode(&bytes).len());
    std::fs::write("/tmp/captest.jpg", &bytes).unwrap();
    println!("wrote /tmp/captest.jpg");
}
