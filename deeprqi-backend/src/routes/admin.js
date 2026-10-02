const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Hard-negative export: GET /api/admin/export/review
// Returns images with verified/false_positive detections for YOLO retraining
router.get("/export/review", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const images = await prisma.roadImage.findMany({
    where: {
      detections: {
        some: {
          status: { in: ["VERIFIED", "FALSE_POSITIVE"] }
        }
      }
    },
    include: {
      detections: {
        where: { status: { in: ["VERIFIED", "FALSE_POSITIVE"] } }
      }
    }
  });

  res.json(images);
});

module.exports = router;
