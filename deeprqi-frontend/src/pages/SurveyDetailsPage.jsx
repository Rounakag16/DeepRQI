import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getSurvey } from "../api/client";
import RqiGauge from "../components/RqiGauge";

export default function SurveyDetailsPage() {
  const { id } = useParams();
  const [survey, setSurvey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getSurvey(id);
        if (!cancelled) setSurvey(data);
      } catch (err) {
        if (!cancelled) setError("Could not load this survey.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="main">
        <p style={{ color: "var(--text-muted)" }}>Loading survey results…</p>
      </div>
    );
  }

  if (error || !survey) {
    return (
      <div className="main">
        <div className="error-banner">{error || "Survey not found."}</div>
        <Link to="/dashboard" className="btn-primary" style={{ display: "inline-block", marginTop: "16px" }}>
          Back to dashboard
        </Link>
      </div>
    );
  }

  const scoreInfo = survey.scores[0]; // Most recent score (usually only one for a survey)
  const framesWithDetections = survey.frames.filter((f) => f.detections && f.detections.length > 0);

  return (
    <div className="main">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "24px" }}>
        <div>
          <h2 style={{ fontSize: "22px" }}>Video / Live Survey Results</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "14px", marginTop: "4px" }}>
            Road: <Link to={`/roads/${survey.roadId}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{survey.road?.roadName}</Link>
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "4px" }}>
            Started: {new Date(survey.startedAt).toLocaleString()}
          </p>
        </div>
        <Link to={`/roads/${survey.roadId}`} className="btn-secondary" style={{ padding: "8px 16px", borderRadius: "3px", fontSize: "13px", color: "var(--text)", border: "1px solid var(--line)", textDecoration: "none" }}>
          Back to road details
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "20px", marginBottom: "20px" }}>
        <div className="panel" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <h3 style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "6px", alignSelf: "flex-start" }}>
            Survey RQI
          </h3>
          {scoreInfo ? (
            <RqiGauge score={scoreInfo.score} category={scoreInfo.category} />
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>No score computed.</p>
          )}
        </div>

        <div className="panel">
          <h3 style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "14px" }}>
            Score Breakdown
          </h3>
          {scoreInfo ? (
            <div style={{ maxHeight: "300px", overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line)", textAlign: "left" }}>
                    <th style={{ padding: "8px 6px", color: "var(--text-muted)", fontWeight: 500 }}>Damage Type</th>
                    <th style={{ padding: "8px 6px", color: "var(--text-muted)", fontWeight: 500 }}>Severity</th>
                    <th style={{ padding: "8px 6px", color: "var(--text-muted)", fontWeight: 500 }}>Penalty</th>
                  </tr>
                </thead>
                <tbody>
                  {scoreInfo.breakdown?.map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "8px 6px" }}>{item.damage_type.replace(/_/g, " ")}</td>
                      <td style={{ padding: "8px 6px" }}>
                        <span style={{ 
                          padding: "2px 6px", 
                          borderRadius: "3px", 
                          backgroundColor: item.severity === "high" || item.severity === "critical" ? "rgba(231, 76, 60, 0.1)" : "rgba(241, 196, 15, 0.1)",
                          color: item.severity === "high" || item.severity === "critical" ? "var(--critical)" : "var(--accent)"
                        }}>
                          {item.severity}
                        </span>
                      </td>
                      <td className="mono" style={{ padding: "8px 6px", color: "var(--critical)" }}>
                        -{item.penalty}
                      </td>
                    </tr>
                  ))}
                  {(!scoreInfo.breakdown || scoreInfo.breakdown.length === 0) && (
                    <tr>
                      <td colSpan="3" style={{ padding: "16px 6px", textAlign: "center", color: "var(--text-muted)" }}>
                        No defects found. Perfect score!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>N/A</p>
          )}
        </div>
      </div>

      <div className="panel">
        <h3 style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "14px" }}>
          Captured Frames ({framesWithDetections.length})
        </h3>
        <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "20px" }}>
          Only frames that contributed to the final RQI score (found unique defects not seen in previous frames within 30m) are saved below.
        </p>

        {framesWithDetections.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>No defective frames captured.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "20px" }}>
            {framesWithDetections.map((frame) => (
              <div key={frame.id} style={{ background: "var(--bg-secondary)", borderRadius: "5px", overflow: "hidden", border: "1px solid var(--line)" }}>
                {frame.imagePath ? (
                  <img src={frame.imagePath} alt="Survey Frame" style={{ width: "100%", height: "180px", objectFit: "cover", display: "block" }} />
                ) : (
                  <div style={{ width: "100%", height: "180px", display: "flex", alignItems: "center", justifyContent: "center", background: "#111", color: "var(--text-muted)" }}>
                    No Image Saved
                  </div>
                )}
                <div style={{ padding: "12px" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px" }}>
                    Timestamp: {new Date(frame.timestamp).toLocaleTimeString()}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px" }}>
                    GPS: {frame.lat.toFixed(5)}, {frame.lng.toFixed(5)}
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: "600", marginBottom: "4px" }}>
                    Detections:
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "13px", color: "var(--text)" }}>
                    {frame.detections.map(det => (
                      <li key={det.id}>
                        {det.damageType.replace(/_/g, " ")} <span style={{color: "var(--text-muted)", fontSize: "11px"}}>({det.severity})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
