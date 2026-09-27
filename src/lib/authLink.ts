/**
 * Sign-in links: socrates://auth/callback?code=… (PKCE), or ?error=… when the
 * provider refused. They arrive two ways — as an onOpenUrl event when the app is
 * running (macOS always; Windows via the single-instance plugin), and from
 * getCurrent() when the link itself launched the app — so the same link can be
 * reported twice, while a PKCE code can only be exchanged once.
 *
 * Kept free of Tauri and Supabase so it can be tested (authLink.test.ts). This
 * is the logic behind the Windows sign-in fix in 0.1.7.
 */

export type AuthLink =
  | { kind: "code"; code: string }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "no-code"; url: string }
  | { kind: "unparseable"; url: string; reason: string };

export function parseAuthLink(url: string | undefined | null): AuthLink {
  if (!url) return { kind: "empty" };
  try {
    // URL() won't parse a custom scheme's query reliably; give it one it will.
    const parsed = new URL(url.replace(/^socrates:\/\//, "https://socrates.app/"));
    const error = parsed.searchParams.get("error");
    if (error) return { kind: "error", message: parsed.searchParams.get("error_description") || error };
    const code = parsed.searchParams.get("code");
    return code ? { kind: "code", code } : { kind: "no-code", url };
  } catch (e) {
    return { kind: "unparseable", url, reason: String(e) };
  }
}

/** Returns true the first time it sees a code, false for every repeat. */
export function createCodeGate() {
  const seen = new Set<string>();
  return (code: string) => {
    if (seen.has(code)) return false;
    seen.add(code);
    return true;
  };
}
