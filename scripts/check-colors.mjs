// Colour-literal ratchet.
//
// Every palette regression in the design-system migration was a raw colour
// that a sweep for KNOWN-bad values missed: an indigo hover, cream written as
// rgba decimals, an old accent in a halo. So this bans no list. It records the
// exact colour values each file uses today (scripts/color-literals.baseline.json)
// and fails when any file gains a value it did not have — including a token
// colour swapped for another at the same count. Use a token from app/tokens
// instead; if a raw value is genuinely needed (email HTML, canvas drawing),
// rerun with --update and commit the baseline, which makes it a reviewed change.
//
//   node scripts/check-colors.mjs            check
//   node scripts/check-colors.mjs --update   accept the current state
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOTS = (process.env.COLOR_ROOTS ?? "app,components,lib").split(",");
const EXEMPT_DIRS = (process.env.COLOR_TOKEN_DIRS ?? "app/tokens").split(",");
const BASELINE = process.env.COLOR_BASELINE ?? "scripts/color-literals.baseline.json";
const LITERAL = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;

const norm = (v) => v.toLowerCase().replace(/\s+/g, "");

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (["node_modules", ".next", "dist", "target"].includes(f)) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|tsx?|jsx?)$/.test(f)) out.push(p);
  }
  return out;
}

const current = {};
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (EXEMPT_DIRS.some((d) => file.startsWith(d + "/"))) continue;
    const src = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "") // CSS/JS block comments
      .replace(/^\s*\/\/.*$/gm, "")      // JS line comments
      .replace(/&#\d+;/g, "");            // HTML entities are not colours
    const found = (src.match(LITERAL) ?? []).map(norm);
    if (found.length) current[file] = found.sort();
  }
}

if (process.argv.includes("--update")) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n");
  console.log(`Baseline written: ${Object.keys(current).length} files.`);
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
const problems = [];
for (const [file, values] of Object.entries(current)) {
  const allowed = [...(baseline[file] ?? [])];
  for (const v of values) {
    const i = allowed.indexOf(v);
    if (i === -1) problems.push(`${file}: new colour literal ${v}`);
    else allowed.splice(i, 1);
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} colour literal(s) outside the tokens. Use a token instead, or --update after review.`);
  process.exit(1);
}
const total = Object.values(current).flat().length;
console.log(`Colours OK: ${total} reviewed literals across ${Object.keys(current).length} files, none new.`);
