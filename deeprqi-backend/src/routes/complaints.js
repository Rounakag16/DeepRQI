const express = require("express");
const multer = require("multer");
const prisma = require("../lib/prisma");
const { findRoadsNear } = require("../lib/geo");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/complaints -- Public unauthenticated endpoint
router.post("/", upload.single("image"), async (req, res) => {
  const { description } = req.body;
  const lat = parseFloat(req.body.lat);
  const lng = parseFloat(req.body.lng);

  if (!description || isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: "description, lat, and lng are required." });
  }

  // Find nearest road within 50m to optionally link it
  const nearRoads = await findRoadsNear(lat, lng, 0.05);
  const roadId = nearRoads.length > 0 ? nearRoads[0].id : null;

  // Milestone 17 allows skipping image upload for now, or just not saving to storage unless required
  // If we had S3 configured, we'd upload it here. For the prototype, we leave imagePath null.
  
  const complaint = await prisma.complaint.create({
    data: {
      roadId,
      lat,
      lng,
      description,
      imagePath: null, // Stubbed for prototype without S3
    },
  });

  res.status(201).json(complaint);
});

// GET /api/complaints -- Public
router.get("/", async (req, res) => {
  const complaints = await prisma.complaint.findMany({
    orderBy: { createdAt: "desc" },
    include: { road: { select: { roadName: true } } }
  });
  res.json(complaints);
});

// POST /api/complaints/:id/upvote -- Authenticated (1 vote per account)
router.post("/:id/upvote", requireAuth, async (req, res) => {
  try {
    // Try to create the upvote record
    await prisma.complaintUpvote.create({
      data: {
        complaintId: req.params.id,
        userId: req.user.id
      }
    });
    
    // If successful (no unique constraint violation), increment the count
    const complaint = await prisma.complaint.update({
      where: { id: req.params.id },
      data: { voterCount: { increment: 1 } },
    });
    res.json(complaint);
  } catch (err) {
    if (err.code === 'P2002') {
      // Unique constraint failed = already upvoted
      return res.status(400).json({ error: "You have already upvoted this report." });
    }
    return res.status(500).json({ error: "Could not process upvote." });
  }
});

// PATCH /api/complaints/:id/status -- ADMIN only
router.patch("/:id/status", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { status } = req.body;
  if (!["OPEN", "IN_PROGRESS", "RESOLVED"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }
  
  const complaint = await prisma.complaint.update({
    where: { id: req.params.id },
    data: { status },
  });
  res.json(complaint);
});

module.exports = router;
