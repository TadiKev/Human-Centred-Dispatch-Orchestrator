import React, { useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import ProtectedRoute from "./auth/ProtectedRoute";
import { useTheme } from "./theme/ThemeProvider";

import LandingPage from "./pages/LandingPage";
import AuthPage from "./pages/AuthPage";
import JobsPage from "./pages/Jobs";
import TechniciansPage from "./pages/Technicians";
import TechnicianItineraryPage from "./pages/TechnicianItineraryPage";
import MyItineraryPage from "./pages/MyItineraryPage";
import SkillsPage from "./pages/Skills";
import TechDashboard from "./pages/TechDashboard";
import ManagerJobs from "./pages/ManagerJobs";
import ManagerJobDetail from "./pages/ManagerJobDetail";
import ManagerLayout from "./components/ManagerLayout";
import ManagerConflicts from "./pages/ManagerConflicts";
import SlaDashboard from "./components/SlaDashboard";
import AnalyticsDashboard from "./components/AnalyticsDashboard";
import RequestDetails from "./pages/RequestDetails"; // <-- NEW: import request details page

// NEW: customer portal
import CustomerPortal from "./pages/CustomerPortal";

/**
 * App.jsx (theme-aware)
 *
 * Notes:
 * - Ensures the document has a `data-theme` attribute set from the global useTheme hook.
 * - Also writes a set of CSS custom properties to document.documentElement so components that
 *   read `var(--page-bg)` / `var(--text)` get correct values even before ManagerLayout mounts.
 */

function TopNav({ onLogout }) {
  const { auth } = useAuth();
  const user = auth?.user ?? null;
  const { theme } = useTheme();

  // use CSS variables with sensible fallbacks (ensures correct color when variables are present)
  const headerStyle = {
    background: "var(--panel-bg, " + (theme === "dark" ? "#0b1220" : "#ffffff") + ")",
    color: "var(--text, " + (theme === "dark" ? "#e6eef7" : "#0f172a") + ")",
    boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
  };
  const brandStyle = { color: "var(--accent, #16a34a)" };
  const subtleStyle = { color: "var(--muted-2, " + (theme === "dark" ? "#cbd5e1" : "#64748b") + ")" };
  const buttonBase = {
    background: "var(--accent, #16a34a)",
    color: "#fff",
  };

  function dashboardPath() {
    const role = (user?.profile?.role ?? user?.role ?? "").toString().trim().toLowerCase();
    if (role === "technician") return "/tech";
    if (role === "dispatcher" || role === "admin") return "/manager";
    if (role === "customer") return "/portal";
    return "/jobs";
  }

  return (
    <header style={headerStyle} className="mb-6">
      <div className="app-shell flex items-center justify-between py-4 px-4 md:px-8">
        <div className="flex items-center gap-6">
          <Link to="/" className="text-2xl font-bold" style={brandStyle}>HOF-SMART</Link>
          {user && (
            <nav className="hidden md:flex gap-2">
              <Link to={dashboardPath()} className="px-3 py-1 rounded" style={{ color: "var(--text, inherit)" }}>
                Dashboard
              </Link>
            </nav>
          )}
        </div>

        <div className="flex items-center gap-3 text-sm">
          {user ? (
            <>
              <div style={{ color: "var(--text, inherit)" }}>
                Signed in as{" "}
                <strong style={{ color: "var(--text, inherit)" }}>{user.username ?? user.email}</strong>{" "}
                <span style={subtleStyle}>({user?.profile?.role ?? user?.role ?? "?"})</span>
              </div>
              <button
                onClick={onLogout}
                className="px-3 py-1 rounded border text-sm"
                style={{ color: "var(--text, inherit)", borderColor: "rgba(0,0,0,0.06)", background: "transparent" }}
              >
                Logout
              </button>
            </>
          ) : (
            <Link
              to="/auth"
              className="px-3 py-1 rounded"
              style={buttonBase}
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function AppRouterInner() {
  const { auth, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();

  // Keep document-level theme and CSS variables in sync so top-level background is correct
  useEffect(() => {
    try {
      document.documentElement.setAttribute("data-theme", theme);

      if (theme === "dark") {
        document.documentElement.style.setProperty("--page-bg", "#0f172a");
        document.documentElement.style.setProperty("--panel-bg", "#0b1220");
        document.documentElement.style.setProperty("--surface", "#0f172a");
        document.documentElement.style.setProperty("--text", "#e6eef7");
        document.documentElement.style.setProperty("--muted", "#94a3b8");
        document.documentElement.style.setProperty("--muted-2", "#cbd5e1");
        document.documentElement.style.setProperty("--accent", "#16a34a");
        document.documentElement.style.setProperty("--table-head", "#0b1220");
        document.documentElement.style.setProperty("--table-row", "#0b1220");
        document.documentElement.style.setProperty("--table-border", "#334155");

        document.body.style.background = "#0f172a";
        document.body.style.color = "#e6eef7";
      } else {
        document.documentElement.style.setProperty("--page-bg", "#f0fdf4");
        document.documentElement.style.setProperty("--panel-bg", "#ffffff");
        document.documentElement.style.setProperty("--surface", "#ffffff");
        document.documentElement.style.setProperty("--text", "#0f172a");
        document.documentElement.style.setProperty("--muted", "#475569");
        document.documentElement.style.setProperty("--muted-2", "#64748b");
        document.documentElement.style.setProperty("--accent", "#16a34a");
        document.documentElement.style.setProperty("--table-head", "#f8faf5");
        document.documentElement.style.setProperty("--table-row", "#ffffff");
        document.documentElement.style.setProperty("--table-border", "#e6f4ea");

        document.body.style.background = "#f0fdf4";
        document.body.style.color = "#0f172a";
      }
    } catch (e) {
      // ignore
    }
  }, [theme]);

  // redirect unauthenticated users to /auth (but allow landing & auth pages)
  useEffect(() => {
    if (!auth?.user) {
      if (location.pathname === "/" || location.pathname.startsWith("/auth")) return;
      navigate("/auth", { replace: true });
      return;
    }
  }, [auth?.user, location.pathname, navigate]);

  // Auto-redirect authenticated users from root or /auth to their dashboard (including customers -> /portal)
  useEffect(() => {
    if (!auth?.user) return;
    // determine role and desired path
    const role = (auth.user?.profile?.role ?? auth.user?.role ?? "").toString().trim().toLowerCase();
    let path = "/jobs";
    if (role === "technician") path = "/tech";
    else if (role === "dispatcher" || role === "admin") path = "/manager";
    else if (role === "customer") path = "/portal";

    if (location.pathname === "/" || location.pathname.startsWith("/auth")) {
      navigate(path, { replace: true });
    }
  }, [auth?.user, location.pathname, navigate]);

  const mainStyle = {
    background: "var(--page-bg, " + (theme === "dark" ? "#0f172a" : "#f0fdf4") + ")",
    color: "var(--text, " + (theme === "dark" ? "#e6eef7" : "#0f172a") + ")",
    minHeight: "calc(100vh - 80px)",
  };

  return (
    <>
      <TopNav onLogout={logout} />
      <main className="app-shell px-4 md:px-8 pb-12" style={mainStyle}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/auth" element={<AuthPage />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/requests/:id" element={<RequestDetails />} /> {/* NEW: request details route */}
            <Route path="/technicians" element={<TechniciansPage />} />
            <Route path="/skills" element={<SkillsPage />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={["technician", "TECHNICIAN"]} />}>
            <Route path="/tech" element={<TechDashboard />} />
            <Route path="/me/itinerary" element={<MyItineraryPage />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={["dispatcher", "admin", "DISPATCHER", "ADMIN"]} />}>
            <Route path="/manager" element={<ManagerLayout />}>
              <Route index element={<ManagerJobs />} />
              <Route path="jobs" element={<ManagerJobs />} />
              <Route path="jobs/:id" element={<ManagerJobDetail />} />
              <Route path="conflicts" element={<ManagerConflicts />} />
              <Route path="technicians" element={<TechniciansPage />} />
              <Route path="skills" element={<SkillsPage />} />

              <Route
                path="sla"
                element={
                  <SlaDashboard
                    apiBaseUrl="/api"
                    getAuthToken={() => localStorage.getItem("access")}
                  />
                }
              />

              <Route
                path="analytics"
                element={
                  <AnalyticsDashboard
                    apiBase="/api"
                    getAuthToken={() => localStorage.getItem("access")}
                  />
                }
              />
            </Route>
          </Route>

          {/* Customer portal - protected for customer role */}
          <Route element={<ProtectedRoute allowedRoles={["customer", "CUSTOMER"]} />}>
            <Route
              path="/portal"
              element={<CustomerPortal customerId={auth?.user?.profile?.customer_id} />}
            />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={["dispatcher", "admin", "DISPATCHER", "ADMIN"]} />}>
            <Route path="/technicians/:id/itinerary" element={<TechnicianItineraryPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRouterInner />
      </BrowserRouter>
    </AuthProvider>
  );
}
