// Enhanced chatbot with Ollama "gpt oss 20b" -- combines the existing
// rule-based logic (free, instant) with LLM-powered features (streaming
// conversation, AI summaries, repair recommendations, etc.). The rule-
// based layer fires first as a fast path; anything it can't handle falls
// through to the LLM with full database context injected into the prompt.

const prisma = require("./prisma");
const { predictDegradation } = require("./degradation");
const { generateExplanation } = require("./xaiSummary");
const ollama = require("./ollama");

// ── Static help (instant, no LLM cost) ─────────────────────────────────

const HELP_TOPICS = [
  {
    test: /\b(upload|new inspection|add (a )?(photo|road)|enter data|how do i (add|submit))\b/i,
    reply:
      'To log a new inspection: open "New Inspection" in the top nav, enter the road name (and city if you ' +
      "have it), allow location access or type coordinates, then upload a photo of the road surface. " +
      "The AI service analyzes it automatically and takes you to the results page.",
  },
  {
    test: /\b(report|pdf|download)\b/i,
    reply:
      'Each road has a "Download report" button on its detail page (open a road from the dashboard map, ' +
      'history table, or right after an inspection via "View history & report") -- it generates a PDF with ' +
      "the full inspection history.",
  },
  {
    test: /\b(pending|retry queue|retry)\b/i,
    reply:
      'If the AI service is down when you upload, the photo is still saved and shows up under "Pending" in ' +
      "the nav. Once the AI service is back up, hit Retry on that image to run the analysis.",
  },
  {
    test: /\b(role|admin|inspector|permission)\b/i,
    reply:
      "There are two roles: INSPECTOR can log inspections and view road history/reports; ADMIN can additionally " +
      "see the dashboard-wide stats and map. Your role is set at registration.",
  },
  {
    test: /\b(rqi|road quality index|score mean|what.?s? (the|a) score)\b/i,
    reply:
      "RQI (Road Quality Index) starts at 100 and subtracts a penalty for each detected defect -- the penalty " +
      "depends on the damage type (pothole, crack types) and its severity, which is based on how much of the " +
      "photo the damage covers. Bands: 85-100 Good, 60-85 Fair, 40-60 Poor, 25-40 Very Poor, 0-25 Critical.",
  },
  {
    test: /\b(heatmap|eigencam|attention|explainab)\b/i,
    reply:
      "The heatmap on each result (EigenCAM) highlights which regions of the photo most influenced the model's " +
      "detections -- it's an approximation of the model's reasoning, not proof the highlighted damage is " +
      "correct, meant to make the AI's decision auditable rather than a black box.",
  },
  {
    test: /\b(history|past inspections|previous)\b/i,
    reply:
      "A road's full inspection history (every photo, date, inspector, and RQI score) is on that road's detail " +
      'page -- open it from the dashboard map, the history table row, or the "View history & report" link ' +
      "right after an inspection.",
  },
];

// ── Database queries ────────────────────────────────────────────────────

async function dashboardWideSummary() {
  const totalRoads = await prisma.road.count();
  const latest = await prisma.$queryRaw`
    SELECT DISTINCT ON (road_id) road_id AS "roadId", score, category
    FROM rqi_scores
    ORDER BY road_id, generated_at DESC
  `;
  const scoredRoads = latest.length;
  const avgScore = scoredRoads ? latest.reduce((sum, r) => sum + r.score, 0) / scoredRoads : null;
  const criticalCount = latest.filter((r) => r.category === "Critical").length;
  return { totalRoads, scoredRoads, avgScore, criticalCount, latest };
}

async function namesForRoadIds(ids) {
  const roads = await prisma.road.findMany({ where: { id: { in: ids } } });
  return Object.fromEntries(roads.map((r) => [r.id, r.roadName]));
}

async function findRoadByName(nameFragment) {
  return prisma.road.findFirst({
    where: { roadName: { contains: nameFragment, mode: "insensitive" } },
    include: {
      images: {
        orderBy: { uploadedAt: "desc" },
        include: { scores: true, detections: true },
      },
    },
  });
}

async function getRecentComplaints(limit = 10) {
  return prisma.complaint.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { road: { select: { roadName: true } } },
  });
}

async function getNetworkContext() {
  const stats = await dashboardWideSummary();
  const recentImages = await prisma.image.findMany({
    orderBy: { uploadedAt: "desc" },
    take: 5,
    include: {
      road: { select: { roadName: true } },
      scores: true,
    },
  });

  let context = `Network: ${stats.totalRoads} roads, ${stats.scoredRoads} scored, avg RQI ${
    stats.avgScore ? Math.round(stats.avgScore) : "N/A"
  }, ${stats.criticalCount} critical.`;

  if (recentImages.length > 0) {
    context += "\nRecent inspections: " +
      recentImages
        .map(
          (img) =>
            `${img.road?.roadName || "Unknown"} - RQI ${
              img.scores[0] ? Math.round(img.scores[0].score) : "pending"
            }`
        )
        .join(", ");
  }

  return context;
}

// ── Rule-based handlers (fast path) ─────────────────────────────────────

async function handleDashboardQuestion(text, user) {
  if (user.role !== "ADMIN") {
    return "Dashboard-wide stats are only visible to Admins. I can tell you about a specific road though -- try asking me about it by name.";
  }
  const { totalRoads, scoredRoads, avgScore, criticalCount, latest } = await dashboardWideSummary();

  if (/worst/i.test(text)) {
    const worst = [...latest].sort((a, b) => a.score - b.score).slice(0, 5);
    if (worst.length === 0) return "No roads have been scored yet.";
    const nameById = await namesForRoadIds(worst.map((w) => w.roadId));

    // Enrich with AI insight
    const worstData = worst.map((w) => `${nameById[w.roadId] || w.roadId}: ${Math.round(w.score)} (${w.category})`);
    const aiInsight = await ollama.generate(
      ollama.buildDashboardInsightPrompt({
        totalRoads, scoredRoads, avgScore: avgScore ? Math.round(avgScore) : "N/A",
        criticalCount, pctPoorCritical: scoredRoads ? Math.round((criticalCount / scoredRoads) * 100) : 0,
        worstRoads: worstData.join("; "),
      }),
      { maxTokens: 512 }
    );

    return aiInsight || `Lowest-scoring roads: ${worstData.join("; ")}.`;
  }

  if (/best/i.test(text)) {
    const best = [...latest].sort((a, b) => b.score - a.score).slice(0, 5);
    if (best.length === 0) return "No roads have been scored yet.";
    const nameById = await namesForRoadIds(best.map((w) => w.roadId));
    const lines = best.map((w) => `${nameById[w.roadId] || w.roadId}: ${Math.round(w.score)} (${w.category})`);
    return `Highest-scoring roads: ${lines.join("; ")}.`;
  }

  // Generate AI-powered executive summary
  const statsData = {
    totalRoads, scoredRoads,
    avgScore: avgScore ? Math.round(avgScore * 10) / 10 : "N/A",
    criticalCount,
    pctPoorCritical: scoredRoads ? Math.round((criticalCount / scoredRoads) * 100) : 0,
  };
  const aiSummary = await ollama.generate(ollama.buildDashboardInsightPrompt(statsData), { maxTokens: 512 });

  return (
    aiSummary ||
    `There are ${totalRoads} roads tracked (${scoredRoads} with at least one inspection). ` +
      (avgScore != null ? `Average RQI is ${Math.round(avgScore * 10) / 10}. ` : "") +
      `${criticalCount} road${criticalCount === 1 ? " is" : "s are"} currently in Critical condition.`
  );
}

async function handleRoadQuestion(fragment) {
  const road = await findRoadByName(fragment);
  if (!road) {
    return `I couldn't find a road matching "${fragment}". Check the spelling, or view it directly from the dashboard map.`;
  }
  const scored = road.images.flatMap((img) => img.scores);
  if (scored.length === 0) {
    return `${road.roadName} has been logged but has no inspections with a result yet.`;
  }
  const latestScore = [...scored].sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt))[0];
  const explanation = generateExplanation(latestScore);
  const forecast = predictDegradation(scored.map((s) => ({ score: s.score, generatedAt: s.generatedAt })));

  // Gather damage info for AI analysis
  const allDetections = road.images.flatMap((img) => img.detections || []);
  const damageTypes = {};
  const severities = {};
  for (const det of allDetections) {
    const type = det.damageType || "unknown";
    const sev = det.severity || "unknown";
    damageTypes[type] = (damageTypes[type] || 0) + 1;
    severities[sev] = (severities[sev] || 0) + 1;
  }

  let forecastNote = "";
  if (forecast.alreadyCritical) {
    forecastNote = " This road is already in Critical condition -- repair is overdue.";
  } else if (forecast.predictable && forecast.recommendedRepairByDate) {
    forecastNote = ` At the current trend, recommended repair-by date is ${new Date(
      forecast.recommendedRepairByDate
    ).toLocaleDateString()}.`;
  }

  const baseFact = `${road.roadName} is currently ${latestScore.category} (${Math.round(latestScore.score)}/100). ${explanation}${forecastNote}`;

  // AI-enhanced analysis
  const aiAnalysis = await ollama.generate(
    ollama.buildRoadAnalysisPrompt({
      roadName: road.roadName,
      city: road.city,
      district: road.district,
      state: road.state,
      score: Math.round(latestScore.score),
      category: latestScore.category,
      inspectionCount: scored.length,
      damages: Object.entries(damageTypes).map(([k, v]) => `${v}x ${k}`).join(", ") || "None",
      trend: forecast.predictable
        ? `${forecast.trendPointsPerMonth} pts/month`
        : forecast.reason,
    }),
    { maxTokens: 512 }
  );

  return aiAnalysis || baseFact;
}

// ── Complaint analysis ──────────────────────────────────────────────────

async function handleComplaintAnalysis(user) {
  if (user.role !== "ADMIN") {
    return "Complaint analysis is available to Admins only.";
  }
  const complaints = await getRecentComplaints(20);
  if (complaints.length === 0) {
    return "No citizen complaints have been submitted yet.";
  }

  const aiAnalysis = await ollama.generate(
    ollama.buildComplaintAnalysisPrompt(complaints),
    { maxTokens: 512 }
  );

  return (
    aiAnalysis ||
    `There are ${complaints.length} recent complaints. ${complaints.filter((c) => c.status === "OPEN").length} are still open.`
  );
}

// ── Repair recommendations ──────────────────────────────────────────────

async function handleRepairAdvice(fragment) {
  const road = await findRoadByName(fragment);
  if (!road) {
    return `I couldn't find a road matching "${fragment}". Try a different name.`;
  }
  const scored = road.images.flatMap((img) => img.scores);
  if (scored.length === 0) {
    return `${road.roadName} hasn't been inspected yet -- no repair data available.`;
  }
  const latestScore = [...scored].sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt))[0];
  const allDetections = road.images.flatMap((img) => img.detections || []);
  const damageTypes = {};
  const severities = {};
  for (const det of allDetections) {
    damageTypes[det.damageType || "unknown"] = (damageTypes[det.damageType || "unknown"] || 0) + 1;
    severities[det.severity || "unknown"] = (severities[det.severity || "unknown"] || 0) + 1;
  }

  const forecast = predictDegradation(scored.map((s) => ({ score: s.score, generatedAt: s.generatedAt })));

  const aiRec = await ollama.generate(
    ollama.buildRepairRecommendationPrompt({
      roadName: road.roadName,
      score: Math.round(latestScore.score),
      category: latestScore.category,
      damages: Object.entries(damageTypes).map(([k, v]) => `${v}x ${k}`).join(", ") || "None",
      severities: Object.entries(severities).map(([k, v]) => `${k}: ${v}`).join(", "),
      criticalDate: forecast.projectedCriticalDate
        ? new Date(forecast.projectedCriticalDate).toLocaleDateString()
        : null,
    }),
    { maxTokens: 768 }
  );

  return (
    aiRec ||
    `${road.roadName} (${latestScore.category}, ${Math.round(latestScore.score)}/100): ` +
      `${Object.entries(damageTypes).map(([k, v]) => `${v}x ${k}`).join(", ") || "no damage detected"}.`
  );
}

// ── Main message handler ────────────────────────────────────────────────

async function handleMessage(message, user, conversationHistory = []) {
  const text = (message || "").trim();
  if (!text) return "Ask me how to upload a photo, about a specific road, or about dashboard stats.";

  if (/^(hi|hello|hey)\b/i.test(text)) {
    return "Hi! I can help with how to use DeepRQI, dashboard stats, road analysis, repair recommendations, or complaint insights -- what do you need?";
  }

  // Dashboard stats
  if (
    /\b(how many roads|total roads|average rqi|avg rqi|critical roads?|worst roads?|best roads?|dashboard|network (status|health|summary)|executive summary)\b/i.test(
      text
    )
  ) {
    return handleDashboardQuestion(text, user);
  }

  // Complaint analysis
  if (/\b(complaints?|citizen reports?|public reports?|complaint analysis|complaint summary)\b/i.test(text)) {
    return handleComplaintAnalysis(user);
  }

  // Repair advice (explicit)
  const repairMatch = text.match(/(?:repair|fix|maintain|recommend.*for|how to fix)\s+(.+?)(?:\?|$)/i);
  if (repairMatch) {
    return handleRepairAdvice(repairMatch[1].trim());
  }

  // Road-specific question
  const roadMatch = text.match(/(?:about|explain|how is|status of|condition of|analyze)\s+(.+?)(?:\?|$)/i);
  if (roadMatch) {
    return handleRoadQuestion(roadMatch[1].trim());
  }

  // Static help topics (instant)
  for (const topic of HELP_TOPICS) {
    if (topic.test.test(text)) return topic.reply;
  }

  // ── LLM fallback with conversation context ───────────────────────────
  // If nothing matched above, use Ollama with conversation history +
  // live database context for an intelligent response.
  const contextData = await getNetworkContext();
  const messages = ollama.buildConversationPrompt(conversationHistory, text, contextData);
  const aiResponse = await ollama.chat(messages, { maxTokens: 512 });

  if (aiResponse) {
    return aiResponse;
  }

  return (
    "I'm not sure about that. Try asking me how to upload a photo, what RQI means, about the retry/pending " +
    'queue, roles, or about a specific road by name (e.g. "how is MG Road doing?").'
  );
}

// ── Streaming handler for SSE endpoint ──────────────────────────────────

async function handleMessageStream(message, user, conversationHistory, onChunk) {
  const text = (message || "").trim();
  if (!text) {
    onChunk("Ask me how to upload a photo, about a specific road, or about dashboard stats.", true);
    return;
  }

  // For static/rule-based responses, send the whole thing in one chunk
  if (/^(hi|hello|hey)\b/i.test(text)) {
    const reply = "Hi! I can help with how to use DeepRQI, dashboard stats, road analysis, repair recommendations, or complaint insights -- what do you need?";
    onChunk(reply, true);
    return;
  }

  for (const topic of HELP_TOPICS) {
    if (topic.test.test(text)) {
      onChunk(topic.reply, true);
      return;
    }
  }

  // For LLM-powered responses, stream tokens
  const contextData = await getNetworkContext();
  const prompt = `${ollama.SYSTEM_PROMPT}\n\nCurrent database context:\n${contextData}\n\nConversation so far:\n${conversationHistory.map((m) => `${m.role}: ${m.text}`).join("\n")}\n\nUser: ${text}\n\nAssistant:`;

  const result = await ollama.generateStream(prompt, onChunk);
  if (!result) {
    // Fallback -- try non-streaming
    const reply = await handleMessage(message, user, conversationHistory);
    onChunk(reply, true);
  }
}

module.exports = { handleMessage, handleMessageStream };
