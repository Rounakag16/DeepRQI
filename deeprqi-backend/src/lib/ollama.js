// Centralized Ollama client -- every AI feature routes through here so the
// model name, endpoint, and retry/fallback logic live in one place. The
// model is "gpt oss 20b" running locally via Ollama on port 11434.

const axios = require("axios");

const OLLAMA_BASE = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL || "gpt oss 20b";
const TIMEOUT_MS = 60000; // generous -- local LLMs can be slow on first load

// ── Core generation ─────────────────────────────────────────────────────

/**
 * Single-shot completion. Returns the model's text response or null on
 * failure (caller decides how to degrade).
 */
async function generate(prompt, { temperature = 0.7, maxTokens = 1024 } = {}) {
  try {
    const res = await axios.post(
      `${OLLAMA_BASE}/api/generate`,
      {
        model: MODEL,
        prompt,
        stream: false,
        options: { temperature, num_predict: maxTokens },
      },
      { timeout: TIMEOUT_MS }
    );
    return (res.data.response || "").trim();
  } catch (err) {
    console.error("[Ollama] generate error:", err.message);
    return null;
  }
}

/**
 * Chat completion with message history (multi-turn). Returns the
 * assistant's text response or null on failure.
 */
async function chat(messages, { temperature = 0.7, maxTokens = 1024 } = {}) {
  try {
    const res = await axios.post(
      `${OLLAMA_BASE}/api/chat`,
      {
        model: MODEL,
        messages,
        stream: false,
        options: { temperature, num_predict: maxTokens },
      },
      { timeout: TIMEOUT_MS }
    );
    return (res.data.message?.content || "").trim();
  } catch (err) {
    console.error("[Ollama] chat error:", err.message);
    return null;
  }
}

/**
 * Streaming generation -- yields chunks via a callback. Used for the
 * streaming chat endpoint so the frontend can render tokens as they arrive.
 */
async function generateStream(prompt, onChunk, { temperature = 0.7, maxTokens = 1024 } = {}) {
  try {
    const res = await axios.post(
      `${OLLAMA_BASE}/api/generate`,
      {
        model: MODEL,
        prompt,
        stream: true,
        options: { temperature, num_predict: maxTokens },
      },
      { timeout: TIMEOUT_MS, responseType: "stream" }
    );

    return new Promise((resolve, reject) => {
      let fullResponse = "";
      res.data.on("data", (chunk) => {
        const lines = chunk.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.response) {
              fullResponse += parsed.response;
              onChunk(parsed.response, parsed.done || false);
            }
          } catch { /* partial JSON line, skip */ }
        }
      });
      res.data.on("end", () => resolve(fullResponse));
      res.data.on("error", reject);
    });
  } catch (err) {
    console.error("[Ollama] stream error:", err.message);
    return null;
  }
}

/**
 * Health check -- returns true if Ollama is reachable and the model is
 * loaded. Used by the /api/chat/status endpoint.
 */
async function isAvailable() {
  try {
    const res = await axios.get(`${OLLAMA_BASE}/api/tags`, { timeout: 5000 });
    const models = res.data.models || [];
    return models.some((m) => m.name.includes("gpt") || m.name.includes("oss"));
  } catch {
    return false;
  }
}

// ── Prompt Templates ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are DeepRQI Assistant, an AI-powered road quality inspection expert. You help city administrators, road inspectors, and engineers understand road conditions, prioritize repairs, and make data-driven decisions about road maintenance.

Key knowledge areas:
- RQI (Road Quality Index): 0-100 scale. Bands: 85-100 Good, 60-85 Fair, 40-60 Poor, 25-40 Very Poor, 0-25 Critical
- Damage types: potholes, longitudinal/transverse/alligator cracks, raveling
- Severity classification based on area coverage
- EigenCAM heatmaps for explainability
- Degradation forecasting using linear regression
- Repair cost estimation and prioritization

Always be concise, professional, and cite specific numbers when available. If you don't have data, say so clearly.`;

function buildRoadAnalysisPrompt(roadData) {
  return `${SYSTEM_PROMPT}

Analyze this road inspection data and provide a professional summary:

Road: ${roadData.roadName}
Location: ${[roadData.city, roadData.district, roadData.state].filter(Boolean).join(", ") || "Unknown"}
Latest RQI: ${roadData.score}/100 (${roadData.category})
Total Inspections: ${roadData.inspectionCount}
Damage Found: ${roadData.damages || "None"}
Trend: ${roadData.trend || "Insufficient data"}

Provide:
1. A brief condition assessment (2-3 sentences)
2. Key concerns if any
3. Recommended actions`;
}

function buildRepairRecommendationPrompt(roadData) {
  return `${SYSTEM_PROMPT}

Based on this road data, provide specific repair recommendations:

Road: ${roadData.roadName}
Current RQI: ${roadData.score}/100 (${roadData.category})
Damages: ${roadData.damages}
Severity Distribution: ${roadData.severities}
Estimated Cost: ${roadData.estimatedCost || "Not calculated"}
Projected Critical Date: ${roadData.criticalDate || "N/A"}

Provide:
1. Priority level (Immediate / High / Medium / Low)
2. Recommended repair methods for each damage type
3. Estimated timeline
4. Any preventive measures`;
}

function buildDashboardInsightPrompt(statsData) {
  return `${SYSTEM_PROMPT}

Generate a concise executive summary of the road network status:

Total Roads: ${statsData.totalRoads}
Scored Roads: ${statsData.scoredRoads}
Average RQI: ${statsData.avgScore}
Critical Roads: ${statsData.criticalCount}
Poor/Critical %: ${statsData.pctPoorCritical}%

Worst Roads: ${statsData.worstRoads || "N/A"}
Best Roads: ${statsData.bestRoads || "N/A"}

Write 3-4 sentences summarizing the overall network health and top priorities.`;
}

function buildComplaintAnalysisPrompt(complaints) {
  return `${SYSTEM_PROMPT}

Analyze these citizen complaints about road conditions and identify patterns:

${complaints.map((c, i) => `${i + 1}. "${c.description}" (Location: ${c.lat},${c.lng}, Votes: ${c.voterCount}, Status: ${c.status})`).join("\n")}

Provide:
1. Common complaint themes
2. Most urgent complaints (by votes and severity)
3. Areas that need immediate attention
4. Suggested response priorities`;
}

function buildConversationPrompt(history, userMessage, contextData) {
  const contextBlock = contextData
    ? `\n\nCurrent context from the database:\n${contextData}`
    : "";

  const messages = [
    { role: "system", content: SYSTEM_PROMPT + contextBlock },
    ...history.map((m) => ({
      role: m.role === "bot" ? "assistant" : "user",
      content: m.text,
    })),
    { role: "user", content: userMessage },
  ];

  return messages;
}

module.exports = {
  generate,
  chat,
  generateStream,
  isAvailable,
  SYSTEM_PROMPT,
  buildRoadAnalysisPrompt,
  buildRepairRecommendationPrompt,
  buildDashboardInsightPrompt,
  buildComplaintAnalysisPrompt,
  buildConversationPrompt,
};
