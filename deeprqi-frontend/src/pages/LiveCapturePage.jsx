import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { startSurvey, sendSurveyFrame, endSurvey } from "../api/client";

export default function LiveCapturePage() {
  const { roadId } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);
  
  const [session, setSession] = useState(null);
  const [gpsData, setGpsData] = useState(null);
  const [gpsError, setGpsError] = useState("");
  const [isSurveying, setIsSurveying] = useState(false);
  const [totalDetections, setTotalDetections] = useState(0);
  const [statusMsg, setStatusMsg] = useState("Initializing camera and GPS...");

  // Initialize camera and GPS on mount
  useEffect(() => {
    let watchId;
    let cancelled = false;

    async function init() {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" }
        });
        if (cancelled) {
          mediaStream.getTracks().forEach(t => t.stop());
          return;
        }
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
        
        watchId = navigator.geolocation.watchPosition(
          (pos) => {
            setGpsData({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              speed: pos.coords.speed
            });
            setGpsError("");
          },
          (err) => {
            setGpsError(err.message);
          },
          { enableHighAccuracy: true, maximumAge: 0 }
        );
        
        setStatusMsg("Ready to start survey.");
      } catch (err) {
        setStatusMsg("Failed to access camera or GPS. Please allow permissions.");
      }
    }
    init();

    return () => {
      cancelled = true;
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  const handleStart = async () => {
    try {
      setStatusMsg("Starting session...");
      const { id } = await startSurvey(roadId);
      setSession({ id });
      setIsSurveying(true);
      setStatusMsg("Survey running. Drive carefully.");
    } catch (err) {
      setStatusMsg("Failed to start session.");
    }
  };

  const handleStop = async () => {
    if (!session) return;
    setIsSurveying(false);
    setStatusMsg("Ending session...");
    try {
      await endSurvey(session.id);
      navigate(`/survey-results/${session.id}`);
    } catch (err) {
      setStatusMsg("Failed to end session properly. Data may be incomplete.");
      setTimeout(() => navigate(`/survey-results/${session.id}`), 2000);
    }
  };

  // Frame capture loop
  useEffect(() => {
    if (!isSurveying || !session) return;

    const interval = setInterval(() => {
      if (!gpsData) {
        setStatusMsg("Waiting for GPS signal...");
        return;
      }
      if (gpsData.accuracy > 15) {
        setStatusMsg(`GPS accuracy too low (${Math.round(gpsData.accuracy)}m). Waiting for <15m...`);
        return;
      }

      setStatusMsg("Survey running. Capturing frames...");

      if (videoRef.current && canvasRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(async (blob) => {
          if (!blob) return;
          try {
            const result = await sendSurveyFrame(session.id, blob, gpsData.lat, gpsData.lng, gpsData.speed);
            setTotalDetections(prev => prev + result.newDetectionsCount);
          } catch (err) {
            console.warn("Failed to send frame:", err);
          }
        }, "image/png");
      }
    }, 1500); // Spec asks for every 1.5s

    return () => clearInterval(interval);
  }, [isSurveying, session, gpsData]);

  // Clean up stream on unmount
  useEffect(() => {
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [stream]);

  return (
    <div className="main" style={{ maxWidth: "800px", margin: "0 auto" }}>
      <h2 style={{ fontSize: "22px", marginBottom: "10px" }}>Live Capture Survey</h2>
      
      <div className="panel" style={{ position: "relative", overflow: "hidden", padding: 0, backgroundColor: "#000", minHeight: "400px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          style={{ width: "100%", maxHeight: "60vh", objectFit: "cover" }}
        />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        
        {/* Overlay stats */}
        <div style={{ position: "absolute", top: "10px", left: "10px", background: "rgba(0,0,0,0.6)", color: "white", padding: "10px", borderRadius: "5px", fontSize: "13px" }}>
          <div>GPS: {gpsData ? `${gpsData.lat.toFixed(5)}, ${gpsData.lng.toFixed(5)} (±${Math.round(gpsData.accuracy)}m)` : "Waiting..."}</div>
          <div>Speed: {gpsData?.speed ? `${Math.round(gpsData.speed * 3.6)} km/h` : "N/A"}</div>
          <div style={{ marginTop: "5px", fontSize: "16px", fontWeight: "bold", color: "var(--accent)" }}>
            Deduplicated Defects: {totalDetections}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: "14px", color: gpsError || (gpsData && gpsData.accuracy > 15) ? "var(--critical)" : "var(--text-muted)" }}>
          {statusMsg}
        </div>
        <div>
          {!isSurveying ? (
            <button 
              className="btn-primary" 
              onClick={handleStart}
              disabled={!stream || !gpsData}
            >
              Start Survey
            </button>
          ) : (
            <button 
              style={{ padding: "8px 16px", borderRadius: "3px", fontSize: "13px", background: "var(--critical)", color: "white", border: "none", cursor: "pointer" }}
              onClick={handleStop}
            >
              End Survey
            </button>
          )}
          <button 
            onClick={() => navigate(`/roads/${roadId}`)}
            style={{ marginLeft: "10px", background: "none", border: "1px solid var(--line)", padding: "8px 16px", borderRadius: "3px", fontSize: "13px", color: "var(--text)" }}
            disabled={isSurveying}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
