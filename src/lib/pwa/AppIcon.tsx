/**
 * The app icon as plain flex boxes, for next/og's ImageResponse (PNG icons for the manifest and
 * Apple devices): a teal tile with a white page whose last line is highlighted — a verified quote.
 * `fullBleed` draws a square tile with the artwork inside the safe zone (maskable / Apple icons).
 */
export function AppIcon({ size, fullBleed = false }: { size: number; fullBleed?: boolean }): React.ReactElement {
  const page = Math.round(size * (fullBleed ? 0.42 : 0.52));
  const bar = Math.max(2, Math.round(page * 0.08));
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f766e",
        borderRadius: fullBleed ? 0 : Math.round(size * 0.22),
      }}
    >
      <div
        style={{
          width: page,
          height: Math.round(page * 1.25),
          background: "#ffffff",
          borderRadius: Math.round(size * 0.04),
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: Math.round(page * 0.16),
        }}
      >
        {[1, 0.8, 0.9].map((w, i) => (
          <div key={i} style={{ height: bar, width: `${w * 100}%`, background: "#99f6e4", borderRadius: bar, marginBottom: Math.round(bar * 1.1) }} />
        ))}
        <div style={{ height: Math.round(bar * 1.4), width: "70%", background: "#f59e0b", borderRadius: bar }} />
      </div>
    </div>
  );
}
