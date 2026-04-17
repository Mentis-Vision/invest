import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "ClearPath Invest — Know what to do with your money";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#FAF7F2",
          display: "flex",
          flexDirection: "column",
          padding: "80px 96px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 18,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            color: "#2D5F3F",
            fontWeight: 600,
          }}
        >
          <div style={{ display: "flex" }}>
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#2D5F3F"
              strokeWidth="2.5"
            >
              <path d="M2 20 L8 10 L14 15 L22 4" />
            </svg>
          </div>
          <div style={{ display: "flex" }}>ClearPath Invest</div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 96,
            lineHeight: 1,
            color: "#1A1A1E",
            letterSpacing: "-0.03em",
            fontWeight: 500,
            marginTop: 60,
            maxWidth: 980,
          }}
        >
          <div style={{ display: "flex" }}>Know what to do with</div>
          <div style={{ display: "flex", marginTop: 8 }}>
            <span>your&nbsp;</span>
            <span style={{ fontStyle: "italic", color: "#2D5F3F" }}>money</span>
            <span>.</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 24,
            color: "#6A6560",
            marginTop: 48,
            maxWidth: 880,
            lineHeight: 1.4,
          }}
        >
          Three independent AI models cross-verify every recommendation. Every
          claim traces to a source.
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "auto",
            paddingTop: 40,
            borderTop: "1px solid #E8E4DC",
            fontSize: 18,
            color: "#8A8680",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
          }}
        >
          <div style={{ display: "flex" }}>SEC · FRED · Yahoo · 12+ sources</div>
          <div style={{ display: "flex" }}>ClearPath Invest</div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
