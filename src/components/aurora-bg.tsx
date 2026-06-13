/**
 * AuroraBg - the animated ambient background used across every Tabler console
 * surface (auth, dashboard, admin). Pure decoration: aria-hidden, pointer-events
 * disabled, sits behind content with `-z-10`. Render it once inside a relatively
 * positioned shell.
 *
 * Mirrors the landing page hero background so the whole product feels like one
 * continuous piece. Respects prefers-reduced-motion (animations are disabled via
 * globals.css).
 */
export function AuroraBg({ variant = "default" }: { variant?: "default" | "subtle" }) {
  const opacity = variant === "subtle" ? "opacity-60" : "";
  return (
    <div aria-hidden="true" className={`pointer-events-none fixed inset-0 -z-10 overflow-hidden ${opacity}`}>
      {/* dot grid */}
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage: "radial-gradient(circle, #94a3b8 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />
      {/* drifting colour blobs */}
      <div className="animate-aurora-1 absolute -top-40 left-1/4 h-[600px] w-[600px] rounded-full bg-amber-500/15 blur-[130px]" />
      <div className="animate-aurora-2 absolute top-20 -right-32 h-[500px] w-[500px] rounded-full bg-rose-500/10 blur-[120px]" />
      <div className="animate-aurora-3 absolute bottom-0 left-0 h-[450px] w-[450px] rounded-full bg-violet-600/10 blur-[120px]" />
      {/* top + bottom vignette to keep edges grounded */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#0a0a0b] to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0a0a0b] to-transparent" />
    </div>
  );
}
