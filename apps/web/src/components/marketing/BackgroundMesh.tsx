/**
 * Pronounced animated background — three slow-drifting blurred radial blobs
 * (green/teal) over the navy, plus a faint grain overlay. Pure CSS
 * transform/opacity motion (compositor-only, no JS, no canvas). Sits behind all
 * content at -z-20 and is frozen under prefers-reduced-motion (see landing-styles.css).
 */
export function BackgroundMesh() {
  return (
    <div aria-hidden="true" className="bg-mesh pointer-events-none fixed inset-0 -z-20">
      <span className="mesh-blob mesh-blob--1" />
      <span className="mesh-blob mesh-blob--2" />
      <span className="mesh-blob mesh-blob--3" />
      <span className="mesh-grain" />
    </div>
  );
}
