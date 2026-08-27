/**
 * PlanetOrb — the living face of a voice call.
 *
 * A small Saturn (the brand mark) that reacts to the call: it breathes while
 * listening, spins its moon while thinking, and pulses in time with Socrates'
 * real voice while he speaks. Amplitude arrives as a `--amp` CSS variable
 * written straight to the DOM by the audio loop (never through React state —
 * this runs at 60fps and would otherwise re-render the whole panel).
 *
 * Every state also has a baseline CSS animation, so the orb still looks alive
 * if the browser hands us a silent analyser for the remote WebRTC track.
 */
import type { RefObject } from "react";

export type OrbStatus = "connecting" | "listening" | "speaking" | "thinking";

export default function PlanetOrb({
  status,
  size = 44,
  innerRef,
}: {
  status: OrbStatus;
  size?: number;
  innerRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={innerRef} className={`planet ${status}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <defs>
          <radialGradient id="po-sphere" cx="36%" cy="30%" r="78%">
            <stop offset="0%" stopColor="#8FD4E8" />
            <stop offset="55%" stopColor="#15637F" />
            <stop offset="100%" stopColor="#15637F" />
          </radialGradient>
          <radialGradient id="po-glow" cx="50%" cy="50%" r="50%">
            <stop offset="55%" stopColor="#4FB4D8" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#4FB4D8" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* soft halo — brightens with the voice */}
        <circle className="po-glow" cx="50" cy="50" r="46" fill="url(#po-glow)" />

        {/* ring: back half, then planet, then the front arc so it reads 3D */}
        <g className="po-ring" transform="rotate(-20 50 50)">
          <ellipse cx="50" cy="50" rx="42" ry="13" fill="none" stroke="#B7E5F2" strokeWidth="5" strokeOpacity="0.45" />
        </g>
        <circle className="po-sphere" cx="50" cy="50" r="26" fill="url(#po-sphere)" />
        <ellipse className="po-shine" cx="41" cy="41" rx="9" ry="6" fill="#fff" opacity="0.2" />
        <g className="po-ring" transform="rotate(-20 50 50)">
          <path d="M8 51 A 42 13 0 0 0 92 51" fill="none" stroke="#B7E5F2" strokeWidth="5" />
        </g>

        {/* moon — orbits while he's thinking or talking */}
        <g className="po-moon-orbit">
          <circle cx="50" cy="8" r="4.5" fill="#8FD4E8" />
        </g>
      </svg>
    </div>
  );
}
