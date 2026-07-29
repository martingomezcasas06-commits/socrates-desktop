/**
 * Real logos for tool glyphs — vendor favicons via Google's favicon service.
 * Mirrors app/lib/tool-logos.ts on the web side. Unknown tools fall back to
 * the letter glyph.
 */

// Ordered — first match wins ("github copilot" must hit github before "copilot").
const DOMAIN_RULES: [RegExp, string][] = [
  [/claude/i, "claude.ai"],
  [/chatgpt|openai/i, "chatgpt.com"],
  [/github/i, "github.com"],
  [/copilot|microsoft/i, "copilot.microsoft.com"],
  [/notion/i, "notion.so"],
  [/perplexity/i, "perplexity.ai"],
  [/cursor/i, "cursor.com"],
  [/granola/i, "granola.ai"],
  [/otter/i, "otter.ai"],
  [/fireflies/i, "fireflies.ai"],
  [/superhuman/i, "superhuman.com"],
  [/grammarly/i, "grammarly.com"],
  [/jasper/i, "jasper.ai"],
  [/midjourney/i, "midjourney.com"],
  [/firefly|adobe/i, "firefly.adobe.com"],
  [/descript/i, "descript.com"],
  [/zapier/i, "zapier.com"],
  [/gamma/i, "gamma.app"],
  [/glean/i, "glean.com"],
  [/hebbia/i, "hebbia.com"],
  [/gemini|google ai/i, "gemini.google.com"],
  [/canva/i, "canva.com"],
  [/figma/i, "figma.com"],
  [/slack/i, "slack.com"],
];

export function toolDomain(name: string, url?: string | null): string | null {
  if (url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (host) return host;
    } catch { /* fall through to the name map */ }
  }
  for (const [re, domain] of DOMAIN_RULES) {
    if (re.test(name)) return domain;
  }
  return null;
}

export function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}
