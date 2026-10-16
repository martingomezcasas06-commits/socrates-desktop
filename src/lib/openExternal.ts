const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Open a URL in the system browser. Inside Tauri, a plain target="_blank" does nothing —
 *  the webview swallows it — so route through the shell plugin instead. */
export async function openExternal(url: string) {
  if (IS_TAURI) {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
      return;
    } catch { /* fall through to browser */ }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
