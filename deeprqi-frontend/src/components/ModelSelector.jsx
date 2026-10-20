import React, { useState, useRef, useEffect } from "react";

// Color palettes and iconography for standard architectures
const TIER_STYLES = {
  Nano: {
    badgeBg: "rgba(6, 182, 212, 0.15)",
    badgeBorder: "rgba(6, 182, 212, 0.5)",
    badgeColor: "#38bdf8",
    icon: "⚡",
    accentGlow: "rgba(6, 182, 212, 0.25)",
  },
  Small: {
    badgeBg: "rgba(99, 102, 241, 0.15)",
    badgeBorder: "rgba(99, 102, 241, 0.5)",
    badgeColor: "#a5b4fc",
    icon: "⚖️",
    accentGlow: "rgba(99, 102, 241, 0.25)",
  },
  Medium: {
    badgeBg: "rgba(245, 158, 11, 0.15)",
    badgeBorder: "rgba(245, 158, 11, 0.5)",
    badgeColor: "#fbbf24",
    icon: "🎯",
    accentGlow: "rgba(245, 158, 11, 0.25)",
  },
  Large: {
    badgeBg: "rgba(168, 85, 247, 0.15)",
    badgeBorder: "rgba(168, 85, 247, 0.5)",
    badgeColor: "#c084fc",
    icon: "🔬",
    accentGlow: "rgba(168, 85, 247, 0.25)",
  },
  Default: {
    badgeBg: "rgba(148, 163, 184, 0.15)",
    badgeBorder: "rgba(148, 163, 184, 0.4)",
    badgeColor: "#cbd5e1",
    icon: "🧠",
    accentGlow: "rgba(148, 163, 184, 0.2)",
  },
};

export default function ModelSelector({
  models = [],
  value,
  onChange,
  id = "model",
  disabled = false,
  label,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Normalize model data with fallback attributes
  const normalizedModels = models.map((m) => {
    const rawName = m.name || "";
    let tier = m.tag;
    if (!tier) {
      if (rawName.includes("26n") || rawName.includes("nano")) tier = "Nano";
      else if (rawName.includes("26s") || rawName.includes("small")) tier = "Small";
      else if (rawName.includes("26m") || rawName.includes("medium")) tier = "Medium";
      else if (rawName.includes("26l") || rawName.includes("large")) tier = "Large";
      else tier = "Small";
    }

    const displayName =
      m.display_name ||
      (rawName.startsWith("yolo26")
        ? `YOLO26-${tier}`
        : rawName.replace(/_/g, " ").toUpperCase());

    const description =
      m.description ||
      (tier === "Nano"
        ? "Fastest inference (~12ms). Best for live camera streams and rapid edge inspections."
        : tier === "Small"
        ? "Standard production model (~18ms). Balanced precision and speed for road audits."
        : tier === "Medium"
        ? "Enhanced feature resolution (~32ms). Higher sensitivity to faint and hairline cracks."
        : tier === "Large"
        ? "Maximum detection capacity (~58ms). Deepest neural network for complex distress."
        : "Custom trained pavement inspection model.");

    const speed =
      m.speed ||
      (tier === "Nano"
        ? "Fastest (~12ms)"
        : tier === "Small"
        ? "Fast (~18ms)"
        : tier === "Medium"
        ? "Moderate (~32ms)"
        : "Thorough (~58ms)");

    const accuracy =
      m.accuracy ||
      (tier === "Nano"
        ? "Good (Edge)"
        : tier === "Small"
        ? "High (Standard)"
        : tier === "Medium"
        ? "Very High"
        : "Max Precision");

    const badge =
      m.badge ||
      (tier === "Small"
        ? "⚖️ Balanced (Default)"
        : tier === "Nano"
        ? "⚡ Ultra Fast"
        : tier === "Medium"
        ? "🎯 High Precision"
        : "🔬 Maximum Capacity");

    return {
      ...m,
      tag: tier,
      display_name: displayName,
      description,
      speed,
      accuracy,
      badge,
      file_size: m.file_size || (tier === "Nano" ? "~5MB" : tier === "Small" ? "~60MB" : tier === "Medium" ? "~131MB" : "~158MB"),
    };
  });

  const selectedModel =
    normalizedModels.find((m) => m.name === value) ||
    normalizedModels[0] ||
    null;

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keyboard accessibility
  function handleKeyDown(e) {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setIsOpen((prev) => !prev);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    } else if (e.key === "ArrowDown" && isOpen) {
      e.preventDefault();
      const currIdx = normalizedModels.findIndex((m) => m.name === value);
      const nextIdx = (currIdx + 1) % normalizedModels.length;
      onChange(normalizedModels[nextIdx].name);
    } else if (e.key === "ArrowUp" && isOpen) {
      e.preventDefault();
      const currIdx = normalizedModels.findIndex((m) => m.name === value);
      const prevIdx = (currIdx - 1 + normalizedModels.length) % normalizedModels.length;
      onChange(normalizedModels[prevIdx].name);
    }
  }

  const activeStyle = selectedModel
    ? TIER_STYLES[selectedModel.tag] || TIER_STYLES.Default
    : TIER_STYLES.Default;

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        fontFamily: "var(--font-body)",
      }}
    >
      {/* Hidden native select for form accessibility and automated integration */}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
        style={{
          position: "absolute",
          opacity: 0,
          pointerEvents: "none",
          width: 0,
          height: 0,
        }}
      >
        {normalizedModels.map((m) => (
          <option key={m.name} value={m.name}>
            {m.display_name} ({m.name})
          </option>
        ))}
      </select>

      {/* Main Interactive Dropdown Trigger */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        style={{
          background: "linear-gradient(145deg, #0f172a 0%, #131d33 100%)",
          border: isOpen
            ? "1px solid var(--accent-primary, #6366f1)"
            : "1px solid rgba(255, 255, 255, 0.16)",
          boxShadow: isOpen
            ? "0 0 0 3px rgba(99, 102, 241, 0.25), 0 8px 24px rgba(0, 0, 0, 0.5)"
            : "0 2px 8px rgba(0, 0, 0, 0.3)",
          borderRadius: "var(--radius, 12px)",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0, flex: 1 }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              background: activeStyle.badgeBg,
              border: `1px solid ${activeStyle.badgeBorder}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "18px",
              flexShrink: 0,
            }}
          >
            {activeStyle.icon}
          </div>

          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: "2px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span
                style={{
                  color: "#ffffff",
                  fontWeight: 600,
                  fontSize: "15px",
                  letterSpacing: "-0.01em",
                }}
              >
                {selectedModel?.display_name || "Select Model"}
              </span>

              {selectedModel?.tag && (
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    padding: "2px 8px",
                    borderRadius: "100px",
                    background: activeStyle.badgeBg,
                    border: `1px solid ${activeStyle.badgeBorder}`,
                    color: activeStyle.badgeColor,
                  }}
                >
                  {selectedModel.tag}
                </span>
              )}

              {selectedModel?.is_default && (
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "2px 7px",
                    borderRadius: "100px",
                    background: "rgba(16, 185, 129, 0.15)",
                    border: "1px solid rgba(16, 185, 129, 0.4)",
                    color: "#34d399",
                  }}
                >
                  Default
                </span>
              )}
            </div>

            <div
              style={{
                fontSize: "12px",
                color: "var(--text-muted, #94a3b8)",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              <span>{selectedModel?.speed}</span>
              <span style={{ opacity: 0.4 }}>•</span>
              <span>{selectedModel?.accuracy}</span>
              <span style={{ opacity: 0.4 }}>•</span>
              <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "11px" }}>
                {selectedModel?.file_size}
              </span>
            </div>
          </div>
        </div>

        {/* Dropdown Chevron */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: isOpen ? "var(--accent-primary, #6366f1)" : "#94a3b8",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.25s ease, color 0.2s ease",
            padding: "4px",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {/* Floating Options Menu */}
      {isOpen && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            right: 0,
            zIndex: 1000,
            background: "#0c1322",
            border: "1px solid rgba(99, 102, 241, 0.35)",
            borderRadius: "var(--radius, 12px)",
            boxShadow: "0 16px 40px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.05)",
            padding: "8px",
            maxHeight: "380px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            animation: "fadeInDropdown 0.18s ease-out",
          }}
        >
          <div
            style={{
              padding: "6px 10px 4px 10px",
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#64748b",
              display: "flex",
              justifyContent: "space-between",
              borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
              marginBottom: "2px",
            }}
          >
            <span>Available AI Models ({normalizedModels.length})</span>
            <span>Speed & Precision</span>
          </div>

          {normalizedModels.map((m) => {
            const isSelected = m.name === value;
            const tStyle = TIER_STYLES[m.tag] || TIER_STYLES.Default;

            return (
              <div
                key={m.name}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(m.name);
                  setIsOpen(false);
                }}
                style={{
                  background: isSelected
                    ? "linear-gradient(90deg, rgba(99, 102, 241, 0.22) 0%, rgba(30, 41, 59, 0.5) 100%)"
                    : "rgba(18, 26, 43, 0.6)",
                  border: isSelected
                    ? "1px solid rgba(99, 102, 241, 0.6)"
                    : "1px solid rgba(255, 255, 255, 0.05)",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "12px",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = "rgba(30, 41, 59, 0.9)";
                    e.currentTarget.style.borderColor = "rgba(99, 102, 241, 0.35)";
                    e.currentTarget.style.transform = "translateX(2px)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = "rgba(18, 26, 43, 0.6)";
                    e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.05)";
                    e.currentTarget.style.transform = "translateX(0)";
                  }
                }}
              >
                {/* Icon Box */}
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "6px",
                    background: tStyle.badgeBg,
                    border: `1px solid ${tStyle.badgeBorder}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "16px",
                    flexShrink: 0,
                    marginTop: "2px",
                  }}
                >
                  {tStyle.icon}
                </div>

                {/* Option Text Content */}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span
                      style={{
                        color: isSelected ? "#ffffff" : "#f1f5f9",
                        fontWeight: 600,
                        fontSize: "14px",
                      }}
                    >
                      {m.display_name}
                    </span>

                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        padding: "1px 6px",
                        borderRadius: "100px",
                        background: tStyle.badgeBg,
                        border: `1px solid ${tStyle.badgeBorder}`,
                        color: tStyle.badgeColor,
                      }}
                    >
                      {m.tag}
                    </span>

                    {m.is_default && (
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 600,
                          padding: "1px 6px",
                          borderRadius: "100px",
                          background: "rgba(16, 185, 129, 0.15)",
                          border: "1px solid rgba(16, 185, 129, 0.4)",
                          color: "#34d399",
                        }}
                      >
                        Default
                      </span>
                    )}

                    {m.is_placeholder_model && (
                      <span
                        style={{
                          fontSize: "10px",
                          padding: "1px 6px",
                          borderRadius: "100px",
                          background: "rgba(239, 68, 68, 0.15)",
                          border: "1px solid rgba(239, 68, 68, 0.4)",
                          color: "#f87171",
                        }}
                      >
                        Placeholder
                      </span>
                    )}
                  </div>

                  <p
                    style={{
                      margin: 0,
                      fontSize: "12px",
                      color: "#94a3b8",
                      lineHeight: "1.4",
                    }}
                  >
                    {m.description}
                  </p>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      marginTop: "2px",
                      fontSize: "11px",
                      color: "#64748b",
                    }}
                  >
                    <span style={{ color: "#38bdf8" }}>{m.speed}</span>
                    <span>•</span>
                    <span style={{ color: "#a5b4fc" }}>{m.accuracy}</span>
                    <span>•</span>
                    <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                      {m.file_size}
                    </span>
                  </div>
                </div>

                {/* Checkmark indicator */}
                <div
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    marginTop: "4px",
                    background: isSelected ? "var(--accent-primary, #6366f1)" : "rgba(255, 255, 255, 0.05)",
                    color: isSelected ? "#ffffff" : "transparent",
                    border: isSelected ? "none" : "1px solid rgba(255, 255, 255, 0.15)",
                    transition: "all 0.15s ease",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
