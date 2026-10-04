import { ImageResponse } from "next/og";

export const alt = "SonoCBT — exams and results your school can trust";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The share card for links to the site (built-in font; no network needed). */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#14213D", color: "#FAF8F3", padding: 72 }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 44, fontWeight: 800 }}>
          <span>s</span>
          <span style={{ width: 30, height: 30, borderRadius: 15, border: "5px solid #FAF8F3", margin: "0 2px" }} />
          <span>n</span>
          <span style={{ width: 30, height: 30, borderRadius: 15, background: "#F2B705", margin: "0 2px" }} />
          <span>cbt</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>Exams and results your school can trust.</div>
          <div style={{ marginTop: 28, fontSize: 30, color: "#C9CCD4" }}>CBT from your Word papers · offline-safe · broadsheets and report cards</div>
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#F2B705", fontWeight: 700 }}>For Nigerian secondary schools · JSS1–SS3</div>
      </div>
    ),
    size,
  );
}
