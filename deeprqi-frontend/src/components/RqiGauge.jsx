import React from "react";
import { RQI_BANDS as BANDS, bandForScore } from "../utils/rqiBands";

const CX = 120;
const CY = 120;
const R = 86;
const START_ANGLE = 180; // 9 o'clock (0 score / Critical)
const END_ANGLE = 0;     // 3 o'clock (100 score / Good)

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: Number((cx + r * Math.cos(rad)).toFixed(2)),
    y: Number((cy - r * Math.sin(rad)).toFixed(2)),
  };
}

function scoreToAngle(score) {
  const clamped = Math.max(0, Math.min(100, typeof score === "number" ? score : parseFloat(score) || 0));
  return START_ANGLE - (clamped / 100) * (START_ANGLE - END_ANGLE);
}

// In SVG coordinates (Y pointing downward), moving clockwise across the top
// semicircle from 180 deg (left) to 0 deg (right) requires sweep-flag = 1.
function arcPath(startScore, endScore, radius) {
  const a1 = scoreToAngle(startScore);
  const a2 = scoreToAngle(endScore);
  const p1 = polarToCartesian(CX, CY, radius, a1);
  const p2 = polarToCartesian(CX, CY, radius, a2);
  const largeArc = Math.abs(a1 - a2) > 180 ? 1 : 0;
  return `M ${p1.x} ${p1.y} A ${radius} ${radius} 0 ${largeArc} 1 ${p2.x} ${p2.y}`;
}

export default function RqiGauge({ score = 0, category }) {
  const numScore = typeof score === "number" ? score : parseFloat(score) || 0;
  const clampedScore = Math.max(0, Math.min(100, numScore));
  const activeBand = bandForScore(clampedScore);
  const needleAngle = scoreToAngle(clampedScore);
  const needleTip = polarToCartesian(CX, CY, R - 10, needleAngle);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        maxWidth: "260px",
        userSelect: "none",
      }}
    >
      <svg
        width="240"
        height="150"
        viewBox="0 0 240 150"
        style={{ overflow: "visible" }}
      >
        <defs>
          <filter id="activeGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Outer Background Rail */}
        <path
          d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
          fill="none"
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth="14"
          strokeLinecap="round"
        />

        {/* 5 Distinct Colored Bands */}
        {BANDS.map((band) => {
          const isActive = band.label === activeBand.label;
          return (
            <path
              key={band.label}
              d={arcPath(band.min, band.max, R)}
              fill="none"
              stroke={band.hex || band.color}
              strokeWidth={isActive ? "15" : "13"}
              strokeLinecap="butt"
              opacity={isActive ? 1 : 0.3}
              filter={isActive ? "url(#activeGlow)" : undefined}
              style={{
                transition: "opacity 0.25s ease, stroke-width 0.25s ease",
              }}
            />
          );
        })}

        {/* Radial Tick Marks at Band Thresholds */}
        {[0, 25, 40, 60, 85, 100].map((tick) => {
          const angle = scoreToAngle(tick);
          const p1 = polarToCartesian(CX, CY, R + 9, angle);
          const p2 = polarToCartesian(CX, CY, R + 2, angle);
          return (
            <line
              key={tick}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke="rgba(255, 255, 255, 0.35)"
              strokeWidth="1.5"
            />
          );
        })}

        {/* Extremity Boundary Labels */}
        <text
          x={CX - R}
          y={CY + 16}
          textAnchor="middle"
          fill="rgba(255, 255, 255, 0.4)"
          fontSize="10"
          fontFamily="var(--font-mono, monospace)"
        >
          0
        </text>
        <text
          x={CX + R}
          y={CY + 16}
          textAnchor="middle"
          fill="rgba(255, 255, 255, 0.4)"
          fontSize="10"
          fontFamily="var(--font-mono, monospace)"
        >
          100
        </text>

        {/* Needle Pointer */}
        <line
          x1={CX}
          y1={CY}
          x2={needleTip.x}
          y2={needleTip.y}
          stroke="#ffffff"
          strokeWidth="3"
          strokeLinecap="round"
          style={{
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.8))",
            transition: "all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        />

        {/* Needle Pivot Rings */}
        <circle
          cx={CX}
          cy={CY}
          r="8"
          fill="#0f172a"
          stroke="rgba(255, 255, 255, 0.4)"
          strokeWidth="2"
        />
        <circle
          cx={CX}
          cy={CY}
          r="4"
          fill={activeBand.hex || activeBand.color}
          style={{ transition: "fill 0.25s ease" }}
        />
      </svg>

      {/* Score and Classification Badge */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          marginTop: "-6px",
          gap: "2px",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display, Outfit, sans-serif)",
            fontSize: "44px",
            fontWeight: 800,
            lineHeight: 1,
            color: activeBand.hex || activeBand.color,
            letterSpacing: "-0.02em",
            textShadow: `0 0 20px ${(activeBand.hex || activeBand.color)}40`,
            transition: "color 0.25s ease",
          }}
        >
          {Math.round(clampedScore)}
        </div>

        <div
          style={{
            fontFamily: "var(--font-body, Inter, sans-serif)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontSize: "12px",
            fontWeight: 700,
            color: activeBand.hex || activeBand.color,
            background: activeBand.bg || "rgba(255, 255, 255, 0.1)",
            border: `1px solid ${activeBand.border || "rgba(255, 255, 255, 0.2)"}`,
            padding: "3px 12px",
            borderRadius: "100px",
            marginTop: "4px",
            transition: "all 0.25s ease",
          }}
        >
          {category || activeBand.label}
        </div>
      </div>
    </div>
  );
}
