const { describe, it } = require("node:test");
const assert = require("node:assert");
const { reverseGeocode } = require("../src/lib/geocode");
const axios = require("axios");

// Mock axios temporarily
const originalGet = axios.get;

describe("reverseGeocode", () => {
  it("maps Nominatim JSON to structured fields", async () => {
    // Mock the network response
    axios.get = async () => ({
      data: {
        address: {
          road: "MG Road",
          suburb: "Katpadi",
          city: "Vellore",
          state_district: "Vellore District",
          state: "Tamil Nadu",
          postcode: "632014"
        },
        display_name: "MG Road, Katpadi, Vellore, Vellore District, Tamil Nadu, 632014, India"
      }
    });

    const result = await reverseGeocode(12.9716, 79.1585);
    
    assert.strictEqual(result.road, "MG Road");
    assert.strictEqual(result.suburb, "Katpadi");
    assert.strictEqual(result.city, "Vellore");
    assert.strictEqual(result.district, "Vellore District");
    assert.strictEqual(result.state, "Tamil Nadu");
    assert.strictEqual(result.postcode, "632014");

    // Restore mock
    axios.get = originalGet;
  });

  it("handles empty/missing fields", async () => {
    axios.get = async () => ({
      data: {
        address: {
          road: "Highway 1"
        }
      }
    });

    // Make sure we pass slightly different coords to avoid the LRU cache
    const result = await reverseGeocode(12.0, 79.0);
    assert.strictEqual(result.road, "Highway 1");
    assert.strictEqual(result.city, null);
    assert.strictEqual(result.district, null);

    axios.get = originalGet;
  });
});
