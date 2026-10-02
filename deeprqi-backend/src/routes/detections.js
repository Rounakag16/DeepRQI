const express = require("express");
const axios = require("axios");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { generateExplanation } = require("../lib/xaiSummary");

const router = express.Router();

router.patch("/:id/status", requireAuth, requireRole("ADMIN", "INSPECTOR"), async (req, res) => {
  const { status } = req.body;
  if (!["DETECTED", "VERIFIED", "FALSE_POSITIVE", "REPAIRED"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }

  try {
    const detection = await prisma.detection.findUnique({
      where: { id: req.params.id },
      include: { image: { include: { detections: true, scores: true } } },
    });

    if (!detection) return res.status(404).json({ error: "Detection not found." });

    // Update the detection
    await prisma.detection.update({
      where: { id: req.params.id },
      data: {
        status,
        verifiedById: req.user.id,
        verifiedAt: new Date(),
      },
    });

    // Recompute RQI for this image
    // Load all detections for the image except FALSE_POSITIVE
    const imageDetections = await prisma.detection.findMany({
      where: {
        imageId: detection.imageId,
        status: { not: "FALSE_POSITIVE" },
      },
    });

    // Prepare payload for AI service
    const payload = imageDetections.map((d) => ({
      id: d.id,
      damage_type: d.damageType,
      severity: d.severity,
    }));

    const aiResponse = await axios.post(`${process.env.FASTAPI_URL}/rqi/compute`, {
      detections: payload,
    });
    const rqiResult = aiResponse.data;

    const oldScore = detection.image.scores[0];
    if (oldScore) {
      const updatedScore = await prisma.rqiScore.update({
        where: { id: oldScore.id },
        data: {
          originalScore: oldScore.originalScore !== null ? oldScore.originalScore : oldScore.score,
          score: rqiResult.score,
          category: rqiResult.category,
          totalPenalty: rqiResult.total_penalty,
          breakdown: rqiResult.breakdown,
          recomputedAt: new Date(),
        },
      });
      return res.json({
        detection: { ...detection, status, verifiedById: req.user.id, verifiedAt: new Date() },
        rqi: { ...updatedScore, explanation: generateExplanation(updatedScore) },
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update status and recompute RQI." });
  }
});

module.exports = router;
