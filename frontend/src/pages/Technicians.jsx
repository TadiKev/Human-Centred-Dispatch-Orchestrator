// frontend/src/pages/Technicians.jsx
import React, { useEffect, useState } from "react";
import { apiFetch } from "../api/fetcher";
import { useAuth } from "../auth/AuthProvider";
import TechnicianItinerary from "../components/TechnicianItinerary";
import { useTheme } from "../theme/ThemeProvider";

/**
 * TechniciansPage (theme-aware, responsive)
 * - Ensures dark-mode text stays bright
 * - Prevents right-panel from forcing horizontal overflow
 * - Adds min-w-0 / truncation so long text doesn't break layout
 * - Right panel participates in grid (no fixed width)
 * - Adds theme-aware custom scrollbar styling (WebKit + Firefox)
 */

function Badge({ children, className = "" }) {
  const { theme } = useTheme();
  const base = "inline-block text-xs px-2 py-0.5 rounded-full border";
  const themeCls =
    theme === "dark"
      ? "bg-slate-700 text-slate-100 border-slate-600"
      : "bg-slate-50 text-slate-700 border-slate-200";
  return <span className={`${base} ${themeCls} ${className}`}>{children}</span>;
}

export default function TechniciansPage() {
  const { auth } = useAuth();
  const token = auth?.access ?? null;
  const { theme } = useTheme();

  // ensure global data-theme attribute so shared CSS applies
  useEffect(() => {
    try {
      document.documentElement.setAttribute("data-theme", theme);
    } catch (e) {
      // ignore in SSR
    }
  }, [theme]);

  const [techs, setTechs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [selectedTechId, setSelectedTechId] = useState(null);
  const [selectedTechName, setSelectedTechName] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/api/technicians/", { token });
      const items = Array.isArray(data) ? data : data.results ?? [];
      setTechs(items);
    } catch (err) {
      console.error("Failed to load technicians:", err);
      setError(err?.message ?? "Failed to load technicians");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function openItinerary(t) {
    setSelectedTechId(t.id);
    setSelectedTechName(t.user?.username ?? `Tech ${t.id}`);
    setTimeout(() => {
      const el = document.getElementById("itinerary-panel");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  function closeItinerary() {
    setSelectedTechId(null);
    setSelectedTechName("");
  }

  // theme-aware classes
  const pageBg = theme === "dark" ? "bg-slate-900 text-slate-100" : "bg-slate-50 text-slate-900";
  const titleClass = theme === "dark" ? "text-slate-100" : "text-slate-800";
  const muted = theme === "dark" ? "text-slate-300" : "text-slate-500";
  const smallMuted = theme === "dark" ? "text-slate-400" : "text-slate-500";
  const cardClass = theme === "dark" ? "bg-slate-800 text-slate-100 border border-slate-700" : "bg-white text-slate-900 border border-gray-200";
  const btnPrimary = theme === "dark" ? "px-3 py-1 rounded border border-indigo-600 text-indigo-200 hover:bg-indigo-600/10 text-sm" : "px-3 py-1 rounded border border-indigo-600 text-indigo-600 hover:bg-indigo-50 text-sm";
  const btnBorder = theme === "dark" ? "px-3 py-1 rounded border border-slate-600 text-slate-100 hover:bg-slate-700/20 text-sm" : "px-3 py-1 rounded border border-slate-200 hover:bg-slate-50 text-sm";
  const listItemHover = theme === "dark" ? "hover:shadow-sm hover:bg-slate-800/50" : "hover:shadow-sm hover:bg-white";

  return (
    <div className={`${pageBg} p-6 min-h-[60vh]`}>
      {/* Theme-aware scrollbar styles (applied to #itinerary-panel and overflow-auto elements) */}
      <style>{`
        /* Use data-theme attribute to choose colors */
        [data-theme="dark"] {
          --scroll-track: rgba(255,255,255,0.03);
          --scroll-thumb: rgba(255,255,255,0.12);
          --scroll-thumb-hover: rgba(255,255,255,0.18);
        }
        [data-theme="light"] {
          --scroll-track: rgba(0,0,0,0.03);
          --scroll-thumb: rgba(0,0,0,0.16);
          --scroll-thumb-hover: rgba(0,0,0,0.22);
        }

        /* WebKit-based browsers */
        #itinerary-panel.overflow-auto::-webkit-scrollbar,
        #itinerary-panel::-webkit-scrollbar,
        .overflow-auto::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        #itinerary-panel.overflow-auto::-webkit-scrollbar-track,
        #itinerary-panel::-webkit-scrollbar-track,
        .overflow-auto::-webkit-scrollbar-track {
          background: var(--scroll-track);
          border-radius: 8px;
        }
        #itinerary-panel.overflow-auto::-webkit-scrollbar-thumb,
        #itinerary-panel::-webkit-scrollbar-thumb,
        .overflow-auto::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, var(--scroll-thumb), var(--scroll-thumb));
          border-radius: 8px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        #itinerary-panel.overflow-auto::-webkit-scrollbar-thumb:hover,
        #itinerary-panel::-webkit-scrollbar-thumb:hover,
        .overflow-auto::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, var(--scroll-thumb-hover), var(--scroll-thumb-hover));
        }

        /* Firefox */
        #itinerary-panel.overflow-auto,
        #itinerary-panel,
        .overflow-auto {
          scrollbar-width: thin;
          scrollbar-color: var(--scroll-thumb) var(--scroll-track);
        }

        /* Slightly rounded inner container to visually separate the scrollbar in dark mode */
        [data-theme="dark"] #itinerary-panel {
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
        }
      `}</style>

      <div className="flex items-center justify-between mb-6">
        <h2 className={`text-2xl font-semibold ${titleClass}`}>Technicians</h2>
        <div className="flex gap-2">
          <button
            onClick={load}
            className={btnBorder}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-rose-600">{error}</div>}

      {/* Grid: left list takes 2 columns, right panel takes 1 column (no fixed widths) */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* Left: main list (span 2) */}
        <div className={`md:col-span-2 ${cardClass} shadow-sm rounded-lg p-4 overflow-hidden`}>
          {loading ? (
            <div className={`p-6 text-center ${muted}`}>Loading…</div>
          ) : techs.length === 0 ? (
            <div className={`p-6 text-center ${muted}`}>No technicians yet.</div>
          ) : (
            <ul className="space-y-3">
              {techs.map((t) => (
                <li
                  key={t.id}
                  className={`p-4 border rounded-lg transition ${listItemHover}`}
                  style={ theme === "dark" ? { borderColor: "rgba(148,163,184,0.08)" } : undefined }
                >
                  <div className="flex items-start justify-between min-w-0">
                    <div className="min-w-0">
                      <div className={`font-medium truncate ${titleClass}`}>
                        {t.user?.username ?? t.user?.email ?? `Tech ${t.id}`}
                      </div>
                      <div className={`text-sm mt-1 ${smallMuted} truncate`}>
                        {t.status ?? "status unknown"}
                      </div>
                      {t.user?.profile?.role && (
                        <div className={`text-xs mt-1 ${muted}`}>Role: {t.user.profile.role}</div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 ml-4" style={{ flexShrink: 0 }}>
                      <div className={`text-sm ${smallMuted} mr-3 text-right`} style={{ minWidth: 120 }}>
                        {t.last_lat && t.last_lon ? `${Number(t.last_lat).toFixed(4)}, ${Number(t.last_lon).toFixed(4)}` : "n/a"}
                      </div>

                      <button
                        className={btnPrimary}
                        onClick={() => openItinerary(t)}
                      >
                        View itinerary
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {t.skills && t.skills.length > 0 ? t.skills.map((s) => (
                      <Badge key={s.id} className="mr-1">{s.name}</Badge>
                    )) : <div className={`text-sm ${smallMuted}`}>No skills listed</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right: itinerary panel — participate in the grid (no fixed width), constrained height + scroll */}
        <aside
          id="itinerary-panel"
          className={`${cardClass} shadow-sm rounded-lg p-4 md:col-span-1 overflow-auto`}
          style={{ maxHeight: "calc(100vh - 180px)" }}
        >
          {selectedTechId ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <h3 className={`text-lg font-semibold ${titleClass}`}>Itinerary — {selectedTechName}</h3>
                <button onClick={closeItinerary} className={btnBorder}>Close</button>
              </div>

              <div>
                <TechnicianItinerary techId={selectedTechId} compact={true} />
              </div>
            </>
          ) : (
            <div className={`p-6 text-sm ${smallMuted}`}>
              Select a technician and click <strong className={titleClass}>View itinerary</strong> to see current vs optimized routes.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
