const axios = require('axios');

const NOMINATIM_URL = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/reverse";
const NOMINATIM_CONTACT = process.env.NOMINATIM_CONTACT || "DeepRQI/1.0";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MS = 1100;

// Simple in-memory LRU cache
class SimpleLRU {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }
  
  get(key) {
    if (!this.cache.has(key)) return null;
    const item = this.cache.get(key);
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    // Refresh position for LRU
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }
  
  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, expiry: Date.now() + CACHE_TTL_MS });
  }
}

const cache = new SimpleLRU(500);

// Request queue to enforce 1100ms rate limit
let lastRequestTime = 0;
let requestQueue = Promise.resolve();

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchFromNominatim(lat, lng) {
  return new Promise((resolve, reject) => {
    requestQueue = requestQueue.then(async () => {
      const now = Date.now();
      const timeSinceLast = now - lastRequestTime;
      if (timeSinceLast < RATE_LIMIT_MS) {
        await delay(RATE_LIMIT_MS - timeSinceLast);
      }
      lastRequestTime = Date.now();
      
      try {
        const response = await axios.get(NOMINATIM_URL, {
          params: {
            lat,
            lon: lng,
            format: 'jsonv2',
            addressdetails: 1,
            zoom: 18
          },
          headers: {
            'User-Agent': NOMINATIM_CONTACT
          },
          timeout: 5000 // 5 seconds timeout
        });
        resolve(response.data);
      } catch (error) {
        resolve(null); // On failure, return null
      }
    });
  });
}

/**
 * Reverse geocodes lat/lng into structured address using Nominatim.
 * Returns null on failure so it never blocks uploads.
 */
async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null;
  
  const cacheKey = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
  const cached = cache.get(cacheKey);
  if (cached !== null) {
    return cached;
  }

  try {
    const data = await fetchFromNominatim(lat, lng);
    if (!data || !data.address) {
      cache.set(cacheKey, null);
      return null;
    }

    const address = data.address;
    const result = {
      road: address.road || address.pedestrian || address.path || null,
      suburb: address.suburb || address.neighbourhood || null,
      city: address.city || address.town || address.village || address.municipality || null,
      district: address.state_district || address.county || null,
      state: address.state || null,
      postcode: address.postcode || null,
      displayName: data.display_name || null
    };

    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error("Geocoding error:", error.message);
    return null;
  }
}

module.exports = {
  reverseGeocode
};
