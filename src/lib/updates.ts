// Auto-update for the desktop app.
//
// Updates are served from the GitHub Release that the `release` workflow publishes:
// each release carries a `latest.json` manifest listing the per-platform bundles and
// their minisign signatures. Tauri verifies every download against the public key in
// tauri.conf.json, so a tampered artifact is rejected before it is installed.
//
// Dynamic imports throughout: the same source also builds for the browser, where the
// Tauri plugins do not exist.

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type UpdateState =
  | { status: "idle" }
  | { status: "downloading"; version: string; percent: number }
  | { status: "ready"; version: string }
  | { status: "error"; message: string };

/**
 * Check for a newer release and, if there is one, download and install it.
 * Resolves once the update is staged; the app must relaunch to run it.
 * Never throws — a failed update check must not stop the app from starting.
 */
export async function checkAndInstall(onState: (s: UpdateState) => void): Promise<void> {
  if (!IS_TAURI) return;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return;

    let total = 0;
    let received = 0;
    onState({ status: "downloading", version: update.version, percent: 0 });

    await update.downloadAndInstall((e) => {
      if (e.event === "Started") {
        total = e.data.contentLength ?? 0;
      } else if (e.event === "Progress") {
        received += e.data.chunkLength;
        onState({
          status: "downloading",
          version: update.version,
          percent: total ? Math.round((received * 100) / total) : 0,
        });
      }
    });

    onState({ status: "ready", version: update.version });
  } catch (e) {
    // Offline, rate-limited, or no release yet — all normal, none of them fatal.
    onState({ status: "error", message: String(e) });
  }
}

/** Relaunch into the freshly installed version. */
export async function restartIntoUpdate(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
