import InfoTooltip from "./InfoTooltip";

const SEVERITY_COLOR = {
  low: "var(--fair)",
  medium: "var(--poor)",
  high: "var(--very-poor)",
  critical: "var(--critical)",
};

export default function DetectionList({ detections, breakdown, onStatusChange, readOnly }) {
  if (!detections || detections.length === 0) {
    return (
      <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
        No damage detected in this image.
      </p>
    );
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--line)", textAlign: "left" }}>
          <th style={{ padding: "8px 4px", color: "var(--text-muted)", fontWeight: 500 }}>Type</th>
          <th style={{ padding: "8px 4px", color: "var(--text-muted)", fontWeight: 500 }}>
            Severity
            <InfoTooltip text="Based on how much of the photo the damage's bounding box covers — not its real-world size. A close-up photo of a small crack can register as high severity." />
          </th>
          <th style={{ padding: "8px 4px", color: "var(--text-muted)", fontWeight: 500, textAlign: "right" }}>
            Penalty
          </th>
          {!readOnly && (
            <th style={{ padding: "8px 4px", color: "var(--text-muted)", fontWeight: 500, textAlign: "right", width: "160px" }}>
              Verify
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {detections.map((det) => {
          // Find matching penalty from breakdown. Breakdown may omit FALSE_POSITIVE items.
          const b = breakdown?.find(item => item.id === det.id || (item.damage_type === det.damageType && item.severity === det.severity));
          const penalty = det.status === "FALSE_POSITIVE" ? 0 : (b?.penalty || 0);

          return (
            <tr key={det.id} style={{ borderBottom: "1px solid var(--line)", opacity: det.status === "FALSE_POSITIVE" ? 0.5 : 1 }}>
              <td className="mono" style={{ padding: "8px 4px", textDecoration: det.status === "FALSE_POSITIVE" ? "line-through" : "none" }}>
                {det.damageType.replace(/_/g, " ")}
                {det.status === "VERIFIED" && <span style={{ marginLeft: "8px", color: "var(--fair)", fontSize: "11px" }}>✓ VERIFIED</span>}
              </td>
              <td style={{ padding: "8px 4px" }}>
                <span
                  style={{
                    color: SEVERITY_COLOR[det.severity] || "var(--text-muted)",
                    textTransform: "uppercase",
                    fontSize: "11px",
                    letterSpacing: "0.04em",
                    textDecoration: det.status === "FALSE_POSITIVE" ? "line-through" : "none"
                  }}
                >
                  {det.severity}
                </span>
              </td>
              <td className="mono" style={{ padding: "8px 4px", textAlign: "right", textDecoration: det.status === "FALSE_POSITIVE" ? "line-through" : "none" }}>
                -{penalty}
              </td>
              {!readOnly && (
                <td style={{ padding: "8px 4px", textAlign: "right" }}>
                  {det.status === "DETECTED" && (
                    <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                      <button onClick={() => onStatusChange?.(det.id, "VERIFIED")} style={{ fontSize: "11px", padding: "4px 8px", background: "var(--bg-panel)", border: "1px solid var(--line)", borderRadius: "3px", cursor: "pointer", color: "var(--text)" }}>Confirm</button>
                      <button onClick={() => onStatusChange?.(det.id, "FALSE_POSITIVE")} style={{ fontSize: "11px", padding: "4px 8px", background: "var(--bg-panel)", border: "1px solid var(--line)", borderRadius: "3px", cursor: "pointer", color: "var(--critical)" }}>False Pos</button>
                    </div>
                  )}
                  {det.status !== "DETECTED" && (
                    <button onClick={() => onStatusChange?.(det.id, "DETECTED")} style={{ fontSize: "11px", padding: "4px 8px", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", textDecoration: "underline" }}>Undo</button>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
