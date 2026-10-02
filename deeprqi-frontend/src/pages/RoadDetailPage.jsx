import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getRoad, getRoadReportBlob } from "../api/client";
import { useAuth } from "../context/AuthContext";
import RqiGauge from "../components/RqiGauge";
import RqiTrendChart from "../components/RqiTrendChart";
import DegradationForecastPanel from "../components/DegradationForecastPanel";
import { bandForScore } from "../utils/rqiBands";

export default function RoadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  // Milestone 10: INSPECTOR has no dashboard route to go "back" to.
  const backPath = user?.role === "ADMIN" ? "/dashboard" : "/upload";
  const backLabel = user?.role === "ADMIN" ? "Back to dashboard" : "Back to upload";
  const [road, setRoad] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportDownloading, setReportDownloading] = useState(false);
  const [reportError, setReportError] = useState("");

  async function handleDownloadReport() {
    setReportError("");
    setReportDownloading(true);
    try {
      const blob = await getRoadReportBlob(id);
      const url = window.URL.createObjectURL(blob);
      const safeName = road.roadName.replace(/[^a-z0-9]/gi, "_");
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeName}_report.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setReportError("Could not generate the report. Try again.");
    } finally {
      setReportDownloading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getRoad(id);
        if (!cancelled) setRoad(data);
      } catch (err) {
        if (!cancelled) setError("Could not load this road. It may not exist.");
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
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      </div>
    );
  }

  if (error || !road) {
    return (
      <div className="main">
        <div className="error-banner">{error || "Road not found."}</div>
        <Link to={backPath} className="btn-primary" style={{ display: "inline-block", marginTop: "16px" }}>
          {backLabel}
        </Link>
      </div>
    );
  }

  // road.images comes back newest-first from the backend; each has .scores[]
  // (usually one score per image in Phase 1/2). Flatten into a single
  // chronological inspection history and reverse for the trend chart.
  const inspections = road.images
    .map((img) => ({
      imageId: img.id,
      imagePath: img.imagePath,
      uploadedAt: img.uploadedAt,
      uploadedByName: img.uploadedBy?.name,
      detectionCount: img.detections.length,
      score: img.scores[0] || null,
    }))
    .filter((i) => i.score);

  const trendPoints = [...inspections].reverse().map((i) => ({
    score: i.score.score,
    generatedAt: i.score.generatedAt,
  }));

  const latest = inspections[0]?.score;

  return (
    <div className="main">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "24px" }}>
        <div>
          <h2 style={{ fontSize: "22px" }}>{road.roadName}</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: "4px" }}>
            {[road.city, road.district, road.state].filter(Boolean).join(", ") || "No location details"}
            {road.lat && road.lng && (
              <span className="mono"> · {road.lat.toFixed(4)}, {road.lng.toFixed(4)}</span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {reportError && (
            <span style={{ color: "var(--critical, #c0392b)", fontSize: "12px" }}>{reportError}</span>
          )}
          <button
            onClick={handleDownloadReport}
            disabled={reportDownloading}
            className="btn-primary"
            style={{ padding: "8px 16px", borderRadius: "3px", fontSize: "13px" }}
          >
            {reportDownloading ? "Generating…" : "Download report"}
          </button>
          <button
            onClick={() => navigate(`/survey/${road.id}`)}
            style={{
              background: "none",
              border: "1px solid var(--accent)",
              color: "var(--accent)",
              padding: "8px 16px",
              borderRadius: "3px",
              fontSize: "13px",
            }}
          >
            Start Dashcam Survey
          </button>
          <button
            onClick={() => navigate(backPath)}
            style={{
              background: "none",
              border: "1px solid var(--line)",
              color: "var(--text-muted)",
              padding: "8px 16px",
              borderRadius: "3px",
              fontSize: "13px",
            }}
          >
            {backLabel}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: "20px", marginBottom: "20px" }}>
        <div className="panel" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <h3 style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "6px", alignSelf: "flex-start" }}>
            Current RQI
          </h3>
          {latest ? (
            <RqiGauge score={latest.score} category={latest.category} />
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>No inspections recorded yet.</p>
          )}
        </div>

        <div className="panel">
          <h3 style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "14px" }}>
            RQI over time ({trendPoints.length} inspection{trendPoints.length === 1 ? "" : "s"})
          </h3>
          {trendPoints.length > 0 ? (
            <RqiTrendChart points={trendPoints} />
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Not enough data for a trend yet.</p>
          )}
        </div>
      </div>

      <DegradationForecastPanel forecast={road.degradationForecast} />

      <div className="panel">
        <h3 style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "14px" }}>
          Inspection history
        </h3>
        {inspections.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>No inspections yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)", textAlign: "left" }}>
                <th style={{ padding: "8px 6px", color: "var(--text-muted)", fontWeight: 500 }}>Photo</th>
                <th style={{ padding: "8px 6px", color: "var(--text-muted)", fontWeight: 500 }}>Date</th>
                <th style={{ padding: "8px 6px", color: "var(--text-muted)", fontWeight: 500 }}>Inspector</th>
                <th style={{ padding: "8px 6px", color: "var(--text-muted)", fontWeight: 500 }}>Detections</th>
                <th style={{ padding: "8px 6px", color: "var(--text-muted)", fontWeight: 500, textAlign: "right" }}>
                  RQI
                </th>
              </tr>
            </thead>
            <tbody>
              {inspections.map((insp) => {
                const band = bandForScore(insp.score.score);
                return (
                  <tr key={insp.imageId} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "8px 6px" }}>
                      <Link to={`/results/${insp.imageId}`}>
                        <img
                          src={insp.imagePath}
                          alt=""
                          style={{
                            width: "56px",
                            height: "40px",
                            objectFit: "cover",
                            borderRadius: "3px",
                            display: "block",
                          }}
                        />
                      </Link>
                    </td>
                    <td className="mono" style={{ padding: "8px 6px" }}>
                      {new Date(insp.uploadedAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: "8px 6px" }}>{insp.uploadedByName || "—"}</td>
                    <td className="mono" style={{ padding: "8px 6px" }}>{insp.detectionCount}</td>
                    <td className="mono" style={{ padding: "8px 6px", textAlign: "right", color: band.color }}>
                      {Math.round(insp.score.score)} · {insp.score.category}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
