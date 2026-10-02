const express = require("express");
const { reverseGeocode } = require("../lib/geocode");
const { requireAuth } = require("../middleware/auth"); // Assuming standard auth middleware exists

const router = express.Router();

router.get("/reverse", requireAuth, async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);

  if (isNaN(lat) || lat < -90 || lat > 90) {
    return res.status(400).json({ error: "Invalid lat" });
  }
  if (isNaN(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ error: "Invalid lng" });
  }

  const result = await reverseGeocode(lat, lng);
  if (!result) {
    return res.status(404).json({ error: "Geocoding failed or not found" });
  }

  res.json(result);
});

module.exports = router;
