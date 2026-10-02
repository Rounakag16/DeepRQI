import { BrowserRouter, Routes, Route, Link, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import LoginPage from "./pages/LoginPage";
import UploadPage from "./pages/UploadPage";
import ResultsPage from "./pages/ResultsPage";
import DashboardPage from "./pages/DashboardPage";
import RoadDetailPage from "./pages/RoadDetailPage";
import PendingPage from "./pages/PendingPage";
import ModelComparePage from "./pages/ModelComparePage";
import RepairPriorityPage from "./pages/RepairPriorityPage";
import ChatWidget from "./components/ChatWidget";
import LiveCapturePage from "./pages/LiveCapturePage";
import PublicPortalPage from "./pages/PublicPortalPage";
import LandingPage from "./pages/LandingPage";
import SurveyDetailsPage from "./pages/SurveyDetailsPage";

function Topbar() {
  const { user, logout } = useAuth();

  return (
    <div className="topbar">
      <div className="topbar__brand">
        <Link to="/" style={{ textDecoration: "none" }}>
          <h1>
            Deep<span className="mark">RQI</span>
          </h1>
        </Link>
      </div>
      <div className="topbar__nav">
        {user ? (
          <>
            {user.role === "ADMIN" && (
              <Link to="/dashboard" style={{ color: "var(--text-primary)", textDecoration: "none" }}>
                Dashboard
              </Link>
            )}
            {user.role === "ADMIN" && (
              <Link to="/priority" style={{ color: "var(--text-primary)", textDecoration: "none" }}>
                Repair priority
              </Link>
            )}
            <Link to="/upload" style={{ color: "var(--text-primary)", textDecoration: "none" }}>
              New Inspection
            </Link>
            <Link to="/pending" style={{ color: "var(--text-primary)", textDecoration: "none" }}>
              Pending
            </Link>
            <Link to="/portal" style={{ color: "var(--text-primary)", textDecoration: "none" }}>
              Public Portal
            </Link>
            <span className="mono" style={{ color: "var(--accent-primary)" }}>{user.name}</span>
            <button onClick={logout}>Log out</button>
          </>
        ) : (
          <>
            <Link to="/portal" style={{ color: "var(--text-primary)", textDecoration: "none" }}>
              Public Portal
            </Link>
            <Link to="/login" className="btn-login" style={{ textDecoration: "none" }}>
              Sign In
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function AuthedChatWidget() {
  const { user } = useAuth();
  if (!user) return null;
  return <ChatWidget />;
}

function AppRoutes() {
  const { user } = useAuth();
  // Milestone 10: ADMIN lands on the dashboard (aggregate view), INSPECTOR
  // lands on upload (field work) -- neither role has a route it can't reach
  // from its own default landing page.
  const homePath = user ? (user.role === "ADMIN" ? "/dashboard" : "/upload") : "/";

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={user ? <Navigate to={homePath} /> : <LoginPage />} />
      <Route path="/portal" element={<PublicPortalPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute roles={["ADMIN"]}>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/priority"
        element={
          <ProtectedRoute roles={["ADMIN"]}>
            <RepairPriorityPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/roads/:id"
        element={
          <ProtectedRoute>
            <RoadDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/pending"
        element={
          <ProtectedRoute>
            <PendingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/upload"
        element={
          <ProtectedRoute>
            <UploadPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/results/:imageId"
        element={
          <ProtectedRoute>
            <ResultsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/compare/:imageId"
        element={
          <ProtectedRoute>
            <ModelComparePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/survey/:roadId"
        element={
          <ProtectedRoute>
            <LiveCapturePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/survey-results/:id"
        element={
          <ProtectedRoute>
            <SurveyDetailsPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to={homePath} />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="app-shell">
          <Topbar />
          <AppRoutes />
          <AuthedChatWidget />
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}
