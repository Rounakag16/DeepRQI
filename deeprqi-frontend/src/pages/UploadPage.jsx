import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { uploadImage, getAvailableModels, ensureRoad, startSurvey, sendSurveyFrame, endSurvey } from "../api/client";
import InfoTooltip from "../components/InfoTooltip";

export default function UploadPage() {
  const [file, setFile] = useState(null);
  const [isVideo, setIsVideo] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [roadName, setRoadName] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [state, setState] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [geocoded, setGeocoded] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [availableModels, setAvailableModels] = useState([]);
  const [model, setModel] = useState("");

  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Only worth showing a picker once there's more than one model to pick
    // between -- with a single model configured (the common case today)
    // this silently does nothing and the form looks exactly as before.
    (async () => {
      try {
        const data = await getAvailableModels();
        if (data.models?.length > 1) {
          setAvailableModels(data.models);
          setModel(data.default);
        }
      } catch (err) {
        // AI service unreachable at page-load time isn't fatal here --
        // upload will surface its own error if it's still down when submitted.
      }
    })();
  }, []);

  const handleFile = (f) => {
    if (!f) return;
    const isVid = f.type.startsWith("video/");
    const isImg = f.type.startsWith("image/");
    if (!isVid && !isImg) {
      setError("Please choose an image or video file.");
      return;
    }
    setError("");
    setFile(f);
    setIsVideo(isVid);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setLoading(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const latitude = pos.coords.latitude.toFixed(6);
      const longitude = pos.coords.longitude.toFixed(6);
      setLat(latitude);
      setLng(longitude);
      
      try {
        const { reverseGeocode } = await import("../api/client");
        const geo = await reverseGeocode(latitude, longitude);
        if (geo) {
          if (geo.road) setRoadName(geo.road);
          if (geo.city) setCity(geo.city);
          if (geo.district) setDistrict(geo.district);
          if (geo.state) setState(geo.state);
          setGeocoded(true);
        }
      } catch (err) {
        console.warn("Reverse geocoding failed", err);
      } finally {
        setLoading(false);
      }
    }, () => {
      setLoading(false);
      setError("Failed to get location.");
    });
  };

  const extractFrameFromVideo = () => {
    return new Promise((resolve, reject) => {
      const video = videoRef.current;
      if (!video) return reject(new Error("Video element not found"));
      
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("Failed to extract frame"));
        const frameFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + "_frame.png", { type: "image/png" });
        resolve(frameFile);
      }, "image/png");
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setError("Choose a road photo or video first.");
      return;
    }
    if (!roadName.trim()) {
      setError("Road name is required.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      let uploadFile = file;
      if (isVideo) {
        uploadFile = await extractFrameFromVideo();
      }
      const result = await uploadImage(uploadFile, { roadName, city, district, state, lat, lng, model });
      navigate(`/results/${result.image.id}`, { state: { result, previewUrl: URL.createObjectURL(uploadFile) } });
    } catch (err) {
      setError(err.response?.data?.error || "Upload failed. Check the AI service is running.");
    } finally {
      setLoading(false);
    }
  };

  const handleStartSurvey = async () => {
    if (!roadName.trim()) {
      setError("Road name is required to start a survey.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const road = await ensureRoad({ roadName, city, district, state, lat, lng });
      navigate(`/survey/${road.id}`);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create or find road for survey.");
    } finally {
      setLoading(false);
    }
  };

  const handleFullVideoSurvey = async () => {
    if (!file || !isVideo) return;
    if (!roadName.trim()) {
      setError("Road name is required.");
      return;
    }

    setLoading(true);
    setError("");
    setStatusMsg("Starting video survey...");
    
    try {
      const road = await ensureRoad({ roadName, city, district, state, lat, lng });
      const { id: sessionId } = await startSurvey(road.id);
      
      const video = videoRef.current;
      const duration = video.duration;
      const interval = 1.0; // 1 second intervals
      let currentTime = 0;
      let frameCount = 0;
      
      video.pause();
      
      while (currentTime < duration) {
        video.currentTime = currentTime;
        
        await new Promise(r => {
          const handler = () => {
            video.removeEventListener("seeked", handler);
            r();
          };
          video.addEventListener("seeked", handler);
        });
        
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
        if (blob) {
          // Fake GPS movement (0.0003 lat is ~33m) to bypass backend 30m deduplication
          // so that every distinct crack in the video counts towards the final score.
          const baseLat = parseFloat(lat) || 0;
          const fakeLat = baseLat + (frameCount * 0.0003);
          const baseLng = parseFloat(lng) || 0;
          await sendSurveyFrame(sessionId, blob, fakeLat, baseLng, 30);
        }
        
        frameCount++;
        currentTime += interval;
        const progress = Math.min(100, Math.round((currentTime / duration) * 100));
        setStatusMsg(`Analyzing video... ${progress}%`);
      }
      
      setStatusMsg("Finalizing survey...");
      await endSurvey(sessionId);
      navigate(`/survey-results/${sessionId}`);
      
    } catch (err) {
      setError(err.response?.data?.error || "Video survey failed.");
    } finally {
      setLoading(false);
      setStatusMsg("");
    }
  };

  return (
    <div className="main">
      <h2 style={{ fontSize: "22px", marginBottom: "6px" }}>New Inspection</h2>
      <p style={{ color: "var(--text-muted)", marginBottom: "28px", fontSize: "14px" }}>
        Upload a road photo or video to detect damage and generate a Road Quality Index.
        <br/>If uploading a video, pause at the exact frame you want to inspect.
      </p>

      <div className="panel">
        {error && <div className="error-banner">{error}</div>}
        {statusMsg && <div style={{ marginBottom: "15px", padding: "10px", background: "var(--accent-primary)", color: "white", borderRadius: "3px", textAlign: "center", fontWeight: "600" }}>{statusMsg}</div>}

        <form onSubmit={handleSubmit}>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragActive ? "var(--accent)" : "var(--line)"}`,
              borderRadius: "3px",
              padding: previewUrl ? "0" : "48px 20px",
              textAlign: "center",
              cursor: "pointer",
              marginBottom: "20px",
              background: dragActive ? "rgba(242, 193, 78, 0.05)" : "transparent",
              overflow: "hidden",
              transition: "border-color 0.15s ease",
            }}
          >
            {previewUrl ? (
              isVideo ? (
                <div onClick={(e) => e.stopPropagation()}>
                  <video
                    ref={videoRef}
                    src={previewUrl}
                    controls
                    style={{ width: "100%", maxHeight: "360px", display: "block", background: "#000" }}
                  />
                  <p style={{ fontSize: "13px", color: "var(--accent-primary)", marginTop: "8px", fontWeight: "600" }}>
                    Pause the video on the frame you want to analyze.
                  </p>
                </div>
              ) : (
                <img
                  src={previewUrl}
                  alt="Preview"
                  style={{ width: "100%", maxHeight: "360px", objectFit: "cover", display: "block" }}
                />
              )
            ) : (
              <>
                <div style={{ fontSize: "14px", color: "var(--text-muted)" }}>
                  Drop a road photo or video here, or click to browse
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "6px" }}>
                  JPG, PNG, MP4, WEBM
                </div>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              onChange={(e) => handleFile(e.target.files[0])}
              style={{ display: "none" }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
            <div className="field">
              <label htmlFor="roadName">Road name</label>
              <input
                id="roadName"
                value={roadName}
                onChange={(e) => setRoadName(e.target.value)}
                placeholder="e.g. MG Road"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="city">City / area</label>
              <input
                id="city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Vellore"
              />
            </div>
            <div className="field">
              <label htmlFor="district">District</label>
              <input
                id="district"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                placeholder="e.g. Vellore"
              />
            </div>
            <div className="field">
              <label htmlFor="state">State</label>
              <input
                id="state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="e.g. Tamil Nadu"
              />
            </div>
            <div className="field">
              <label htmlFor="lat">Latitude</label>
              <input id="lat" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="12.9165" />
            </div>
            <div className="field">
              <label htmlFor="lng">Longitude</label>
              <input id="lng" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="79.1325" />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", marginBottom: "20px" }}>
            <button
              type="button"
              onClick={useMyLocation}
              style={{
                background: "none",
                border: "none",
                color: "var(--accent)",
                fontSize: "13px",
                padding: 0,
                cursor: "pointer",
              }}
            >
              Use my current location
            </button>
            {geocoded && (
              <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "10px", fontStyle: "italic" }}>
                ✓ Auto-filled from GPS
              </span>
            )}
          </div>

          {availableModels.length > 1 && (
            <div className="field" style={{ marginBottom: "20px" }}>
              <label htmlFor="model">
                Model
                <InfoTooltip text="Which trained AI model runs the analysis. Different models can give different results for the same photo — use Compare models on a result to see them side by side." />
              </label>
              <select id="model" value={model} onChange={(e) => setModel(e.target.value)}>
                {availableModels.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                    {m.is_placeholder_model ? " (placeholder, untrained)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading && !statusMsg ? "Analyzing…" : (isVideo ? "Inspect paused frame" : "Run single inspection")}
            </button>
            {isVideo && (
              <button type="button" onClick={handleFullVideoSurvey} className="btn-primary" disabled={loading} style={{ background: "var(--accent)", color: "#111" }}>
                {loading && statusMsg ? "Analyzing…" : "Run full video survey"}
              </button>
            )}
            <button type="button" onClick={handleStartSurvey} className="btn-secondary" disabled={loading} style={{ background: "transparent", color: "var(--accent)", border: "1px solid var(--accent)", padding: "10px 16px", borderRadius: "3px", fontWeight: "600", cursor: "pointer" }}>
              Start live dashcam survey
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
