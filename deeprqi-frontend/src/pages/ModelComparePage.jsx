import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getImage, getAvailableModels, compareModels } from "../api/client";
import RqiGauge from "../components/RqiGauge";
import DetectionList from "../components/DetectionList";

export default function ModelComparePage() {
  const { imageId } = useParams();
  const [image, setImage] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);
  const [selected, setSelected] = useState([]);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [imgData, modelData] = await Promise.all([getImage(imageId), getAvailableModels()]);
        if (cancelled) return;
        setImage(imgData);
        setAvailableModels(modelData.models || []);
        setSelected((modelData.models || []).map((m) => m.name));
      } catch (err) {
        if (!cancelled) setError("Could not load this image or the model list.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imageId]);

  function toggleModel(name) {
    setSelected((prev) => (prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name]));
  }

  async function handleCompare() {
    if (selected.length < 2) {
      setError("Select at least two models to compare.");
      return;
    }
    setError("");
    setComparing(true);
    setResults(null);
    try {
      const data = await compareModels(imageId, selected);
      setResults(data.results);
    } catch (err) {
      setError(err.response?.data?.error || "Comparison failed.");
    } finally {
      setComparing(false);
    }
  }

  function selectAll() {
    setSelected(availableModels.map((m) => m.name));
  }

  function clearSelection() {
    setSelected([]);
  }

  function getModelMeta(m) {
    const raw = m.name || "";
    let tier = m.tag;
    if (!tier) {
      if (raw.includes("26n") || raw.includes("nano")) tier = "Nano";
      else if (raw.includes("26s") || raw.includes("small")) tier = "Small";
      else if (raw.includes("26m") || raw.includes("medium")) tier = "Medium";
      else if (raw.includes("26l") || raw.includes("large")) tier = "Large";
      else tier = "Small";
    }

    const displayName = m.display_name || `YOLO26-${tier}`;
    const badge = m.badge || (tier === "Nano" ? "⚡ Ultra Fast" : tier === "Small" ? "⚖️ Balanced" : tier === "Medium" ? "🎯 High Precision" : "🔬 Max Capacity");
    const speed = m.speed || (tier === "Nano" ? "~12ms" : tier === "Small" ? "~18ms" : tier === "Medium" ? "~32ms" : "~58ms");
    const file_size = m.file_size || (tier === "Nano" ? "~5.4 MB" : tier === "Small" ? "~60.2 MB" : tier === "Medium" ? "~131.2 MB" : "~157.9 MB");

    const color =
      tier === "Nano" ? "#38bdf8" :
      tier === "Small" ? "#a5b4fc" :
      tier === "Medium" ? "#fbbf24" :
      "#c084fc";

    const bg =
      tier === "Nano" ? "rgba(6, 182, 212, 0.12)" :
      tier === "Small" ? "rgba(99, 102, 241, 0.12)" :
      tier === "Medium" ? "rgba(245, 158, 11, 0.12)" :
      "rgba(168, 85, 247, 0.12)";

    const border =
      tier === "Nano" ? "rgba(6, 182, 212, 0.35)" :
      tier === "Small" ? "rgba(99, 102, 241, 0.35)" :
      tier === "Medium" ? "rgba(245, 158, 11, 0.35)" :
      "rgba(168, 85, 247, 0.35)";

    const icon =
      tier === "Nano" ? "⚡" :
      tier === "Small" ? "⚖️" :
      tier === "Medium" ? "🎯" :
      "🔬";

    return { tier, displayName, badge, speed, file_size, color, bg, border, icon };
  }

  if (loading) {
    return (
      <div className="main">
        <p style={{ color: "var(--text-muted)" }}>Loading models and image…</p>
      </div>
    );
  }

  return (
    <div className="main">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
        <div>
          <h2 style={{ fontSize: "24px", marginBottom: "6px", fontWeight: 700 }}>AI Model Comparison</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "14px", margin: 0 }}>
            Run this exact photo through multiple trained neural networks to compare detection recall, bounding box precision, and resulting RQI scores.
          </p>
        </div>
        <Link
          to={`/results/${imageId}`}
          style={{
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid var(--line)",
            color: "var(--text-muted)",
            padding: "8px 16px",
            borderRadius: "var(--radius)",
            fontSize: "13px",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          ← Back to inspection
        </Link>
      </div>

      {image && (
        <div className="panel" style={{ marginBottom: "24px", display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap" }}>
          <img
            src={image.imagePath}
            alt=""
            style={{ width: "140px", height: "90px", objectFit: "cover", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.1)" }}
          />
          <div style={{ flex: 1, minWidth: "200px" }}>
            <h3 style={{ fontSize: "16px", marginBottom: "4px" }}>{image.road?.roadName || "Road Photo"}</h3>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: "0 0 6px 0" }}>
              {image.road?.city ? `${image.road.city}, ` : ""}{image.road?.state || "India"}
            </p>
            <div style={{ display: "flex", gap: "10px", fontSize: "12px", color: "#94a3b8" }}>
              <span>Saved Model: <strong style={{ color: "#f8fafc" }}>{image.modelUsed || "Default"}</strong></span>
              {image.scores?.[0]?.score !== undefined && (
                <span>• Baseline RQI: <strong style={{ color: "var(--accent-primary)" }}>{image.scores[0].score}</strong></span>
              )}
            </div>
          </div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {availableModels.length < 2 ? (
        <div className="panel">
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
            Only one model is currently registered with the AI service. Once additional models are registered, they will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="panel" style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
            <div>
              <h3 style={{ fontSize: "15px", color: "#f8fafc", fontWeight: 600, margin: "0 0 2px 0" }}>
                Select Models to Compare ({selected.length} of {availableModels.length} selected)
              </h3>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
                Pick 2 or more models to run side-by-side inference on this photo.
              </p>
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={selectAll}
                style={{
                  background: "rgba(99, 102, 241, 0.15)",
                  border: "1px solid rgba(99, 102, 241, 0.35)",
                  color: "#a5b4fc",
                  fontSize: "12px",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Select All ({availableModels.length})
              </button>
              <button
                type="button"
                onClick={clearSelection}
                style={{
                  background: "transparent",
                  border: "1px solid var(--line)",
                  color: "var(--text-muted)",
                  fontSize: "12px",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Interactive Multi-Model Card Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "14px",
              marginBottom: "20px",
            }}
          >
            {availableModels.map((m) => {
              const isChecked = selected.includes(m.name);
              const meta = getModelMeta(m);

              return (
                <div
                  key={m.name}
                  onClick={() => toggleModel(m.name)}
                  style={{
                    background: isChecked
                      ? "linear-gradient(145deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.8) 100%)"
                      : "rgba(15, 23, 42, 0.4)",
                    border: isChecked
                      ? `1px solid ${meta.color}`
                      : "1px solid rgba(255, 255, 255, 0.08)",
                    boxShadow: isChecked
                      ? `0 0 16px ${meta.bg}, inset 0 0 12px ${meta.bg}`
                      : "none",
                    borderRadius: "10px",
                    padding: "14px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                    userSelect: "none",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "18px" }}>{meta.icon}</span>
                      <div>
                        <div style={{ fontWeight: 600, color: "#f8fafc", fontSize: "14px" }}>
                          {meta.displayName}
                        </div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>
                          {m.name}
                        </div>
                      </div>
                    </div>

                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}}
                      style={{
                        accentColor: "var(--accent-primary)",
                        width: "18px",
                        height: "18px",
                        cursor: "pointer",
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "2px" }}>
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        padding: "2px 7px",
                        borderRadius: "100px",
                        background: meta.bg,
                        border: `1px solid ${meta.border}`,
                        color: meta.color,
                      }}
                    >
                      {meta.tier}
                    </span>
                    <span
                      style={{
                        fontSize: "10px",
                        padding: "2px 7px",
                        borderRadius: "100px",
                        background: "rgba(255, 255, 255, 0.06)",
                        color: "#94a3b8",
                      }}
                    >
                      {meta.speed}
                    </span>
                    <span
                      style={{
                        fontSize: "10px",
                        padding: "2px 7px",
                        borderRadius: "100px",
                        background: "rgba(255, 255, 255, 0.06)",
                        color: "#94a3b8",
                      }}
                    >
                      {meta.file_size}
                    </span>
                  </div>

                  <p style={{ margin: "2px 0 0 0", fontSize: "11px", color: "#94a3b8", lineHeight: "1.4" }}>
                    {m.description || (meta.tier === "Nano" ? "Ultra-fast lightweight edge detector" : meta.tier === "Small" ? "Balanced baseline production model" : meta.tier === "Medium" ? "Enhanced crack and anomaly detection" : "Heavyweight deep neural model")}
                  </p>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
            <button
              onClick={handleCompare}
              disabled={comparing || selected.length < 2}
              className="btn-primary"
              style={{
                padding: "12px 24px",
                borderRadius: "var(--radius)",
                fontSize: "14px",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {comparing ? (
                <>⏳ Running {selected.length} Models…</>
              ) : (
                <>🚀 Run Comparison ({selected.length} Models)</>
              )}
            </button>

            {selected.length < 2 && (
              <span style={{ fontSize: "13px", color: "#f87171" }}>
                Select at least 2 models to compare.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Comparison Results */}
      {results && (
        <div style={{ marginTop: "30px" }}>
          {/* Top Comparative Summary Banner */}
          <div
            className="panel"
            style={{
              marginBottom: "20px",
              background: "linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.7) 100%)",
              border: "1px solid rgba(99, 102, 241, 0.3)",
            }}
          >
            <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#f8fafc", marginBottom: "12px" }}>
              📊 Comparison Summary
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fit, minmax(200px, 1fr))`,
                gap: "12px",
              }}
            >
              {results.map((r) => {
                const totalDetections = r.detections?.length || 0;
                return (
                  <div
                    key={r.model}
                    style={{
                      background: "rgba(0, 0, 0, 0.25)",
                      borderRadius: "8px",
                      padding: "12px 14px",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                    }}
                  >
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "#a5b4fc", marginBottom: "6px" }}>
                      {r.model}
                    </div>
                    {r.error ? (
                      <span style={{ color: "#f87171", fontSize: "12px" }}>Error</span>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                          <span style={{ color: "var(--text-muted)" }}>RQI Score:</span>
                          <strong style={{ color: "#ffffff" }}>{r.rqi?.score} / 100</strong>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                          <span style={{ color: "var(--text-muted)" }}>Condition:</span>
                          <span style={{ fontWeight: 600, color: r.rqi?.category === "Good" ? "#34d399" : r.rqi?.category === "Fair" ? "#fbbf24" : "#f87171" }}>
                            {r.rqi?.category}
                          </span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                          <span style={{ color: "var(--text-muted)" }}>Detections:</span>
                          <strong style={{ color: "#38bdf8" }}>{totalDetections} found</strong>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Model Side-by-Side Detailed Breakdown */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: results.length === 2 ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "20px",
            }}
          >
            {results.map((r) => (
              <div
                className="panel"
                key={r.model}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "14px",
                    paddingBottom: "10px",
                    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                  }}
                >
                  <h3 style={{ fontSize: "15px", color: "#f8fafc", fontWeight: 600, margin: 0 }}>
                    {r.model}
                  </h3>
                  {r.rqi && (
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "3px 8px",
                        borderRadius: "100px",
                        background: r.rqi.category === "Good" ? "rgba(16, 185, 129, 0.15)" : r.rqi.category === "Fair" ? "rgba(245, 158, 11, 0.15)" : "rgba(239, 68, 68, 0.15)",
                        color: r.rqi.category === "Good" ? "#34d399" : r.rqi.category === "Fair" ? "#fbbf24" : "#f87171",
                        border: "1px solid currentColor",
                      }}
                    >
                      {r.rqi.category}
                    </span>
                  )}
                </div>

                {r.error ? (
                  <p style={{ color: "var(--critical, #c0392b)", fontSize: "13px" }}>{r.error}</p>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "center", margin: "10px 0" }}>
                      <RqiGauge score={r.rqi.score} category={r.rqi.category} />
                    </div>

                    {r.heatmap_base64 && (
                      <div style={{ marginTop: "12px", marginBottom: "12px" }}>
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px" }}>
                          EigenCAM Attention Heatmap:
                        </div>
                        <img
                          src={`data:image/png;base64,${r.heatmap_base64}`}
                          alt={`${r.model} heatmap`}
                          style={{
                            width: "100%",
                            borderRadius: "8px",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            display: "block",
                          }}
                        />
                      </div>
                    )}

                    <div style={{ marginTop: "10px" }}>
                      <DetectionList breakdown={r.rqi.breakdown} />
                    </div>

                    {r.rqi.explanation && (
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--text-muted)",
                          marginTop: "14px",
                          lineHeight: "1.5",
                          background: "rgba(0, 0, 0, 0.2)",
                          padding: "10px",
                          borderRadius: "6px",
                          border: "1px solid rgba(255, 255, 255, 0.05)",
                        }}
                      >
                        {r.rqi.explanation}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: "24px" }}>
        <Link to={`/results/${imageId}`} style={{ fontSize: "13px", color: "var(--accent-primary)" }}>
          ← Back to single inspection result
        </Link>
      </div>
    </div>
  );
}

