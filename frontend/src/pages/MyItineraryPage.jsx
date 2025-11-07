// frontend/src/pages/MyItineraryPage.jsx
import React, { useEffect, useState } from "react";
import { apiFetch } from "../api/fetcher";
import { useAuth } from "../auth/AuthProvider";
import TechnicianItinerary from "../components/TechnicianItinerary";
import { Link } from "react-router-dom";
import { useTheme } from "../theme/ThemeProvider";

export default function MyItineraryPage() {
  const { auth } = useAuth();
  const token = auth?.access ?? null;
  const { theme } = useTheme();

  // theme-aware classes
  const pageBg = theme === "dark" ? "bg-slate-900 text-slate-100" : "bg-slate-50 text-slate-900";
  const panel = theme === "dark" ? "bg-slate-800 text-slate-100 border border-slate-700" : "bg-white text-slate-900 border border-gray-200";
  const infoBg = theme === "dark" ? "bg-slate-700 text-slate-100" : "bg-yellow-50 text-slate-900";
  const linkColor = theme === "dark" ? "text-indigo-300" : "text-indigo-600";
  const muted = theme === "dark" ? "text-slate-300" : "text-slate-600";

  const [tech, setTech] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  // ensure data-theme attribute so shared CSS variables apply
  useEffect(() => {
    try {
      document.documentElement.setAttribute("data-theme", theme);
    } catch (e) {
      // ignore (SSR)
    }
  }, [theme]);

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    setLoading(true);
    setErr(null);

    apiFetch("/api/technicians/me/", { token })
      .then((res) => {
        if (!mounted) return;
        setTech(res);
      })
      .catch((e) => {
        console.error("fetch /api/technicians/me/ failed", e);
        if (!mounted) return;
        if (e?.status === 404) setErr("No technician profile found for this account.");
        else if (e?.status === 401) setErr("Not authenticated. Please sign in again.");
        else setErr("Failed to load your technician profile.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [token]);

  if (!token) {
    return (
      <div className={`${pageBg} p-6 min-h-[40vh]`}>
        <div className={`${panel} p-4 rounded text-sm`}>
          Sign in to view your itinerary.{" "}
          <Link to="/auth" className={`${linkColor} underline`}>Sign in</Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`${pageBg} p-6 min-h-[40vh]`}>
        <div className={`${panel} p-4 rounded`}>Loading your technician profile…</div>
      </div>
    );
  }

  if (err) {
    return (
      <div className={`${pageBg} p-6 min-h-[40vh]`}>
        <div className={`${infoBg} p-4 rounded text-sm`}>
          <div className="mb-2">Unable to load your technician profile:</div>
          <div className={`${muted} mb-3`}>{err}</div>
          <div>
            If you should have a technician account, contact your administrator, or try refreshing your profile.
          </div>
        </div>
      </div>
    );
  }

  if (!tech || !tech.id) {
    return (
      <div className={`${pageBg} p-6 min-h-[40vh]`}>
        <div className={`${panel} p-4 rounded`}>
          <div className="text-sm">No technician profile found for your account.</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${pageBg} p-6`}>
      <div className="mb-4">
        <Link to="/tech" className={`${linkColor} underline`}>&larr; Back</Link>
      </div>

      <div className="rounded shadow-sm">
        <TechnicianItinerary techId={tech.id} />
      </div>
    </div>
  );
}
