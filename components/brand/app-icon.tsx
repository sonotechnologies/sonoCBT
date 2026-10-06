/**
 * The app icon for ImageResponse (plain inline styles): the filled answer-sheet
 * bubble on an ink tile, as in <Logo mark />. Maskable icons fill the square and
 * keep the bubble small so any mask shape (circle, squircle) leaves it whole.
 */
export function AppIcon({ size, maskable = false }: { size: number; maskable?: boolean }) {
  const bubble = Math.round(size * (maskable ? 0.36 : 0.46));
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#14213D",
      }}
    >
      <div style={{ width: bubble, height: bubble, borderRadius: bubble, background: "#F2B705" }} />
    </div>
  );
}
