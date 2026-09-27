import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The call panel at its real window size, in every state. This is the check that
// was done by hand when the panel's mark was a hand-drawn Saturn and its title
// was cut off at 288px: text must fit, the panel must fit its window, and every
// word must be readable against the night ground.
//
// The markup mirrors statusHead in RealtimeVoiceSession.tsx. The first test
// fails if that component stops using these class names, so the mirror cannot
// silently drift from the real thing.

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const css = readFileSync(join(ROOT, "src/desktop.css"), "utf8");
const logo = readFileSync(join(ROOT, "public/socrates-logo.svg"), "utf8");
const voice = readFileSync(join(ROOT, "src/components/VoiceSession.tsx"), "utf8");
const [, W, H] = voice.match(/ORB_W = (\d+), ORB_H = (\d+)/)!.map(Number);
const component = readFileSync(join(ROOT, "src/components/RealtimeVoiceSession.tsx"), "utf8");

const STATES = [
  { name: "speaking", live: true, title: "Socrates is talking", meta: "04:12 · sharing screen", tone: "ok", cap: "Open the deal that has gone quiet. Read me its risk score out loud.", warn: "" },
  { name: "listening", live: true, title: "Listening", meta: "04:31 · your turn", tone: "ok", cap: "Take your time — I am reading along as you go.", warn: "" },
  { name: "connecting", live: false, title: "Starting your call…", meta: "starting up", tone: "ok", cap: "Starting your call…", warn: "" },
  { name: "screen-denied", live: false, title: "I can't see your screen", meta: "02:08 · audio only", tone: "warn", cap: "Tell me what's on it and we'll work from that.",
    warn: "Coaching works better if I can see it. Open System Settings ▸ Privacy & Security ▸ Screen Recording." },
];

function page(s: (typeof STATES)[number]) {
  const mark = `<span class="vo-mark${s.live ? " live" : ""}"><span class="planet" style="width:22px;height:22px"><img src="data:image/svg+xml;base64,${Buffer.from(logo).toString("base64")}" width="22" height="22" alt=""></span></span>`;
  return `<style>${css} html,body{margin:0}</style>
    <div id="win" style="width:${W}px;height:${H}px">
      <div class="voice-orb">
        <div class="vo-top">${mark}
          <span class="vo-status"><b class="vo-title">${s.title}</b><span class="vo-meta ${s.tone}">${s.meta}</span></span>
          ${s.live ? '<span class="vo-vu"><i></i><i></i><i></i><i></i><i></i><i></i></span>' : ""}
          <button class="vo-btn">◉</button><button class="vo-btn">▤</button><button class="vo-btn end">✕</button>
        </div>
        <div class="vo-cap"><p class="vo-cap-line">${s.cap}</p></div>
        ${s.warn ? `<div class="vo-warn">${s.warn}</div>` : ""}
      </div>
    </div>`;
}

const clipped = (p: Page, sel: string) =>
  p.locator(sel).evaluate((el) => el.scrollWidth > el.clientWidth + 1);

test("the mirrored markup still matches the real component", () => {
  for (const cls of ["vo-mark", "vo-status", "vo-title", "vo-meta", "vo-vu", "vo-btn", "vo-cap-line", "vo-warn", "voice-orb", "vo-top"]) {
    expect(component, `RealtimeVoiceSession.tsx no longer uses .${cls}`).toContain(cls);
  }
  expect(component).toContain("<PlanetOrb");
  expect(readFileSync(join(ROOT, "src/components/PlanetOrb.tsx"), "utf8")).toContain("/socrates-logo.svg");
});

for (const s of STATES) {
  test(`${s.name}: title and status line are shown in full`, async ({ page: p }) => {
    await p.setContent(page(s));
    expect(await clipped(p, ".vo-title"), `title "${s.title}" is truncated at ${W}px`).toBe(false);
    expect(await clipped(p, ".vo-meta"), `status "${s.meta}" is truncated at ${W}px`).toBe(false);
  });

  test(`${s.name}: everything fits inside the ${W}×${H} window`, async ({ page: p }) => {
    await p.setContent(page(s));
    const overflow = await p.locator(".voice-orb").evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow, "content is cut off at the bottom of the panel").toBeLessThanOrEqual(0);
  });

  test(`${s.name}: every word is readable on the night ground`, async ({ page: p }) => {
    await p.setContent(page(s));
    const low = await p.evaluate(() => {
      const parse = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[\s,/]+/).map(Number); return { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 }; };
      const lum = (c: { r: number; g: number; b: number }) => { const f = (x: number) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      const bg = parse(getComputedStyle(document.querySelector(".voice-orb")!).backgroundColor)!;
      const out: string[] = [];
      for (const el of document.querySelectorAll(".vo-title, .vo-meta, .vo-cap-line, .vo-warn")) {
        const fg = parse(getComputedStyle(el).color)!;
        const shown = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
        const [a, b] = [lum(shown), lum(bg)].sort((x, y) => y - x);
        const ratio = (a + 0.05) / (b + 0.05);
        if (ratio < 4.5) out.push(`${el.className}: ${ratio.toFixed(2)}:1`);
      }
      return out;
    });
    expect(low).toEqual([]);
  });
}
