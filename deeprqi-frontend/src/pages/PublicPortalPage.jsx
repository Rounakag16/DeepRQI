import { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import { getComplaints, submitComplaint, upvoteComplaint, patchComplaintStatus } from "../api/client";
import { useAuth } from "../context/AuthContext";

// Colored markers based on status
function complaintIcon(status) {
  let color = "#e74c3c"; // OPEN - Red
  if (status === "IN_PROGRESS") color = "#f39c12"; // Yellow
  if (status === "RESOLVED") color = "#2ecc71"; // Green
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 14px; height: 14px; border-radius: 50%;
      background: ${color}; border: 2px solid #fff;
      box-shadow: 0 0 2px rgba(0,0,0,0.5);
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

const DEFAULT_CENTER = [20.5937, 78.9629];
const DEFAULT_ZOOM = 5;

export default function PublicPortalPage() {
  const { user } = useAuth();
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [desc, setDesc] = useState("");
  const [gps, setGps] = useState(null);
  const [cameraStream, setCameraStream] = useState(null);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [capturedBlob, setCapturedBlob] = useState(null);
  const [capturedUrl, setCapturedUrl] = useState(null);
  const [reportFile, setReportFile] = useState(null);

  useEffect(() => {
    loadComplaints();
  }, []);

  async function loadComplaints() {
    try {
      const data = await getComplaints();
      setComplaints(data);
    } catch (err) {
      setError("Failed to load complaints.");
    } finally {
      setLoading(false);
    }
  }

  const handleUpvote = async (id) => {
    if (!user) {
      alert("You must be logged in to upvote reports.");
      return;
    }
    try {
      await upvoteComplaint(id);
      loadComplaints(); // reload to get new count
    } catch (err) {
      alert(err.response?.data?.error || "Upvote failed");
    }
  };

  const handleStatusChange = async (id, newStatus) => {
    try {
      await patchComplaintStatus(id, newStatus);
      loadComplaints();
    } catch (err) {
      alert("Failed to update status");
    }
  };

  const startReporting = async () => {
    setShowForm(true);
    setGps(null);
    setCapturedBlob(null);
    setCapturedUrl(null);
    setReportFile(null);
    
    // 1. Get GPS
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => alert("Could not get GPS location. It is required to report an issue.")
    );

    // 2. Start Camera
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setCameraStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      alert("Could not access camera.");
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      setCameraStream(null);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    
    canvas.toBlob((blob) => {
      setCapturedBlob(blob);
      setCapturedUrl(URL.createObjectURL(blob));
      stopCamera();
    }, "image/jpeg");
  };

  const cancelReport = () => {
    stopCamera();
    setShowForm(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!gps) return alert("Waiting for GPS...");
    if (!desc.trim()) return alert("Please describe the issue.");
    
    setSubmitting(true);
    try {
      await submitComplaint(desc, gps.lat, gps.lng, reportFile || capturedBlob);
      alert("Issue reported successfully!");
      cancelReport();
      loadComplaints();
    } catch (err) {
      alert("Failed to submit report.");
    } finally {
      setSubmitting(false);
    }
  };

  const center = complaints.length > 0 
    ? [complaints[0].lat, complaints[0].lng] 
    : DEFAULT_CENTER;

  return (
    <div className="main">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h2 style={{ fontSize: "22px" }}>Community Portal</h2>
        <button className="btn-primary" onClick={startReporting} disabled={showForm}>
          Report an Issue
        </button>
      </div>

      {showForm && (
        <div className="panel" style={{ marginBottom: "20px" }}>
          <h3 style={{ fontSize: "16px", marginBottom: "15px" }}>Report a Road Issue</h3>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: "15px", position: "relative", background: "#000", minHeight: "200px", borderRadius: "3px", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {!capturedUrl && (
                <>
                  <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", maxHeight: "300px", objectFit: "cover" }} />
                  {cameraStream && (
                    <button type="button" onClick={capturePhoto} style={{ position: "absolute", bottom: "15px", padding: "10px 20px", background: "var(--accent)", color: "#000", border: "none", borderRadius: "20px", fontWeight: "bold", cursor: "pointer" }}>
                      📸 Capture Photo
                    </button>
                  )}
                </>
              )}
              {capturedUrl && <img src={capturedUrl} alt="Captured" style={{ width: "100%", maxHeight: "300px", objectFit: "cover" }} />}
              <canvas ref={canvasRef} style={{ display: "none" }} />
            </div>

            <div className="field">
              <label>Upload Inspection Report PDF (Optional)</label>
              <input 
                type="file" 
                accept="application/pdf" 
                onChange={e => setReportFile(e.target.files[0])}
                style={{ width: "100%", padding: "10px", background: "var(--bg-inset)", border: "1px solid var(--line)", color: "var(--text)", borderRadius: "3px" }}
              />
            </div>

            <div className="field">
              <label>Description of Damage</label>
              <textarea 
                value={desc} 
                onChange={e => setDesc(e.target.value)} 
                placeholder="e.g. Deep pothole causing traffic slowdowns..."
                required
                style={{ height: "80px", width: "100%", padding: "10px", background: "var(--bg-inset)", border: "1px solid var(--line)", color: "var(--text)", borderRadius: "3px" }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "13px", color: gps ? "var(--good)" : "var(--text-muted)" }}>
                {gps ? `📍 GPS: ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : "Acquiring GPS..."}
              </span>
              <div>
                <button type="button" onClick={cancelReport} style={{ background: "none", border: "1px solid var(--line)", color: "var(--text-muted)", padding: "8px 16px", borderRadius: "3px", marginRight: "10px" }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={!gps || submitting}>
                  {submitting ? "Submitting..." : "Submit Report"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}
      
      <div style={{ display: "flex", gap: "20px" }}>
        {/* Map View */}
        <div className="panel" style={{ flex: 2, padding: 0, overflow: "hidden", height: "500px" }}>
          {!loading && (
            <MapContainer center={center} zoom={complaints.length ? 13 : DEFAULT_ZOOM} style={{ height: "100%", width: "100%" }}>
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; OpenStreetMap'
              />
              {complaints.map(c => (
                <Marker key={c.id} position={[c.lat, c.lng]} icon={complaintIcon(c.status)}>
                  <Popup>
                    <strong>{c.status}</strong><br/>
                    {c.description}<br/>
                    <small>Upvotes: {c.voterCount}</small>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          )}
        </div>

        {/* Feed View */}
        <div className="panel" style={{ flex: 1, overflowY: "auto", height: "500px" }}>
          <h3 style={{ fontSize: "16px", marginBottom: "15px" }}>Recent Reports</h3>
          {complaints.length === 0 && <p style={{ color: "var(--text-muted)" }}>No reports yet.</p>}
          {complaints.map(c => (
            <div key={c.id} style={{ padding: "12px", borderBottom: "1px solid var(--line)", marginBottom: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                <span style={{ fontSize: "12px", fontWeight: "bold", color: c.status === "OPEN" ? "#e74c3c" : c.status === "IN_PROGRESS" ? "#f39c12" : "#2ecc71" }}>
                  {c.status}
                </span>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  {new Date(c.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p style={{ fontSize: "14px", margin: "5px 0" }}>{c.description}</p>
              {c.road && <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px" }}>📍 Near {c.road.roadName}</div>}
              
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button 
                  onClick={() => handleUpvote(c.id)}
                  style={{ background: "var(--bg-inset)", border: "1px solid var(--line)", padding: "4px 8px", borderRadius: "3px", color: "var(--text)", cursor: "pointer", fontSize: "12px", display: "flex", alignItems: "center", gap: "5px" }}
                >
                  👍 {c.voterCount} {c.voterCount === 1 ? "Upvote" : "Upvotes"}
                </button>
                
                {user?.role === "ADMIN" && (
                  <select 
                    value={c.status} 
                    onChange={(e) => handleStatusChange(c.id, e.target.value)}
                    style={{ padding: "4px 8px", fontSize: "12px", borderRadius: "3px", border: "1px solid var(--line)", background: "var(--bg-inset)", color: "var(--text)" }}
                  >
                    <option value="OPEN">Mark OPEN</option>
                    <option value="IN_PROGRESS">Mark IN PROGRESS</option>
                    <option value="RESOLVED">Mark RESOLVED</option>
                  </select>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
