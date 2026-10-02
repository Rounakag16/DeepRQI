const express = require("express");
const multer = require("multer");
const FormData = require("form-data");
const axios = require("axios");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");
const { uploadBuffer } = require("../lib/storage");
const crypto = require("crypto");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Radius of the earth in m
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// POST /api/surveys/start
router.post("/start", requireAuth, async (req, res) => {
  const { roadId } = req.body;
  if (!roadId) return res.status(400).json({ error: "roadId is required." });

  const session = await prisma.surveySession.create({
    data: {
      roadId,
      inspectorId: req.user.id,
    },
  });
  res.json({ id: session.id });
});

// POST /api/surveys/:id/frame
router.post("/:id/frame", requireAuth, upload.single("image"), async (req, res) => {
  const sessionId = req.params.id;
  const lat = parseFloat(req.body.lat);
  const lng = parseFloat(req.body.lng);
  const speed = parseFloat(req.body.speed) || null;

  if (!req.file || isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: "image, lat, and lng are required." });
  }

  // 1. Send to AI fast-path
  const form = new FormData();
  form.append("file", req.file.buffer, { filename: "frame.jpg", contentType: "image/jpeg" });
  
  let aiResponse;
  try {
    aiResponse = await axios.post(`${process.env.FASTAPI_URL}/detect`, form, {
      headers: form.getHeaders(),
    });
  } catch (err) {
    console.error("AI service error:", err.message);
    return res.status(500).json({ error: "AI processing failed." });
  }

  const { detections } = aiResponse.data;

  // 2. Fetch recent detections in this session for deduplication
  const pastDetections = await prisma.surveyDetection.findMany({
    where: { frame: { sessionId } },
    include: { frame: true },
  });

  const uniqueDetections = [];
  
  for (const det of detections) {
    // Check if within 30m of same damageType
    const isDuplicate = pastDetections.some((past) => {
      if (past.damageType !== det.damage_type) return false;
      const dist = getDistanceFromLatLonInM(lat, lng, past.frame.lat, past.frame.lng);
      return dist <= 30;
    });

    if (!isDuplicate) {
      uniqueDetections.push(det);
    }
  }

  // 3. Save frame and unique detections
  let imagePath = null;
  if (uniqueDetections.length > 0) {
    const uploadToken = crypto.randomUUID();
    const ext = req.file.mimetype === "image/png" ? "png" : "jpg";
    imagePath = await uploadBuffer(
      req.file.buffer,
      `surveys/${sessionId}/${uploadToken}-frame.${ext}`,
      req.file.mimetype
    );
  }

  const frame = await prisma.surveyFrame.create({
    data: {
      sessionId,
      lat,
      lng,
      speed,
      imagePath,
      detections: {
        create: uniqueDetections.map((d) => ({
          damageType: d.damage_type,
          severity: d.severity,
          confidence: d.confidence,
        })),
      },
    },
    include: { detections: true },
  });

  res.json({
    frameId: frame.id,
    newDetectionsCount: uniqueDetections.length,
    totalDetectionsInFrame: detections.length,
  });
});

// POST /api/surveys/:id/end
router.post("/:id/end", requireAuth, async (req, res) => {
  const sessionId = req.params.id;

  const session = await prisma.surveySession.findUnique({
    where: { id: sessionId },
    include: { frames: { include: { detections: true } } },
  });

  if (!session) return res.status(404).json({ error: "Session not found." });
  if (session.endedAt) return res.status(400).json({ error: "Session already ended." });

  const allDetections = session.frames.flatMap((f) => f.detections);
  const payload = allDetections.map((d) => ({
    damage_type: d.damageType,
    severity: d.severity,
  }));

  let scoreData;
  if (payload.length > 0) {
    const aiResponse = await axios.post(`${process.env.FASTAPI_URL}/rqi/compute`, {
      detections: payload,
    });
    scoreData = aiResponse.data;
  } else {
    scoreData = {
      score: 100,
      category: "Excellent",
      total_penalty: 0,
      breakdown: [],
    };
  }

  await prisma.surveySession.update({
    where: { id: sessionId },
    data: { endedAt: new Date() },
  });

  const rqiScore = await prisma.rqiScore.create({
    data: {
      roadId: session.roadId,
      sessionId: session.id,
      score: scoreData.score,
      category: scoreData.category,
      totalPenalty: scoreData.total_penalty,
      breakdown: scoreData.breakdown,
    },
  });

  res.json({ session, rqi: rqiScore });
});

// GET /api/surveys/:id
router.get("/:id", requireAuth, async (req, res) => {
  const session = await prisma.surveySession.findUnique({
    where: { id: req.params.id },
    include: {
      road: true,
      scores: true,
      frames: {
        include: { detections: true },
        orderBy: { timestamp: "asc" },
      },
    },
  });

  if (!session) return res.status(404).json({ error: "Survey not found." });
  res.json(session);
});

module.exports = router;
