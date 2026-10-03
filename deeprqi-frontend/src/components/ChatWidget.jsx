import { useState, useRef, useEffect, useCallback } from "react";
import {
  sendChatMessage,
  getChatStatus,
  clearChatHistory,
} from "../api/client";

// ── Suggested prompts for different contexts ────────────────────────────
const QUICK_PROMPTS = [
  { icon: "📊", label: "Network summary", text: "Give me a dashboard summary" },
  { icon: "🛣️", label: "Worst roads", text: "What are the worst roads?" },
  { icon: "🔧", label: "Repair advice", text: "Which roads need immediate repair?" },
  { icon: "📋", label: "Complaint analysis", text: "Analyze recent complaints" },
];

const GREETING = {
  role: "bot",
  text: "Hello! I'm your **DeepRQI AI Assistant** powered by Ollama. I can analyze roads, recommend repairs, summarize dashboard data, and much more. What can I help you with?",
  timestamp: new Date(),
};

// ── Simple markdown-like renderer ───────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code style="background:rgba(99,102,241,0.15);padding:2px 6px;border-radius:4px;font-size:12px">$1</code>')
    .replace(/^(\d+)\.\s/gm, '<span style="color:var(--accent-primary);font-weight:600">$1.</span> ')
    .replace(/^[-•]\s/gm, '<span style="color:var(--accent-primary)">•</span> ')
    .replace(/\n/g, "<br/>");
}

// ── Typing indicator ────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "12px 16px",
      alignSelf: "flex-start",
    }}>
      <div style={{ display: "flex", gap: "4px" }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "var(--accent-primary)",
              animation: `chatBounce 1.4s ease-in-out ${i * 0.2}s infinite`,
              opacity: 0.6,
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "4px" }}>
        AI is thinking…
      </span>
    </div>
  );
}

// ── Status Badge ────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const isAI = status?.mode === "ai";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "11px",
        color: isAI ? "#10b981" : "#f59e0b",
        fontWeight: 500,
      }}
    >
      <div
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: isAI ? "#10b981" : "#f59e0b",
          boxShadow: isAI ? "0 0 8px rgba(16,185,129,0.5)" : "0 0 8px rgba(245,158,11,0.5)",
          animation: "chatPulse 2s ease-in-out infinite",
        }}
      />
      {isAI ? `AI · ${status.model}` : "Rule-based mode"}
    </div>
  );
}

// ── Message Bubble ──────────────────────────────────────────────────────
function MessageBubble({ message, isLast }) {
  const isUser = message.role === "user";
  const time = message.timestamp
    ? new Date(message.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: "4px",
        animation: isLast ? "chatSlideIn 0.3s ease-out" : "none",
        maxWidth: "88%",
        alignSelf: isUser ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "8px",
          flexDirection: isUser ? "row-reverse" : "row",
        }}
      >
        {/* Avatar */}
        {!isUser && (
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
              flexShrink: 0,
              boxShadow: "0 2px 8px var(--accent-glow)",
            }}
          >
            🤖
          </div>
        )}

        {/* Bubble */}
        <div
          style={{
            padding: "10px 14px",
            borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
            background: isUser
              ? "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))"
              : "rgba(255,255,255,0.04)",
            color: isUser ? "#fff" : "var(--text-primary)",
            fontSize: "13px",
            lineHeight: "1.55",
            border: isUser ? "none" : "1px solid rgba(255,255,255,0.06)",
            boxShadow: isUser
              ? "0 2px 12px var(--accent-glow)"
              : "0 1px 4px rgba(0,0,0,0.1)",
            wordBreak: "break-word",
          }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }}
        />
      </div>

      {/* Timestamp */}
      <span
        style={{
          fontSize: "10px",
          color: "var(--text-muted)",
          opacity: 0.6,
          padding: isUser ? "0 4px 0 0" : "0 0 0 36px",
        }}
      >
        {time}
      </span>
    </div>
  );
}

// ── Main ChatWidget ─────────────────────────────────────────────────────
export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null);
  const [showPrompts, setShowPrompts] = useState(true);
  const [unread, setUnread] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // Fetch AI status on mount
  useEffect(() => {
    getChatStatus()
      .then(setStatus)
      .catch(() => setStatus({ mode: "rule-based", model: "offline" }));
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, open]);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
    if (open) setUnread(0);
  }, [open]);

  const handleSend = useCallback(
    async (overrideText) => {
      const text = (overrideText || input).trim();
      if (!text || sending) return;

      setShowPrompts(false);
      setMessages((prev) => [
        ...prev,
        { role: "user", text, timestamp: new Date() },
      ]);
      setInput("");
      setSending(true);

      try {
        const { reply } = await sendChatMessage(text);
        setMessages((prev) => [
          ...prev,
          { role: "bot", text: reply, timestamp: new Date() },
        ]);
        if (!open) setUnread((u) => u + 1);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: "bot",
            text: "Sorry, I couldn't process that. The AI service may be unavailable — please try again.",
            timestamp: new Date(),
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [input, sending, open]
  );

  const handleClear = async () => {
    try {
      await clearChatHistory();
    } catch { /* ignore */ }
    setMessages([GREETING]);
    setShowPrompts(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    handleSend();
  };

  return (
    <>
      {/* ── Chat Panel ──────────────────────────────────────────────── */}
      <div
        style={{
          position: "fixed",
          bottom: "90px",
          right: "20px",
          width: open ? "400px" : "0",
          maxWidth: "calc(100vw - 40px)",
          height: open ? "560px" : "0",
          opacity: open ? 1 : 0,
          transform: open ? "scale(1) translateY(0)" : "scale(0.9) translateY(20px)",
          transformOrigin: "bottom right",
          transition: "all 0.35s cubic-bezier(0.32, 0.72, 0, 1)",
          display: "flex",
          flexDirection: "column",
          padding: 0,
          zIndex: 1000,
          overflow: "hidden",
          borderRadius: "20px",
          background: "rgba(12, 12, 20, 0.92)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          boxShadow:
            "0 24px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.1), inset 0 1px 0 rgba(255,255,255,0.05)",
          pointerEvents: open ? "auto" : "none",
        }}
      >
        {/* ── Header ───────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}>
              <span style={{
                fontSize: "15px",
                fontWeight: 700,
                fontFamily: "var(--font-display)",
                background: "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}>
                DeepRQI Assistant
              </span>
              <span style={{
                fontSize: "10px",
                padding: "2px 8px",
                borderRadius: "10px",
                background: "rgba(99,102,241,0.15)",
                color: "var(--accent-primary)",
                fontWeight: 600,
                letterSpacing: "0.03em",
              }}>
                AI
              </span>
            </div>
            <StatusBadge status={status} />
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              onClick={handleClear}
              title="Clear conversation"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "8px",
                color: "var(--text-muted)",
                width: "32px",
                height: "32px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: "14px",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.target.style.background = "rgba(255,255,255,0.1)";
                e.target.style.color = "#fff";
              }}
              onMouseLeave={(e) => {
                e.target.style.background = "rgba(255,255,255,0.05)";
                e.target.style.color = "var(--text-muted)";
              }}
            >
              🗑️
            </button>
            <button
              onClick={() => setOpen(false)}
              title="Close chat"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "8px",
                color: "var(--text-muted)",
                width: "32px",
                height: "32px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: "16px",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.target.style.background = "rgba(239,68,68,0.15)";
                e.target.style.color = "#ef4444";
              }}
              onMouseLeave={(e) => {
                e.target.style.background = "rgba(255,255,255,0.05)";
                e.target.style.color = "var(--text-muted)";
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── Messages ─────────────────────────────────────────────── */}
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            scrollBehavior: "smooth",
          }}
        >
          {messages.map((m, i) => (
            <MessageBubble
              key={i}
              message={m}
              isLast={i === messages.length - 1}
            />
          ))}

          {sending && <TypingIndicator />}

          {/* ── Quick prompts ──────────────────────────────────────── */}
          {showPrompts && messages.length <= 1 && !sending && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
                marginTop: "8px",
              }}
            >
              {QUICK_PROMPTS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(p.text)}
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "12px",
                    padding: "12px 10px",
                    color: "var(--text-primary)",
                    fontSize: "12px",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.2s ease",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(99,102,241,0.1)";
                    e.currentTarget.style.borderColor = "rgba(99,102,241,0.3)";
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  <span style={{ fontSize: "18px" }}>{p.icon}</span>
                  <span style={{ fontWeight: 500 }}>{p.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Feature pills ────────────────────────────────────────── */}
        {status?.features && (
          <div
            style={{
              display: "flex",
              gap: "6px",
              padding: "6px 16px",
              overflowX: "auto",
              borderTop: "1px solid rgba(255,255,255,0.04)",
              scrollbarWidth: "none",
            }}
          >
            {status.features.slice(0, 4).map((f, i) => (
              <span
                key={i}
                style={{
                  fontSize: "10px",
                  padding: "3px 8px",
                  borderRadius: "8px",
                  background: "rgba(99,102,241,0.08)",
                  color: "var(--accent-primary)",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {f}
              </span>
            ))}
          </div>
        )}

        {/* ── Input ────────────────────────────────────────────────── */}
        <form
          onSubmit={handleSubmit}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "12px 14px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about roads, repairs, stats…"
            disabled={sending}
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "12px",
              color: "var(--text-primary)",
              padding: "10px 14px",
              fontSize: "13px",
              outline: "none",
              transition: "border-color 0.2s ease, box-shadow 0.2s ease",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = "rgba(99,102,241,0.4)";
              e.target.style.boxShadow = "0 0 0 3px rgba(99,102,241,0.1)";
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "rgba(255,255,255,0.08)";
              e.target.style.boxShadow = "none";
            }}
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "12px",
              border: "none",
              background:
                sending || !input.trim()
                  ? "rgba(255,255,255,0.05)"
                  : "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))",
              color: sending || !input.trim() ? "var(--text-muted)" : "#fff",
              cursor: sending || !input.trim() ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "16px",
              transition: "all 0.2s ease",
              flexShrink: 0,
              boxShadow:
                sending || !input.trim() ? "none" : "0 2px 12px var(--accent-glow)",
            }}
          >
            {sending ? "⏳" : "➤"}
          </button>
        </form>
      </div>

      {/* ── FAB Button ──────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close assistant" : "Open assistant"}
        style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          width: "56px",
          height: "56px",
          borderRadius: "16px",
          border: "none",
          background: open
            ? "rgba(30,30,40,0.9)"
            : "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))",
          color: "#fff",
          fontSize: "22px",
          zIndex: 1001,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: open
            ? "0 4px 16px rgba(0,0,0,0.3)"
            : "0 8px 24px var(--accent-glow), 0 0 48px rgba(99,102,241,0.2)",
          transition: "all 0.35s cubic-bezier(0.32, 0.72, 0, 1)",
          transform: open ? "rotate(0deg)" : "rotate(0deg)",
          backdropFilter: open ? "blur(12px)" : "none",
        }}
      >
        {open ? "✕" : "💬"}
        {/* Unread badge */}
        {!open && unread > 0 && (
          <div
            style={{
              position: "absolute",
              top: "-4px",
              right: "-4px",
              width: "20px",
              height: "20px",
              borderRadius: "50%",
              background: "#ef4444",
              color: "#fff",
              fontSize: "11px",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 8px rgba(239,68,68,0.5)",
              animation: "chatPulse 2s ease-in-out infinite",
            }}
          >
            {unread}
          </div>
        )}
      </button>

      {/* ── Keyframe animations (injected once) ──────────────────── */}
      <style>{`
        @keyframes chatBounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes chatSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes chatPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        /* Custom scrollbar for chat */
        div::-webkit-scrollbar {
          width: 4px;
        }
        div::-webkit-scrollbar-track {
          background: transparent;
        }
        div::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 4px;
        }
        div::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.2);
        }
      `}</style>
    </>
  );
}
