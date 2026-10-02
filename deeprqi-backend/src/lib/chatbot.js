// Rule-based (no external API calls -- free to run) assistant covering
// how-to help, dashboard-wide stats, and per-road explanations. Intent is
// matched by keyword/regex, checked in order, first match wins. Data
// answers are computed live off the same tables the rest of the app reads
// from, so answers can't drift from what's actually in the database.

const prisma = require("./prisma");
const { predictDegradation } = require("./degradation");
const { generateExplanation } = require("./xaiSummary");
const axios = require("axios");

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
    include: { images: { orderBy: { uploadedAt: "desc" }, include: { scores: true } } },
  });
}

async function handleDashboardQuestion(text, user) {
  // Gated the same as the real dashboard (Milestone 10: ADMIN-only), so
  // the chatbot can't leak aggregate data an INSPECTOR couldn't otherwise see.
  if (user.role !== "ADMIN") {
    return "Dashboard-wide stats are only visible to Admins. I can tell you about a specific road though -- try asking me about it by name.";
  }
  const { totalRoads, scoredRoads, avgScore, criticalCount, latest } = await dashboardWideSummary();

  if (/worst/i.test(text)) {
    const worst = [...latest].sort((a, b) => a.score - b.score).slice(0, 3);
    if (worst.length === 0) return "No roads have been scored yet.";
    const nameById = await namesForRoadIds(worst.map((w) => w.roadId));
    const lines = worst.map((w) => `${nameById[w.roadId] || w.roadId}: ${Math.round(w.score)} (${w.category})`);
    return `Lowest-scoring roads: ${lines.join("; ")}.`;
  }
  if (/best/i.test(text)) {
    const best = [...latest].sort((a, b) => b.score - a.score).slice(0, 3);
    if (best.length === 0) return "No roads have been scored yet.";
    const nameById = await namesForRoadIds(best.map((w) => w.roadId));
    const lines = best.map((w) => `${nameById[w.roadId] || w.roadId}: ${Math.round(w.score)} (${w.category})`);
    return `Highest-scoring roads: ${lines.join("; ")}.`;
  }
  return (
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

  let forecastNote = "";
  if (forecast.alreadyCritical) {
    forecastNote = " This road is already in Critical condition -- repair is overdue.";
  } else if (forecast.predictable && forecast.recommendedRepairByDate) {
    forecastNote = ` At the current trend, recommended repair-by date is ${new Date(
      forecast.recommendedRepairByDate
    ).toLocaleDateString()}.`;
  }

  const baseFact = `${road.roadName} is currently ${latestScore.category} (${Math.round(latestScore.score)}/100). ${explanation}${forecastNote}`;

  const aiExplanation = await askOllama(
    `You are DeepRQI, an AI road inspector. You have the following hard data about a road: "${baseFact}". Rewrite this into a concise, professional, and easily understandable summary for a city administrator.`
  );

  return aiExplanation || baseFact;
}

async function askOllama(prompt) {
  try {
    const res = await axios.post("http://localhost:11434/api/generate", {
      model: "gpt oss 20b",
      prompt: prompt,
      stream: false
    });
    return res.data.response;
  } catch (err) {
    console.error("Ollama error:", err.message);
    return null;
  }
}

async function handleMessage(message, user) {
  const text = (message || "").trim();
  if (!text) return "Ask me how to upload a photo, about a specific road, or about dashboard stats.";

  if (/^(hi|hello|hey)\b/i.test(text)) {
    return "Hi! I can help with how to use DeepRQI, dashboard stats, or explain a specific road's condition -- what do you need?";
  }

  if (
    /\b(how many roads|total roads|average rqi|avg rqi|critical roads?|worst roads?|best roads?|dashboard)\b/i.test(
      text
    )
  ) {
    return handleDashboardQuestion(text, user);
  }

  const roadMatch = text.match(/(?:about|explain|how is|status of)\s+(.+?)(?:\?|$)/i);
  if (roadMatch) {
    return handleRoadQuestion(roadMatch[1].trim());
  }

  for (const topic of HELP_TOPICS) {
    if (topic.test.test(text)) return topic.reply;
  }

  // Fallback to Ollama AI
  const aiResponse = await askOllama(
    `You are DeepRQI, an AI road inspection assistant. The user asked: "${text}". Provide a helpful and concise response.`
  );
  if (aiResponse) {
    return aiResponse;
  }

  return (
    "I'm not sure about that. Try asking me how to upload a photo, what RQI means, about the retry/pending " +
    'queue, roles, or about a specific road by name (e.g. "how is MG Road doing?").'
  );
}

module.exports = { handleMessage };
