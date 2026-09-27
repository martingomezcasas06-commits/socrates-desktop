import { describe, it, expect } from "vitest";
import { parseAuthLink, createCodeGate } from "./authLink";

// The Windows sign-in bug (fixed in 0.1.7): links arrive by two routes and a
// PKCE code exchanges only once. These pin the parsing and the once-only gate.

describe("parseAuthLink", () => {
  it("extracts the PKCE code from a magic-link or OAuth callback", () => {
    expect(parseAuthLink("socrates://auth/callback?code=abc-123")).toEqual({ kind: "code", code: "abc-123" });
  });

  it("surfaces the provider's error description", () => {
    expect(parseAuthLink("socrates://auth/callback?error=access_denied&error_description=User%20cancelled"))
      .toEqual({ kind: "error", message: "User cancelled" });
  });

  it("falls back to the error code when there is no description", () => {
    expect(parseAuthLink("socrates://auth/callback?error=server_error")).toEqual({ kind: "error", message: "server_error" });
  });

  it("reports a link without a code instead of silently doing nothing", () => {
    expect(parseAuthLink("socrates://auth/callback").kind).toBe("no-code");
  });

  it.each([undefined, null, ""])("treats %j as empty", (u) => {
    expect(parseAuthLink(u).kind).toBe("empty");
  });

  it("handles the Windows form, where the link arrives as a command-line argument", () => {
    // Windows hands the second process the raw URL, sometimes with a trailing slash.
    expect(parseAuthLink("socrates://auth/callback/?code=xyz")).toEqual({ kind: "code", code: "xyz" });
  });
});

describe("createCodeGate", () => {
  it("lets each code through exactly once, however many routes report it", () => {
    const first = createCodeGate();
    expect(first("abc")).toBe(true);
    expect(first("abc")).toBe(false); // getCurrent() and onOpenUrl both fired
    expect(first("def")).toBe(true);  // a later, different sign-in still works
  });
});
