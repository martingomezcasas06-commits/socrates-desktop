/** Sizes and the remembered collapse state of the Night call strip. */
// The companion strip: 288 wide, ~74px with its transcript line, ~42px
// collapsed. Its controls are collapse and end only, which is what lets the
// status and meta lines fit at 288.
export const COMPANION_W = 288;
export const companionHeight = (collapsed: boolean) => (collapsed ? 42 : 74);

const COLLAPSED_KEY = "socrates.companion.collapsed";
export function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
}
export function saveCollapsed(v: boolean) {
  try { localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0"); } catch { /* not kept */ }
}

