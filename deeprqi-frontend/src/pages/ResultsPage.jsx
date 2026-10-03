import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, Link } from "react-router-dom";
import { getImage, patchDetectionStatus, getRoadReportBlob } from "../api/client";
import RqiGauge from "../components/RqiGauge";
import BoundingBoxOverlay from "../components/BoundingBoxOverlay";
import DetectionList from "../components/DetectionList";
import OcclusionExplainer from "../components/OcclusionExplainer";
import InfoTooltip from "../components/InfoTooltip";
import AISummaryPanel from "../components/AISummaryPanel";

export default function ResultsPage() {
  const { imageId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();

  // Fast path: we just uploaded and router state still has the full
  // result -- use it directly, no network round-trip. On a refresh or a
  // direct/shared link that state is gone (Milestone 11 fix), so we fall
  // back to fetching by ID, which now works because images/heatmaps are
  // persisted to Supabase Storage instead of only existing transiently
  // in the upload response.
  const stateResult = state?.result?.image?.id === imageId ? state.result : null;
  const [result, setResult] = useState(stateResult);
  const [loading, setLoading] = useState(!stateResult);
  const [error, setError] = useState("");
  const [reportDownloading, setReportDownloading] = useState(false);
  const [reportError, setReportError] = useState("");

  async function handleDownloadReport() {
    if (!result?.road) return;
    setReportError("");
    setReportDownloading(true);
    try {
      const blob = await getRoadReportBlob(result.road.id);
      const url = window.URL.createObjectURL(blob);
      const safeName = result.road.roadName.replace(/[^a-z0-9]/gi, "_");
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
    if (stateResult) return;
    let cancelled = false;
    (async () => {
      try {
        const image = await getImage(imageId);
        if (cancelled) return;
        setResult({ road: image.road, image, rqi: image.scores[0] });
      } catch (err) {
        if (!cancelled) setError("Couldn't load this inspection.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imageId, stateResult]);

  const handleStatusChange = async (detectionId, newStatus) => {
    try {
      const { detection, rqi: newRqi } = await patchDetectionStatus(detectionId, newStatus);
      setResult(prev => {
        if (!prev) return prev;
        const newDetections = prev.image.detections.map(d => d.id === detectionId ? { ...d, status: newStatus } : d);
        return {
          ...prev,
          image: { ...prev.image, detections: newDetections },
          rqi: newRqi || prev.rqi
        };
      });
    } catch (err) {
      alert("Failed to update status.");
    }
  };

  if (loading) {
    return (
      <div className="main">
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      </div>
    );
  }

  if (error || !result || !result.rqi) {
    return (
      <div className="main">
        <div className="panel" style={{ textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)" }}>{error || "No inspection result to show."}</p>
          <Link to="/upload" className="btn-primary" style={{ display: "inline-block", marginTop: "16px" }}>
            Start an inspection
          </Link>
        </div>
      </div>
    );
  }

  const { road, image, rqi } = result;
  // previewUrl only exists right after an upload (a local blob URL --
  // instant, no fetch). On refresh/direct link there's no local file, so
  // fall back to the persisted Supabase URL, which by then always exists.
  const photoUrl = state?.previewUrl || image.imagePath;

  return (
    <div className="main">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "24px" }}>
        <div>
          <h2 style={{ fontSize: "22px" }}>{road.roadName}</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: "4px" }}>
            {[road.city, road.district, road.state].filter(Boolean).join(", ") || "No location details"}
            {image.lat && image.lng && (
              <span className="mono"> · {image.lat.toFixed(4)}, {image.lng.toFixed(4)}</span>
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
            {reportDownloading ? "Generating…" : "Download Report"}
          </button>
          
          <Link
            to={`/roads/${road.id}`}
            style={{
              background: "none",
              border: "1px solid var(--accent)",
              color: "var(--accent)",
              padding: "8px 16px",
              borderRadius: "3px",
              fontSize: "13px",
              textDecoration: "none"
            }}
          >
            History
          </Link>
          <Link
            to={`/compare/${image.id}`}
            style={{
              background: "none",
              border: "1px solid var(--line)",
              color: "var(--text-muted)",
              padding: "8px 16px",
              borderRadius: "3px",
              fontSize: "13px",
              textDecoration: "none",
            }}
          >
            Compare models
          </Link>
          <button
            onClick={() => navigate("/upload")}
            style={{
              background: "none",
              border: "1px solid var(--line)",
              color: "var(--text-muted)",
              padding: "8px 16px",
              borderRadius: "3px",
              fontSize: "13px",
            }}
          >
            New inspection
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "20px" }}>
        {/* Left: annotated photo */}
        <div className="panel">
          <h3 style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "14px" }}>
            Detected damage
          </h3>
          <BoundingBoxOverlay imageUrl={photoUrl} detections={image.detections} />
        </div>

        {/* Right: RQI gauge + breakdown */}
        <div className="panel" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <h3 style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "6px", alignSelf: "flex-start", display: "flex", alignItems: "center" }}>
            Road Quality Index
            <InfoTooltip text="Starts at 100 and subtracts a penalty for each detected defect. The penalty depends on damage type and severity (how much of the photo it covers) — see the breakdown below for exactly how this score was reached." />
          </h3>
          <RqiGauge score={rqi.score} category={rqi.category} />
          {rqi.recomputedAt && (
            <span style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
              (Recomputed after review)
            </span>
          )}
          <div style={{ width: "100%", marginTop: "18px", borderTop: "1px solid var(--line)", paddingTop: "16px" }}>
            <DetectionList 
              detections={image.detections} 
              breakdown={rqi.breakdown} 
              onStatusChange={handleStatusChange} 
            />
          </div>
          {rqi.explanation && (
            <div style={{ width: "100%", marginTop: "16px", borderTop: "1px solid var(--line)", paddingTop: "16px" }}>
              <h4 style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px", display: "flex", alignItems: "center" }}>
                Why this score
                <InfoTooltip text="Generated automatically from the breakdown above — a template, not a separate AI judgment. Every sentence here traces directly to a number in the table." />
              </h4>
              <p style={{ fontSize: "13px", lineHeight: "1.5" }}>{rqi.explanation}</p>
            </div>
          )}
        </div>
      </div>

      {/* Explainability heatmap, full width below. Milestone 11: this is
          now always a persisted Supabase URL rather than a one-shot base64
          string, so it survives refresh/refetch the same as the photo. */}
      {image.heatmapPath && (
        <div className="panel" style={{ marginTop: "20px" }}>
          <h3 style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "10px", display: "flex", alignItems: "center" }}>
            Model attention (EigenCAM)
            <InfoTooltip text="EigenCAM looks at the model's internal activations — the same computation used for the prediction itself — and shows which pixels most influenced it, without needing a specific class to explain." />
          </h3>
          <p style={{ color: "var(--text-muted)", fontSize: "12px", lineHeight: "1.5", marginBottom: "10px" }}>
            This is <strong>not a second detection pass</strong> — it's a visualization of the same model run
            that already produced the boxes above. It shows <em>where the model was looking overall</em> across
            the whole photo, not specifically "why it called this a pothole." Treat it as a sanity check
            (does the hot area line up with visible damage?), not proof the detections are correct.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "14px", fontSize: "11px", color: "var(--text-muted)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: "#e5484d", display: "inline-block" }} />
              High attention (red/warm)
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: "#4a6fe5", display: "inline-block" }} />
              Low attention (blue/cool)
            </span>
          </div>
          <img
            src={image.heatmapPath}
            alt="EigenCAM heatmap"
            style={{ width: "100%", maxWidth: "600px", borderRadius: "3px", display: "block" }}
          />
        </div>
      )}

      <OcclusionExplainer imageId={image.id} detections={image.detections} />

      {/* AI Inspection Analysis */}
      <AISummaryPanel
        title="AI Inspection Analysis"
        compact
        prompt={`Analyze this single road inspection result for a road inspector:\n\nRoad: ${road.roadName}\nLocation: ${[road.city, road.district, road.state].filter(Boolean).join(", ") || "Unknown"}\nRQI Score: ${Math.round(rqi.score)}/100 (${rqi.category})\nDetections found: ${image.detections?.length || 0}\nDamage types: ${image.detections?.map(d => d.damageType).filter(Boolean).join(", ") || "None"}\nSeverities: ${image.detections?.map(d => d.severity).filter(Boolean).join(", ") || "N/A"}\nRQI Breakdown: ${rqi.breakdown ? rqi.breakdown.map(b => b.damage_type + " (" + b.severity + ", penalty: " + Math.round(b.penalty) + ")").join(", ") : "N/A"}\n\nProvide: 1) Brief assessment of this inspection 2) What the detected damage means practically 3) Urgency level 4) Next steps for the inspector`}
      />
    </div>
  );
}
