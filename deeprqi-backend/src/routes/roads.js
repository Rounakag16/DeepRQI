const express = require("express");
const prisma = require("../lib/prisma");
const { findRoadsNear } = require("../lib/geo");
const { writeRoadReportPdf } = require("../lib/pdfReport");
const { requireAuth } = require("../middleware/auth");
const { predictDegradation } = require("../lib/degradation");

const router = express.Router();

// GET /api/roads
// Every road plus its most recent RQI score -- exactly what the map
// dashboard needs to plot color-coded markers in one request.
router.get("/", requireAuth, async (req, res) => {
	const roads = await prisma.road.findMany({
		orderBy: { roadName: "asc" },
	});

	// DISTINCT ON gets the latest score per road in a single query instead
	// of N+1 lookups.
	const latestScores = await prisma.$queryRaw`
    SELECT DISTINCT ON (road_id) road_id AS "roadId", score, category, generated_at AS "generatedAt"
    FROM rqi_scores
    ORDER BY road_id, generated_at DESC
  `;
	const scoreByRoad = Object.fromEntries(latestScores.map((s) => [s.roadId, s]));

	const withScores = roads.map((r) => ({
		...r,
		latestScore: scoreByRoad[r.id]
			? {
					score: scoreByRoad[r.id].score,
					category: scoreByRoad[r.id].category,
					generatedAt: scoreByRoad[r.id].generatedAt,
				}
			: null,
	}));

	res.json(withScores);
});

// GET /api/roads/near?lat=..&lng=..&radiusKm=5
router.get("/near", requireAuth, async (req, res) => {
	const { lat, lng, radiusKm } = req.query;
	if (!lat || !lng) {
		return res.status(400).json({ error: "lat and lng query params are required." });
	}

	const roads = await findRoadsNear(
		parseFloat(lat),
		parseFloat(lng),
		radiusKm ? parseFloat(radiusKm) : 5,
	);

	// BigInt/Decimal from raw SQL don't serialize to JSON directly.
	const safe = roads.map((r) => ({ ...r, distance_m: Number(r.distance_m) }));
	res.json(safe);
});

// GET /api/roads/:id -- full inspection history for the road detail page
router.get("/:id", requireAuth, async (req, res) => {
	const road = await prisma.road.findUnique({
		where: { id: req.params.id },
		include: {
			images: {
				orderBy: { uploadedAt: "desc" },
				include: { detections: true, scores: true, uploadedBy: { select: { name: true } } },
			},
      repairEvents: {
        orderBy: { repairedAt: "desc" },
        include: { recordedBy: { select: { name: true } } },
      }
		},
	});

	if (!road) return res.status(404).json({ error: "Road not found." });

	// Repair-deadline projection (see lib/degradation.js) -- computed from
	// every score this road has, oldest to newest.
	const scoreHistory = road.images
		.flatMap((img) => img.scores)
		.map((s) => ({ score: s.score, generatedAt: s.generatedAt }));
    
  const latestRepairAt = road.repairEvents.length > 0 ? road.repairEvents[0].repairedAt : null;
	const degradationForecast = predictDegradation(scoreHistory, { since: latestRepairAt });

	res.json({ ...road, degradationForecast });
});

// GET /api/roads/:id/report -- PDF inspection report (Milestone 9). Same
// underlying query/shape as the detail route above, laid out for printing
// or sharing rather than for the dashboard UI.
router.get("/:id/report", requireAuth, async (req, res) => {
	const road = await prisma.road.findUnique({
		where: { id: req.params.id },
		include: {
			images: {
				orderBy: { uploadedAt: "desc" },
				include: { detections: true, scores: true, uploadedBy: { select: { name: true } } },
			},
		},
	});

	if (!road) return res.status(404).json({ error: "Road not found." });

	const safeName = road.roadName.replace(/[^a-z0-9]/gi, "_");
	res.setHeader("Content-Type", "application/pdf");
	res.setHeader("Content-Disposition", `attachment; filename="${safeName}_report.pdf"`);
	await writeRoadReportPdf(road, res);
});

// GET /api/roads/:id/repairs
router.get("/:id/repairs", requireAuth, async (req, res) => {
  const repairs = await prisma.repairEvent.findMany({
    where: { roadId: req.params.id },
    orderBy: { repairedAt: "desc" },
    include: { recordedBy: { select: { name: true } } },
  });
  res.json(repairs);
});

const { requireRole } = require("../middleware/auth");
// POST /api/roads/:id/repairs (ADMIN only)
router.post("/:id/repairs", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { repairedAt, notes } = req.body;
  
  if (!repairedAt) {
    return res.status(400).json({ error: "repairedAt is required" });
  }

  const road = await prisma.road.findUnique({ where: { id: req.params.id } });
  if (!road) return res.status(404).json({ error: "Road not found." });

  const repair = await prisma.repairEvent.create({
    data: {
      roadId: req.params.id,
      repairedAt: new Date(repairedAt),
      recordedById: req.user.id,
      notes: notes || null,
    },
    include: { recordedBy: { select: { name: true } } },
  });
  
  res.status(201).json(repair);
});

// POST /api/roads - Ensure road exists (find or create) for Dashcam
router.post("/", requireAuth, async (req, res) => {
  let { roadName, city, district, state, lat, lng } = req.body;
  if (!roadName && (!lat || !lng)) {
    return res.status(400).json({ error: "Provide roadName or lat/lng." });
  }

  let road = null;
  // 1. Try to find by GPS
  if (lat && lng) {
    const nearby = await findRoadsNear(parseFloat(lat), parseFloat(lng), 0.05);
    if (nearby.length > 0) {
      road = await prisma.road.findUnique({ where: { id: nearby[0].id } });
    }
  }

  // 2. Fall back to name match
  if (!road && roadName) {
    road = await prisma.road.findFirst({
      where: {
        roadName: { equals: roadName.trim(), mode: "insensitive" },
        city: city ? { equals: city.trim(), mode: "insensitive" } : null,
      },
    });
  }

  // 3. Create if not found
  if (!road) {
    if (!roadName) {
      // Need a name to create it. In a real app we'd reverse-geocode here.
      return res.status(400).json({ error: "roadName is required for a new road." });
    }
    road = await prisma.road.create({
      data: {
        roadName: roadName.trim(),
        city: city ? city.trim() : null,
        district: district ? district.trim() : null,
        state: state ? state.trim() : null,
        lat: lat ? parseFloat(lat) : null,
        lng: lng ? parseFloat(lng) : null,
      },
    });
  }

  res.json(road);
});

module.exports = router;
