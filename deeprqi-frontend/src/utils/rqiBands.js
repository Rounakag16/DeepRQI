// Single source of truth for RQI band colors/labels, matching the
// backend's RQI_BANDS exactly. Used by RqiGauge (the dial) and the
// dashboard map (marker colors) so they can never drift apart.

export const RQI_BANDS = [
  { min: 0, max: 25, color: "var(--critical, #dc2626)", hex: "#dc2626", bg: "rgba(220, 38, 38, 0.15)", border: "rgba(220, 38, 38, 0.4)", label: "Critical" },
  { min: 25, max: 40, color: "var(--very-poor, #ea580c)", hex: "#ea580c", bg: "rgba(234, 88, 12, 0.15)", border: "rgba(234, 88, 12, 0.4)", label: "Very Poor" },
  { min: 40, max: 60, color: "var(--poor, #fb923c)", hex: "#fb923c", bg: "rgba(251, 146, 60, 0.15)", border: "rgba(251, 146, 60, 0.4)", label: "Poor" },
  { min: 60, max: 85, color: "var(--fair, #f59e0b)", hex: "#f59e0b", bg: "rgba(245, 158, 11, 0.15)", border: "rgba(245, 158, 11, 0.4)", label: "Fair" },
  { min: 85, max: 100, color: "var(--good, #10b981)", hex: "#10b981", bg: "rgba(16, 185, 129, 0.15)", border: "rgba(16, 185, 129, 0.4)", label: "Good" },
];

export function bandForScore(score) {
  const num = typeof score === "number" ? score : parseFloat(score) || 0;
  return RQI_BANDS.find((b) => num >= b.min && num <= b.max) || (num <= 0 ? RQI_BANDS[0] : RQI_BANDS[RQI_BANDS.length - 1]);
}

