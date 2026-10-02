import axios from "axios";

const baseURL = import.meta.env.VITE_API_URL || "http://localhost:5000";

const client = axios.create({ baseURL });

// Attach the JWT to every request once the user is logged in.
client.interceptors.request.use((config) => {
  const token = localStorage.getItem("deeprqi_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export async function login(email, password) {
  const { data } = await client.post("/api/auth/login", { email, password });
  return data;
}

export async function register(name, email, password, role) {
  const { data } = await client.post("/api/auth/register", { name, email, password, role });
  return data;
}

export async function uploadImage(file, meta) {
  const form = new FormData();
  form.append("file", file);
  form.append("roadName", meta.roadName);
  if (meta.city) form.append("city", meta.city);
  if (meta.district) form.append("district", meta.district);
  if (meta.state) form.append("state", meta.state);
  if (meta.lat) form.append("lat", meta.lat);
  if (meta.lng) form.append("lng", meta.lng);
  if (meta.model) form.append("model", meta.model);

  const { data } = await client.post("/api/images/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function ensureRoad(meta) {
  const { data } = await client.post("/api/roads", meta);
  return data;
}

// Multi-model support: which named models the AI service currently has
// loaded (see ai-service/app/config.py MODEL_REGISTRY). With only one
// model configured this returns a single entry -- callers should treat a
// 1-model response as "nothing to choose," not an error.
export async function getAvailableModels() {
  const { data } = await client.get("/api/images/models");
  return data;
}

// Runs one already-uploaded photo through several named models at once
// (read-only -- doesn't touch the image's persisted result).
export async function compareModels(imageId, models) {
  const { data } = await client.post(`/api/images/${imageId}/compare`, { models });
  return data;
}

// Second XAI method (see backend/src/routes/images.js + ai-service
// app/occlusion.py): black-box occlusion sensitivity for one specific
// detection, identified by its bbox. On-demand -- not run automatically.
export async function getOcclusionMap(imageId, bbox, gridSize) {
  const { data } = await client.post(`/api/images/${imageId}/occlusion`, { bbox, gridSize });
  return data;
}

// Milestone 11: backs ResultsPage's refresh-safe path -- a refresh or
// direct/shared link to /results/:imageId has no router state, so it
// refetches by ID instead.
export async function getImage(id) {
  const { data } = await client.get(`/api/images/${id}`);
  return data;
}

export async function getRoads() {
  const { data } = await client.get("/api/roads");
  return data;
}

export async function getDashboardStats() {
  const { data } = await client.get("/api/dashboard/stats");
  return data;
}

// Repair-priority ranking: every road with >=1 inspection, ranked by
// urgency (see backend/src/lib/priority.js), with a rough repair-cost
// estimate alongside each one (backend/src/lib/repairCost.js). ADMIN-only,
// same as dashboard stats.
export async function getRepairPriorityList() {
  const { data } = await client.get("/api/dashboard/priority");
  return data;
}

export async function getRoad(id) {
  const { data } = await client.get(`/api/roads/${id}`);
  return data;
}

// responseType: "blob" -- this is a PDF, not JSON, so axios must not try
// to parse the body as text/JSON.
export async function getRoadReportBlob(id) {
  const { data } = await client.get(`/api/roads/${id}/report`, { responseType: "blob" });
  return data;
}

// Retry queue: images saved as "pending analysis" when the AI service was
// down at upload time (see POST /api/images/upload's 502 branch).
// Cursor-paginated -- returns { pending, nextCursor }. Pass the previous
// response's nextCursor to fetch the next page; omit it for the first page.
export async function getPendingImages(cursor) {
  const { data } = await client.get("/api/images/pending/list", {
    params: cursor ? { cursor } : undefined,
  });
  return data;
}

export async function retryImage(id) {
  const { data } = await client.post(`/api/images/${id}/retry`);
  return data;
}

// Chatbot: rule-based assistant, see backend/src/lib/chatbot.js.
export async function sendChatMessage(message) {
  const { data } = await client.post("/api/chat", { message });
  return data;
}

export async function reverseGeocode(lat, lng) {
  const { data } = await client.get(`/api/geo/reverse?lat=${lat}&lng=${lng}`);
  return data;
}

export async function patchDetectionStatus(id, status) {
  const { data } = await client.patch(`/api/detections/${id}/status`, { status });
  return data;
}

export async function getSurvey(id) {
  const { data } = await client.get(`/api/surveys/${id}`);
  return data;
}

export async function startSurvey(roadId) {
  const { data } = await client.post("/api/surveys/start", { roadId });
  return data;
}

export async function sendSurveyFrame(sessionId, frameBlob, lat, lng, speed) {
  const form = new FormData();
  form.append("image", frameBlob);
  form.append("lat", lat);
  form.append("lng", lng);
  if (speed !== null && speed !== undefined) form.append("speed", speed);

  const { data } = await client.post(`/api/surveys/${sessionId}/frame`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function endSurvey(sessionId) {
  const { data } = await client.post(`/api/surveys/${sessionId}/end`);
  return data;
}

export async function getComplaints() {
  const { data } = await client.get("/api/complaints");
  return data;
}

export async function submitComplaint(description, lat, lng, imageBlob) {
  const form = new FormData();
  form.append("description", description);
  form.append("lat", lat);
  form.append("lng", lng);
  if (imageBlob) form.append("image", imageBlob);

  const { data } = await client.post("/api/complaints", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function upvoteComplaint(id) {
  const { data } = await client.post(`/api/complaints/${id}/upvote`);
  return data;
}

export async function patchComplaintStatus(id, status) {
  const { data } = await client.patch(`/api/complaints/${id}/status`, { status });
  return data;
}

export default client;
