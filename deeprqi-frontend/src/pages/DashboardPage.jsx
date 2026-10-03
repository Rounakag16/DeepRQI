import { useEffect, useState, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import { Link } from "react-router-dom";
import L from "leaflet";
import { getRoads, getDashboardStats } from "../api/client";
import { bandForScore } from "../utils/rqiBands";
import StatsCards from "../components/StatsCards";
import RqiGauge from "../components/RqiGauge";
import AISummaryPanel from "../components/AISummaryPanel";

// Leaflet's default marker image paths break under most bundlers (Vite
// included) because it expects them relative to the CSS file, not the JS
// module graph. A colored divIcon sidesteps that entirely -- no broken
// image requests, and it doubles as the RQI-band color coding for free.
function bandIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 16px; height: 16px; border-radius: 50%;
      background: ${color}; border: 2px solid #17191c;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.4);
    "></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

const DEFAULT_CENTER = [20.5937, 78.9629]; // India centroid, fallback only
const DEFAULT_ZOOM = 5;

function BudgetPlanner({ poorCriticalRoads }) {
  const [budget, setBudget] = useState(1000000);
  const [costPerKm, setCostPerKm] = useState(50000);

  const fixableRoads = useMemo(() => {
    if (!poorCriticalRoads || poorCriticalRoads.length === 0) return 0;
    const sorted = [...poorCriticalRoads].sort((a, b) => a.score - b.score);
    let remainingBudget = budget;
    let count = 0;
    
    for (const road of sorted) {
      const cost = road.distance * costPerKm;
      if (remainingBudget >= cost) {
        remainingBudget -= cost;
        count++;
      } else {
        break;
      }
    }
    return count;
  }, [budget, costPerKm, poorCriticalRoads]);

  return (
    <div className="panel" style={{ marginTop: "20px" }}>
      <h3 style={{ fontSize: "16px", marginBottom: "15px" }}>Budget Planner</h3>
      <div style={{ display: "flex", gap: "20px", marginBottom: "15px" }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Total Budget ($)</label>
          <input type="number" value={budget} onChange={e => setBudget(Number(e.target.value))} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Cost per KM ($)</label>
          <input type="number" value={costPerKm} onChange={e => setCostPerKm(Number(e.target.value))} />
        </div>
      </div>
      <div style={{ padding: "15px", background: "var(--bg)", borderRadius: "3px", border: "1px solid var(--line)" }}>
        With <strong>${budget.toLocaleString()}</strong>, you can fully repair <strong style={{ color: "var(--accent)", fontSize: "18px" }}>{fixableRoads}</strong> out of {poorCriticalRoads?.length || 0} Critical/Poor roads (prioritizing the lowest RQI first).
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [roads, setRoads] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [roadsData, statsData] = await Promise.all([getRoads(), getDashboardStats()]);
        if (!cancelled) {
          setRoads(roadsData);
          setStats(statsData);
        }
      } catch (err) {
        if (!cancelled) setError("Could not load dashboard data. Is the backend running?");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const mappedRoads = roads.filter((r) => r.lat != null && r.lng != null);

  const center = useMemo(() => {
    if (mappedRoads.length === 0) return DEFAULT_CENTER;
    const avgLat = mappedRoads.reduce((s, r) => s + r.lat, 0) / mappedRoads.length;
    const avgLng = mappedRoads.reduce((s, r) => s + r.lng, 0) / mappedRoads.length;
    return [avgLat, avgLng];
  }, [mappedRoads]);

  return (
    <div className="main">
      <h2 style={{ fontSize: "22px", marginBottom: "20px" }}>Dashboard</h2>

      {error && <div className="error-banner">{error}</div>}
      {loading && <p style={{ color: "var(--text-muted)" }}>Loading…</p>}

      {!loading && !error && (
        <>
          <StatsCards stats={stats} />

          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <MapContainer
              center={center}
              zoom={mappedRoads.length ? 12 : DEFAULT_ZOOM}
              style={{ height: "480px", width: "100%" }}
            >
              {/* OpenStreetMap tiles -- free, no API key, no billing setup. */}
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />
              {mappedRoads.map((road) => {
                const band = road.latestScore ? bandForScore(road.latestScore.score) : null;
                const color = band ? band.color : "#8b9096"; // grey = no score yet
                return (
                  <Marker key={road.id} position={[road.lat, road.lng]} icon={bandIcon(color)}>
                    <Popup>
                      <strong>{road.roadName}</strong>
                      <br />
                      {[road.city, road.district, road.state].filter(Boolean).join(", ") || "—"}
                      <br />
                      {road.latestScore ? (
                        <>
                          RQI: <strong>{Math.round(road.latestScore.score)}</strong> ({road.latestScore.category})
                        </>
                      ) : (
                        "No inspections yet"
                      )}
                      <br />
                      <Link to={`/roads/${road.id}`}>View history →</Link>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          </div>

          <div style={{ display: "flex", gap: "20px", marginTop: "20px" }}>
            <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <h3 style={{ fontSize: "16px", marginBottom: "10px", alignSelf: "flex-start" }}>Network RQI</h3>
              <p style={{ color: "var(--text-muted)", fontSize: "13px", marginBottom: "15px", alignSelf: "flex-start" }}>
                {stats.pctPoorCritical}% of network is in Critical or Poor condition.
              </p>
              {stats.avgScore != null ? (
                <RqiGauge score={stats.avgScore} category={bandForScore(stats.avgScore).label} />
              ) : (
                <p style={{ color: "var(--text-muted)" }}>No data</p>
              )}
            </div>

            <div style={{ flex: 2 }}>
              <BudgetPlanner poorCriticalRoads={stats.poorCriticalRoads} />
            </div>
          </div>

          {/* AI Network Summary */}
          <AISummaryPanel
            title="AI Executive Summary"
            prompt={`Generate an executive summary for a city road maintenance administrator:\n\nNetwork Statistics:\n- Total roads monitored: ${stats.totalRoads}\n- Roads with inspections: ${stats.scoredRoads}\n- Average RQI across network: ${stats.avgScore || "N/A"}\n- Roads in Critical condition: ${stats.criticalCount}\n- Percentage in Poor/Critical: ${stats.pctPoorCritical}%\n\nProvide:\n1. Overall network health assessment (1-2 sentences)\n2. Key areas of concern\n3. Budget allocation priorities\n4. Recommended immediate actions`}
          />

          {roads.length > mappedRoads.length && (
            <p style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "10px" }}>
              {roads.length - mappedRoads.length} road(s) not shown — no GPS coordinates recorded yet.
            </p>
          )}
        </>
      )}
    </div>
  );
}
