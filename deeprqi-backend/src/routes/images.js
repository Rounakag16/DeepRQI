const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");
const { setRoadLocation, findRoadsNear } = require("../lib/geo");
const { reverseGeocode } = require("../lib/geocode");
const { uploadBuffer } = require("../lib/storage");
const { generateExplanation } = require("../lib/xaiSummary");
const { fetchStoredImageBuffer, toDetectionCreateInput } = require("../lib/imageHelpers");

const router = express.Router();

// Keep the upload in memory -- we forward the bytes to FastAPI AND persist
// them to Supabase Storage (Milestone 11); no need to touch local disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB cap
});

const EXT_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// Bug fix: two inspections at the same physical spot were splitting into
// separate Road rows (and separate history) whenever roadName was typed
// with a different case, extra whitespace, or slightly different wording
// between visits -- the old lookup matched on exact roadName+city string
// equality only, never on location. 50m treats "same spot, retyped name"
// as the same road while still keeping genuinely distinct nearby roads
// (different street, different junction) apart.
const ROAD_MATCH_RADIUS_KM = 0.05;

// GET /models must be declared before GET /:id -- both are single path
// segments, and Express would otherwise treat "models" as an :id value.
router.get("/models", requireAuth, async (req, res) => {
  try {
    const { data } = await axios.get(`${process.env.FASTAPI_URL}/models`);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Could not reach the AI service for the model list." });
  }
});

router.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image file provided (field name: 'file')." });
  }

  let { roadName, city, district, state, lat, lng, model } = req.body;
  // Note: validation of roadName is deferred until after geocoding attempt

  try {
    let road = null;
    let geo = null;
    
    // 1. Prefer matching by physical location
    if (lat && lng) {
      const nearby = await findRoadsNear(parseFloat(lat), parseFloat(lng), ROAD_MATCH_RADIUS_KM);
      if (nearby.length > 0) {
        road = await prisma.road.findUnique({ where: { id: nearby[0].id } });
      }
    }

    if (road) {
      // Form didn't provide a roadName, but we found the road by GPS, so use its name.
      if (!roadName) roadName = road.roadName;
      
      // If the road exists but is missing district or state, geocode to fill them in.
      if (lat && lng && (!road.district || !road.state)) {
        geo = await reverseGeocode(parseFloat(lat), parseFloat(lng));
        if (geo) {
          road = await prisma.road.update({
            where: { id: road.id },
            data: {
              district: road.district || geo.district,
              state: road.state || geo.state,
              city: road.city || geo.city,
              postcode: road.postcode || geo.postcode,
              geocodedAt: new Date()
            }
          });
        }
      }
    } else {
      // 2. No road found by GPS.
      // If we are missing fields (especially roadName), try geocoding first.
      if (lat && lng && (!roadName || !city || !district || !state)) {
        geo = await reverseGeocode(parseFloat(lat), parseFloat(lng));
        if (geo) {
          if (!roadName) roadName = geo.road;
          if (!city) city = geo.city;
          if (!district) district = geo.district;
          if (!state) state = geo.state;
        }
      }

      if (!roadName) {
        return res.status(400).json({ error: "roadName is required (or must be resolvable from GPS)." });
      }

      // Fall back to a case/whitespace-insensitive name+city match
      road = await prisma.road.findFirst({
        where: {
          roadName: { equals: roadName.trim(), mode: "insensitive" },
          city: city ? { equals: city.trim(), mode: "insensitive" } : null,
        },
      });

      // 3. Finally, create a new road if it doesn't exist.
      if (!road) {
        road = await prisma.road.create({
          data: { 
            roadName: roadName.trim(), 
            city: city ? city.trim() : null, 
            district: district ? district.trim() : null, 
            state: state ? state.trim() : null,
            postcode: geo ? geo.postcode : null,
            geocodedAt: geo ? new Date() : null
          },
        });
      }
    }

    // Set the road's map location from this image's GPS the first time
    // we have coordinates for it. Later images can update it too (the
    // road "walks" toward wherever it's most recently been photographed) --
    // fine for Phase 2's single-point-per-road model.
    if (lat && lng) {
      await setRoadLocation(road.id, parseFloat(lat), parseFloat(lng));
      road.lat = parseFloat(lat);
      road.lng = parseFloat(lng);
    }

    // 2. Persist the original photo to Supabase Storage regardless of what
    // happens next -- even a "pending analysis" image (AI service down)
    // should have a real, viewable photo behind it, not just a filename.
    const ext = EXT_BY_MIME[req.file.mimetype] || "jpg";
    const uploadToken = crypto.randomUUID();
    const originalUrl = await uploadBuffer(
      req.file.buffer,
      `roads/${road.id}/${uploadToken}-original.${ext}`,
      req.file.mimetype
    );

    // 3. Forward the image to the FastAPI AI service (Milestone 3).
    const form = new FormData();
    form.append("file", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    let aiResponse;
    try {
      aiResponse = await axios.post(
        // model is optional -- omitted, the AI service falls back to its
        // own DEFAULT_MODEL_NAME (see ai-service/app/config.py), so a
        // single-model setup needs no frontend changes at all.
        `${process.env.FASTAPI_URL}/predict${model ? `?model=${encodeURIComponent(model)}` : ""}`,
        form,
        { headers: form.getHeaders(), maxBodyLength: Infinity }
      );
    } catch (err) {
      // Per the spec: don't silently lose the upload if the AI service is
      // down. Persist the image as "pending analysis" and tell the client.
      const roadImage = await prisma.roadImage.create({
        data: {
          roadId: road.id,
          uploadedById: req.user.id,
          imagePath: originalUrl,
          modelUsed: model || null,
          lat: lat ? parseFloat(lat) : null,
          lng: lng ? parseFloat(lng) : null,
        },
      });
      return res.status(502).json({
        error: "AI service unavailable, image saved as pending analysis. Retry later.",
        imageId: roadImage.id,
      });
    }

    const { detections, rqi, heatmap_base64, image_width, image_height } = aiResponse.data;

    // 4. Persist the heatmap PNG too, alongside the original photo.
    const heatmapUrl = await uploadBuffer(
      Buffer.from(heatmap_base64, "base64"),
      `roads/${road.id}/${uploadToken}-heatmap.png`,
      "image/png"
    );

    // 5. Persist everything in one place so the RQI number is always
    // traceable back to the exact image + detections that produced it.
    const roadImage = await prisma.roadImage.create({
      data: {
        roadId: road.id,
        uploadedById: req.user.id,
        imagePath: originalUrl,
        heatmapPath: heatmapUrl,
        modelUsed: model || null,
        lat: lat ? parseFloat(lat) : null,
        lng: lng ? parseFloat(lng) : null,
        imageWidth: image_width || null,
        imageHeight: image_height || null,
        detections: {
          create: toDetectionCreateInput(detections),
        },
      },
      include: { detections: true },
    });

    const rqiScore = await prisma.rqiScore.create({
      data: {
        roadId: road.id,
        imageId: roadImage.id,
        score: rqi.score,
        category: rqi.category,
        totalPenalty: rqi.total_penalty,
        breakdown: rqi.breakdown,
      },
    });

    // heatmap/original are now persisted URLs on `image` -- no need to
    // also ship the raw base64 heatmap in the response.
    res.status(201).json({
      road,
      image: roadImage,
      rqi: { ...rqiScore, explanation: generateExplanation(rqiScore) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Unexpected error processing upload." });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  const image = await prisma.roadImage.findUnique({
    where: { id: req.params.id },
    include: { detections: true, scores: true, road: true },
  });
  if (!image) return res.status(404).json({ error: "Image not found." });
  res.json({
    ...image,
    scores: image.scores.map((s) => ({ ...s, explanation: generateExplanation(s) })),
  });
});

// Retry queue: an image lands here (has an imagePath but no RqiScore) when
// the AI service was down at upload time -- see the 502 branch above. This
// path shape ("/pending/list", two segments) never collides with the
// single-segment "/:id" route above regardless of declaration order.
const PENDING_LIST_DEFAULT_LIMIT = 50;
const PENDING_LIST_MAX_LIMIT = 200;

router.get("/pending/list", requireAuth, async (req, res) => {
  const where = { scores: { none: {} } };
  // INSPECTORs only see their own pending uploads; ADMIN sees everyone's.
  if (req.user.role !== "ADMIN") {
    where.uploadedById = req.user.id;
  }

  // Cursor pagination on id, ordered by uploadedAt desc -- this list has
  // no natural cap (every AI-service outage adds to it), so an unbounded
  // findMany would keep growing slower as real usage accumulates.
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), PENDING_LIST_MAX_LIMIT)
    : PENDING_LIST_DEFAULT_LIMIT;
  const cursor = req.query.cursor ? { id: req.query.cursor } : undefined;

  const pending = await prisma.roadImage.findMany({
    where,
    include: { road: true },
    orderBy: { uploadedAt: "desc" },
    take: limit + 1, // fetch one extra to know whether there's a next page
    ...(cursor ? { cursor, skip: 1 } : {}),
  });

  const hasMore = pending.length > limit;
  const page = hasMore ? pending.slice(0, limit) : pending;

  res.json({
    pending: page,
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
});

// Re-run inference for a pending image. We never kept the original upload
// bytes on this server past the initial request -- but they're durable now
// (Milestone 11, Supabase Storage), so we just pull the persisted photo
// back down and forward it to the AI service again, same as a fresh upload.
router.post("/:id/retry", requireAuth, async (req, res) => {
  const roadImage = await prisma.roadImage.findUnique({
    where: { id: req.params.id },
    include: { scores: true, road: true },
  });
  if (!roadImage) return res.status(404).json({ error: "Image not found." });
  if (roadImage.scores.length > 0) {
    return res.status(400).json({ error: "This image already has a result." });
  }

  // Optional: retry with a specific model instead of whatever was
  // originally requested (or the AI service's default).
  const { model } = req.body || {};

  let imageBuffer;
  try {
    imageBuffer = await fetchStoredImageBuffer(roadImage.imagePath);
  } catch (err) {
    return res.status(502).json({ error: "Could not re-fetch the stored photo. Try again later." });
  }

  const form = new FormData();
  form.append("file", imageBuffer, { filename: "retry.jpg", contentType: "image/jpeg" });

  let aiResponse;
  try {
    aiResponse = await axios.post(
      `${process.env.FASTAPI_URL}/predict${model ? `?model=${encodeURIComponent(model)}` : ""}`,
      form,
      { headers: form.getHeaders(), maxBodyLength: Infinity }
    );
  } catch (err) {
    // Still down -- leave the image exactly as it was, so it stays in the
    // pending list for another retry later.
    return res.status(502).json({ error: "AI service still unavailable. Try again later." });
  }

  const { detections, rqi, heatmap_base64, image_width, image_height } = aiResponse.data;

  const heatmapUrl = await uploadBuffer(
    Buffer.from(heatmap_base64, "base64"),
    `roads/${roadImage.roadId}/${crypto.randomUUID()}-heatmap.png`,
    "image/png"
  );

  const updated = await prisma.roadImage.update({
    where: { id: roadImage.id },
    data: {
      heatmapPath: heatmapUrl,
      modelUsed: model || roadImage.modelUsed || null,
      imageWidth: image_width || roadImage.imageWidth,
      imageHeight: image_height || roadImage.imageHeight,
      detections: {
        create: toDetectionCreateInput(detections),
      },
    },
    include: { detections: true },
  });

  const rqiScore = await prisma.rqiScore.create({
    data: {
      roadId: roadImage.roadId,
      imageId: roadImage.id,
      score: rqi.score,
      category: rqi.category,
      totalPenalty: rqi.total_penalty,
      breakdown: rqi.breakdown,
    },
  });

  res.json({ road: roadImage.road, image: updated, rqi: { ...rqiScore, explanation: generateExplanation(rqiScore) } });
});

// Multi-model comparison: run one already-uploaded photo through several
// named models at once, without touching the DB -- this is a read-only
// "what would model B have said" view, not a re-inspection. The persisted
// RoadImage/RqiScore rows (and its history) are untouched either way.
router.post("/:id/compare", requireAuth, async (req, res) => {
  const { models } = req.body || {};
  if (!Array.isArray(models) || models.length < 2) {
    return res.status(400).json({ error: "Provide at least two model names in the 'models' array to compare." });
  }

  const roadImage = await prisma.roadImage.findUnique({ where: { id: req.params.id } });
  if (!roadImage) return res.status(404).json({ error: "Image not found." });

  let imageBuffer;
  try {
    imageBuffer = await fetchStoredImageBuffer(roadImage.imagePath);
  } catch (err) {
    return res.status(502).json({ error: "Could not re-fetch the stored photo. Try again later." });
  }

  const results = await Promise.all(
    models.map(async (name) => {
      try {
        const form = new FormData();
        form.append("file", imageBuffer, { filename: "compare.jpg", contentType: "image/jpeg" });
        const resp = await axios.post(
          `${process.env.FASTAPI_URL}/predict?model=${encodeURIComponent(name)}`,
          form,
          { headers: form.getHeaders(), maxBodyLength: Infinity }
        );
        return {
          model: name,
          detections: resp.data.detections,
          rqi: { ...resp.data.rqi, explanation: generateExplanation(resp.data.rqi) },
          heatmap_base64: resp.data.heatmap_base64,
        };
      } catch (err) {
        return { model: name, error: err.response?.data?.detail || "Prediction failed for this model." };
      }
    })
  );

  res.json({ image: roadImage, results });
});

// Second XAI method: black-box occlusion sensitivity (see ai-service
// app/occlusion.py) for ONE specific detection, identified by its bbox --
// independent of EigenCAM's activation-based heatmap already returned by
// upload/retry. On-demand only (not run automatically) since it costs
// grid_size^2 model forward passes per call.
router.post("/:id/occlusion", requireAuth, async (req, res) => {
  const { bbox, model, gridSize } = req.body || {};
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return res.status(400).json({ error: "bbox is required: [x1, y1, x2, y2]." });
  }
  // Mirrors the AI service's own grid_size bound (app/main.py) -- checked
  // here too so an out-of-range value fails immediately instead of paying
  // for a photo re-fetch and an upload round-trip before being rejected.
  // Bounded because cost is grid_size^2 model forward passes per call.
  if (gridSize !== undefined) {
    const parsed = Number(gridSize);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
      return res.status(400).json({ error: "gridSize must be an integer between 1 and 12." });
    }
  }

  const roadImage = await prisma.roadImage.findUnique({ where: { id: req.params.id } });
  if (!roadImage) return res.status(404).json({ error: "Image not found." });

  let imageBuffer;
  try {
    imageBuffer = await fetchStoredImageBuffer(roadImage.imagePath);
  } catch (err) {
    return res.status(502).json({ error: "Could not re-fetch the stored photo. Try again later." });
  }

  const form = new FormData();
  form.append("file", imageBuffer, { filename: "occlusion.jpg", contentType: "image/jpeg" });
  form.append("bbox", JSON.stringify(bbox));
  if (model) form.append("model", model);
  if (gridSize) form.append("grid_size", String(gridSize));

  try {
    const resp = await axios.post(
      `${process.env.FASTAPI_URL}/predict/occlusion`,
      form,
      { headers: form.getHeaders(), maxBodyLength: Infinity }
    );
    res.json(resp.data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.detail || "Occlusion analysis failed." });
  }
});

module.exports = router;
