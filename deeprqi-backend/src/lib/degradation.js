// Repair-deadline projection: a simple least-squares linear fit of RQI
// score vs. time, extrapolated forward to the point it crosses the app's
// own band thresholds (see frontend/utils/rqiBands.js and the AI service's
// RQI_BANDS -- both agree Critical < 25, Very Poor < 40).
//
// This is a heuristic trend line, not a validated predictive model -- it
// has no knowledge of traffic load, climate, or repair history, and it's
// only as good as however many inspections exist for the road. It exists
// to turn "this road is declining" into a concrete, auditable date rather
// than a vague warning, matching the project's broader "explainable, not
// black-box" framing.

const CRITICAL_THRESHOLD = 25; // "Critical" band cutoff -- effectively unridable
const POOR_THRESHOLD = 40; // "Very Poor" cutoff -- used as an earlier warning point
const REPAIR_LEAD_DAYS = 30; // recommend finishing repairs this many days before the critical date
const MS_PER_DAY = 86400000;

/**
 * @param {{score: number, generatedAt: Date|string}[]} scoreHistory
 * @param {object} [options]
 * @param {Date|null} [options.since] - Optional date of the latest repair event.
 * @returns {object} forecast -- see individual branches for shape
 */
function predictDegradation(scoreHistory, options = {}) {
  const { since = null } = options;

  const points = (scoreHistory || [])
    .filter((s) => s && s.score != null && s.generatedAt)
    .map((s) => ({ score: s.score, generatedAt: new Date(s.generatedAt) }))
    .filter((s) => !since || s.generatedAt >= since)
    .sort((a, b) => a.generatedAt - b.generatedAt);

  if (points.length === 0) {
    return { predictable: false, reason: "No inspections recorded yet." };
  }

  // "Already critical" is a snapshot fact about the latest score, not a
  // forecast -- compute it once, up front, so it's available even when
  // there isn't enough history yet to fit a trend line (points.length < 2
  // used to skip this entirely, silently under-flagging a road that was
  // already bad on its very first inspection).
  const latestScore = points[points.length - 1].score;
  const alreadyCritical = latestScore < CRITICAL_THRESHOLD;

  if (points.length < 2) {
    return {
      predictable: false,
      reason: since 
        ? "Needs at least two inspections since the last repair to establish a new trend."
        : "Needs at least two inspections to establish a trend.",
      alreadyCritical,
      latestRepairAt: since,
    };
  }

  const t0 = points[0].generatedAt.getTime();
  const xs = points.map((p) => (p.generatedAt.getTime() - t0) / MS_PER_DAY); // days since first inspection
  const ys = points.map((p) => p.score);
  const n = xs.length;

  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumXX - sumX * sumX;

  if (denom === 0) {
    // All inspections landed on the same date -- no time axis to fit against.
    return {
      predictable: false,
      reason: "Not enough spread in inspection dates to fit a trend.",
      alreadyCritical,
      latestRepairAt: since,
    };
  }

  const slope = (n * sumXY - sumX * sumY) / denom; // RQI points per day
  const intercept = (sumY - slope * sumX) / n;

  // A flat or improving trend has no "deadline" to project.
  if (slope >= -0.01) {
    return {
      predictable: false,
      reason: "RQI is stable or improving over the recorded history -- no decline to project forward.",
      trendPointsPerMonth: Math.round(slope * 30 * 100) / 100,
      alreadyCritical,
      latestRepairAt: since,
    };
  }

  const daysToScore = (targetScore) => (targetScore - intercept) / slope;
  const latestDays = xs[xs.length - 1];

  const daysToCritical = daysToScore(CRITICAL_THRESHOLD);
  const daysToPoorWarning = daysToScore(POOR_THRESHOLD);

  // Only report a projected date if the crossing is still ahead of the most
  // recent inspection -- if the road is already past a threshold, that's a
  // current fact, not a projection.
  const projectedCriticalDate =
    !alreadyCritical && daysToCritical > latestDays ? new Date(t0 + daysToCritical * MS_PER_DAY) : null;
  const projectedPoorDate =
    latestScore >= POOR_THRESHOLD && daysToPoorWarning > latestDays
      ? new Date(t0 + daysToPoorWarning * MS_PER_DAY)
      : null;

  const recommendedRepairByDate = projectedCriticalDate
    ? new Date(projectedCriticalDate.getTime() - REPAIR_LEAD_DAYS * MS_PER_DAY)
    : null;

  return {
    predictable: true,
    alreadyCritical,
    trendPointsPerMonth: Math.round(slope * 30 * 100) / 100, // negative = declining
    projectedPoorDate,
    projectedCriticalDate,
    recommendedRepairByDate,
    latestRepairAt: since,
  };
}

module.exports = { predictDegradation, CRITICAL_THRESHOLD, POOR_THRESHOLD, REPAIR_LEAD_DAYS };
