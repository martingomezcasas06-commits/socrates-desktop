/**
 * PlanetOrb — the Socrates mark on a voice call.
 *
 * This renders the shipped `socrates-logo.svg` directly rather than redrawing
 * the Saturn, so the call panel can never drift from the brand mark. The
 * design gives the mark two states only — alive and not yet alive — and the
 * breathing that makes it alive lives on the `.vo-mark` wrapper, so the whole
 * mark moves as one object.
 *
 * It used to be a hand-drawn Saturn with a gradient body, a halo, a specular
 * highlight and an orbiting moon, each running its own animation on top of the
 * wrapper's. At the 22px the panel gives it, that resolved to noise.
 */
export type OrbStatus = "connecting" | "listening" | "speaking" | "thinking";

export default function PlanetOrb({ status, size = 44 }: { status: OrbStatus; size?: number }) {
  return (
    <div className={`planet ${status}`} style={{ width: size, height: size }}>
      <img src="/socrates-logo.svg" alt="" width={size} height={size} />
    </div>
  );
}
