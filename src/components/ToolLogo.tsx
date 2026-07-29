/**
 * Tool glyph with the real vendor logo (favicon), falling back to the first
 * letter (with the caller's gradient) when the tool is unknown or the icon
 * fails to load. Keeps the caller's CSS class so sizing/shape stay put.
 */
import { useState, type CSSProperties } from "react";
import { toolDomain, faviconUrl } from "../lib/toolLogos";

export default function ToolLogo({
  name,
  className,
  fallbackStyle,
}: {
  name: string;
  className: string;
  fallbackStyle?: CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  const domain = toolDomain(name);

  if (!domain || failed) {
    return <div className={className} style={fallbackStyle}>{name.slice(0, 1).toUpperCase()}</div>;
  }
  return (
    <div className={className} style={{ background: "#fff", border: "1px solid var(--rule)" }}>
      <img
        src={faviconUrl(domain)}
        alt={name}
        onError={() => setFailed(true)}
        style={{ width: "62%", height: "62%", objectFit: "contain", display: "block" }}
      />
    </div>
  );
}
