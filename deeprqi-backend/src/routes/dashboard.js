const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { rankRoadsByPriority } = require("../lib/rankRoadsByPriority");

const router = express.Router();

// GET /api/dashboard/stats -- ADMIN-only (Milestone 10). The dashboard is
// the aggregate/prioritization view; per the project spec that's an
// administrator's job, not a field inspector's.
// Total roads, average RQI, and critical-road count -- all computed off
// each road's *latest* score, not every score ever recorded.
router.get("/stats", requireAuth, requireRole("ADMIN"), async (req, res) => {
	const roads = await prisma.road.findMany({
		include: { surveySessions: { orderBy: { endedAt: "desc" }, take: 1 } },
	});
	const totalRoads = roads.length;

	const latest = await prisma.$queryRaw`
    SELECT DISTINCT ON (road_id) road_id AS "roadId", score, category
    FROM rqi_scores
    ORDER BY road_id, generated_at DESC
  `;

	const scoredRoads = latest.length;
	const avgScore = scoredRoads ? latest.reduce((sum, r) => sum + r.score, 0) / scoredRoads : null;
	const criticalCount = latest.filter((r) => r.category === "Critical").length;
  
  let poorOrCriticalCount = 0;
  const poorCriticalRoads = [];

  latest.forEach(r => {
    if (r.score < 40) {
      poorOrCriticalCount++;
      const roadInfo = roads.find(x => x.id === r.roadId);
      const dist = roadInfo?.surveySessions?.[0]?.totalDistanceKm || 1;
      poorCriticalRoads.push({ roadId: r.roadId, distance: dist, score: r.score });
    }
  });

  const pctPoorCritical = scoredRoads ? Math.round((poorOrCriticalCount / scoredRoads) * 100) : 0;

	res.json({
		totalRoads,
		scoredRoads,
		avgScore: avgScore !== null ? Math.round(avgScore * 10) / 10 : null,
		criticalCount,
    pctPoorCritical,
    poorCriticalRoads,
	});
});

// GET /api/dashboard/priority -- ADMIN-only. Ranks every road that has at
// least one inspection by lib/priority.js's urgency score (current RQI +
// how soon the degradation forecast says it'll cross into Critical), with
// a rough repair-cost estimate (lib/repairCost.js) alongside each one.
// This is the "what should we fix first" view -- Phase-3 "Decision Engine
// / maintenance priority scoring" from the project roadmap. Both scoring
// functions are heuristics, clearly labeled as estimates on the frontend,
// not a real budgeting or scheduling tool.
const PRIORITY_MAX_LIMIT = 500;

router.get("/priority", requireAuth, requireRole("ADMIN"), async (req, res) => {
	const roads = await prisma.road.findMany({
		include: { images: { include: { scores: true } } },
	});
	// Ranking needs every road's full history up front (it's an urgency
	// ordering, not something you can compute a page at a time), so the
	// query above stays unbounded -- but the response is optionally capped
	// to the top N after ranking, since callers usually only want the most
	// urgent roads, not the whole city.
	const ranked = rankRoadsByPriority(roads);
	const rawLimit = parseInt(req.query.limit, 10);
	const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), PRIORITY_MAX_LIMIT) : null;
	res.json({ roads: limit ? ranked.slice(0, limit) : ranked, total: ranked.length });
});

module.exports = router;
