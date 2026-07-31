/**
 * Voice-call diagnostics.
 *
 * A release Tauri build has no devtools, so console.log is invisible — which is
 * how a broken voice engine went undiagnosed through several "fixes". This
 * writes to ~/Library/Logs/socrates-voice.log via the Rust side.
 */
const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function vlog(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  // eslint-disable-next-line no-console
  console.log(line);
  if (!IS_TAURI) return;
  import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("debug_log", { line }))
    .catch(() => { /* diagnostics must never break the call */ });
}
