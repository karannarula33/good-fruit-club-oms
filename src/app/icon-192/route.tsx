import { ImageResponse } from "next/og";

export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 110,
          fontWeight: 700,
          background: "#166534",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
        }}
      >
        G
      </div>
    ),
    { width: 192, height: 192 },
  );
}
