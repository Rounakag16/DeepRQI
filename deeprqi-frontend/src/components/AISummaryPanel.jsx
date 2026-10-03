import { useState } from "react";
import { aiSummarize } from "../api/client";

/**
 * AISummaryPanel -- a reusable "Ask AI" panel that can be dropped onto
 * any page (dashboard, road detail, results) to generate an AI-powered
 * summary of whatever data the parent passes in.
 *
 * Props:
 *  - prompt: string -- the context/data to summarize
 *  - title?: string -- panel heading (default: "AI Insight")
 *  - compact?: boolean -- smaller padding for inline use
 */
export default function AISummaryPanel({ prompt, title = "AI Insight", compact = false }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(true);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setCollapsed(false);
    try {
      const { summary: text } = await aiSummarize(prompt);
      setSummary(text);
    } catch (err) {
      setError("AI summarization unavailable. Make sure Ollama is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        background: "rgba(99,102,241,0.04)",
        border: "1px solid rgba(99,102,241,0.15)",
        borderRadius: "16px",
        padding: compact ? "14px 16px" : "20px 24px",
        marginTop: compact ? "12px" : "20px",
        transition: "all 0.3s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: collapsed && !summary ? 0 : "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px" }}>✨</span>
          <span
            style={{
              fontSize: "13px",
              fontWeight: 600,
              background: "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              letterSpacing: "0.02em",
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontSize: "10px",
              padding: "2px 8px",
              borderRadius: "8px",
              background: "rgba(99,102,241,0.12)",
              color: "var(--accent-primary)",
              fontWeight: 500,
            }}
          >
            Powered by Ollama
          </span>
        </div>

        {!summary && !loading && (
          <button
            onClick={handleGenerate}
            style={{
              background: "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))",
              border: "none",
              borderRadius: "8px",
              color: "#fff",
              padding: "6px 14px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
              boxShadow: "0 2px 8px var(--accent-glow)",
            }}
          >
            Generate
          </button>
        )}

        {summary && (
          <button
            onClick={handleGenerate}
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "8px",
              color: "var(--text-muted)",
              padding: "4px 10px",
              fontSize: "11px",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            Regenerate
          </button>
        )}
      </div>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "16px",
              height: "16px",
              border: "2px solid rgba(99,102,241,0.3)",
              borderTopColor: "var(--accent-primary)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Analyzing with AI…
          </span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {error && (
        <div style={{ fontSize: "12px", color: "#ef4444" }}>{error}</div>
      )}

      {summary && !loading && (
        <div
          style={{
            fontSize: "13px",
            lineHeight: "1.6",
            color: "var(--text-primary)",
            whiteSpace: "pre-wrap",
            animation: "fadeIn 0.4s ease-out",
          }}
        >
          {summary}
          <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
        </div>
      )}
    </div>
  );
}
