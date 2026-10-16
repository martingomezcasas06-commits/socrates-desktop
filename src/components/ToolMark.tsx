/** A tool's two-letter mark (the Night design's `.mk`). Real logos live in My stack. */
function toolAbbr(name: string): string {
  const first = name.trim().split(/[\s.]+/)[0] ?? "";
  return (first.slice(0, 2) || "?").toUpperCase();
}

export default function ToolMark({ name, small }: { name: string; small?: boolean }) {
  return <span className={`mk${small ? " sm" : ""}`} aria-hidden="true">{toolAbbr(name)}</span>;
}
