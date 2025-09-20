import { ImageResponse } from "next/og";
import {
  PROJECT_TITLE,
} from "~/lib/constants";

export const alt = PROJECT_TITLE;
export const contentType = "image/png";
export const size = {
  width: 512,
  height: 512,
};

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          backgroundColor: "#000000",
          position: "relative",
        }}
      >
        {/* Game symbols */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "16px",
          }}
        >
          {/* Rock */}
          <div
            style={{
              width: "80px",
              height: "80px",
              backgroundColor: "rgba(255, 255, 255, 0.1)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "48px",
              border: "2px solid rgba(255, 255, 255, 0.2)",
            }}
          >
            🪨
          </div>
          {/* Paper */}
          <div
            style={{
              width: "80px",
              height: "80px",
              backgroundColor: "rgba(255, 255, 255, 0.1)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "48px",
              border: "2px solid rgba(255, 255, 255, 0.2)",
            }}
          >
            📄
          </div>
          {/* Scissors */}
          <div
            style={{
              width: "80px",
              height: "80px",
              backgroundColor: "rgba(255, 255, 255, 0.1)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "48px",
              border: "2px solid rgba(255, 255, 255, 0.2)",
            }}
          >
            ✂️
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}