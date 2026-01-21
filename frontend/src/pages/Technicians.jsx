// frontend/src/pages/Technicians.jsx
import React, { useEffect, useState, useRef } from "react";
import { apiFetch } from "../api/fetcher";
import { useAuth } from "../auth/AuthProvider";
import TechnicianItinerary from "../components/TechnicianItinerary";
import TechnicianWorkloadPanel from "../components/TechnicianWorkloadPanel";
import { useTheme } from "../theme/ThemeProvider";

/* small UI atoms */
function FatigueBar({ score = 0 }) {
  const pct = Math.round((score || 0) * 100);
  let color = "bg-emerald-500";
  let label = "Low";

  if (score >= 0.8) {
    color = "bg-rose-500";
    label = "High";
  } else if (score >= 0.6) {
    color = "bg-amber-500";
    label = "Medium";
  }

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-slate-600 dark:text-slate-300">Fatigue</span>
        <span className="text-xs font-medium">{label} — {pct}%</span>
      </div>
      <div className="w-full h-2 rounded bg-slate-100 dark:bg-slate-700 overflow-hidden">
        <div className={`${color} h-2`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Badge({ children }) {
  return (
    <span className="inline-block text-xs px-2 py-0.5 rounded-full border bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600">
      {children}
    </span>
  );
}

export default function TechniciansPage() {
  const { auth } = useAuth();
  const token = auth?.access ?? null;
  const { theme } = useTheme();

  const [techs, setTechs] = useState([]);
  const [workloadItems, setWorkloadItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingWorkload, setLoadingWorkload] = useState(false);
  const [error, setError] = useState(null);
  const [workloadError, setWorkloadError] = useState(null);

  const [selectedTech, setSelectedTech] = useState(null);
  const [expandedExplanationId, setExpandedExplanationId] = useState(null);

  // cache for reverse geocode results during the page lifetime
  const reverseCacheRef = useRef({});

  useEffect(() => {
    try {
      document.documentElement.setAttribute("data-theme", theme);
    } catch (e) {}
  }, [theme]);

  // fetch and merge
  async function load() {
    setLoading(true);
    setError(null);
    setWorkloadError(null);
    setLoadingWorkload(true);

    try {
      const [tResp, wResp] = await Promise.allSettled([
        apiFetch("/api/technicians/", { token }),
        apiFetch("/api/technician-workload/", { token }),
      ]);

      let technicians = [];
      if (tResp.status === "fulfilled") {
        const data = tResp.value;
        technicians = Array.isArray(data) ? data : data.results ?? [];
      } else {
        throw tResp.reason || new Error("Failed to fetch technicians");
      }

      let workload = [];
      if (wResp.status === "fulfilled") {
        const wdata = wResp.value;
        workload = Array.isArray(wdata) ? wdata : (wdata?.items ?? []);
        setWorkloadItems(workload);
      } else {
        console.warn("Workload fetch failed:", wResp.reason);
        setWorkloadError(typeof wResp.reason === "string" ? wResp.reason : "Failed to fetch workload data");
        workload = [];
        setWorkloadItems([]);
      }

      // build map of technician.id -> workload item
      const wmap = new Map();
      workload.forEach((it) => {
        const tech = it?.technician;
        if (tech && (tech.id !== undefined && tech.id !== null)) {
          wmap.set(Number(tech.id), it);
        }
      });

      // merge and normalise fields
      const merged = technicians.map((t) => {
        const id = Number(t.id);
        const w = wmap.get(id);
        return {
          ...t,
          fatigue_score: (w && typeof w.fatigue_score === "number") ? w.fatigue_score : (t.fatigue_score ?? 0),
          assigned_count: (w && typeof w.assigned_count === "number") ? w.assigned_count : (t.assigned_count ?? 0),
          recent_completed_count: (w && typeof w.recent_completed_count === "number") ? w.recent_completed_count : (t.recent_completed_count ?? 0),
          // prefer workload-provided location name, then existing fields; we'll attempt reverse-geocode when missing
          last_location_name: w?.location_name ?? t.last_location_name ?? t.last_address ?? null,
          // explanation normalized in client-side for list
          explanation: (w?.explanation ?? w?.reason ?? (Array.isArray(w?.reasons) ? w.reasons.join("; ") : (t.explanation ?? null))) || null,
          // keep raw coords so we can reverse lookup as needed
          last_lat: w?.location_lat ?? t.last_lat ?? null,
          last_lon: w?.location_lon ?? t.last_lon ?? null,
        };
      });

      setTechs(merged);
    } catch (err) {
      console.error("Failed to load technicians page:", err);
      setError(err?.message || "Failed to load technicians");
      setTechs([]);
      setWorkloadItems([]);
    } finally {
      setLoading(false);
      setLoadingWorkload(false);
    }
  }

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // When techs change, ensure we have human-friendly location names.
  // This calls the backend /api/geo/reverse/?lat=&lon=... which should be implemented server-side (geopy).
  useEffect(() => {
    if (!techs || techs.length === 0) return;

    // build list of unique coords to look up
    const toLookup = [];
    const seen = new Set();
    for (const t of techs) {
      const lat = t.last_lat;
      const lon = t.last_lon;
      const hasName = t.last_location_name && String(t.last_location_name).trim().length > 0;
      if ((lat == null || lon == null) || hasName) continue;
      const key = `${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;
      if (reverseCacheRef.current[key] !== undefined) continue; // already cached (null or name)
      if (!seen.has(key)) {
        seen.add(key);
        toLookup.push({ key, lat: Number(lat), lon: Number(lon) });
      }
    }

    if (toLookup.length === 0) return;

    // helper to fetch a single reverse lookup
    const fetchOne = async ({ key, lat, lon }) => {
      try {
        const url = `/api/geo/reverse/?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
        const headers = { Accept: "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(url, { headers });
        if (!res.ok) {
          // cache null to avoid retry storms
          reverseCacheRef.current[key] = null;
          return { key, name: null };
        }
        const json = await res.json();
        const name = (json && (json.name || json.display_name || (json.raw && json.raw.display_name))) || null;
        reverseCacheRef.current[key] = name;
        return { key, name };
      } catch (e) {
        console.warn("reverse geocode failed for", key, e);
        reverseCacheRef.current[key] = null;
        return { key, name: null };
      }
    };

    // perform all lookups (deduplicated). We do them in parallel but you can throttle if you prefer.
    (async () => {
      try {
        const results = await Promise.allSettled(toLookup.map((x) => fetchOne(x)));
        // update techs with any newly discovered names
        setTechs((prev) =>
          prev.map((t) => {
            const lat = t.last_lat;
            const lon = t.last_lon;
            if (lat == null || lon == null) return t;
            const key = `${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;
            if (reverseCacheRef.current[key]) {
              // only update if it wasn't already set
              if (!t.last_location_name || t.last_location_name === "" || t.last_location_name.startsWith("Unknown") || t.last_location_name.includes(",")) {
                return { ...t, last_location_name: reverseCacheRef.current[key] };
              }
            }
            return t;
          })
        );
      } catch (e) {
        console.warn("reverse lookups failed", e);
      }
    })();
  }, [techs, token]);

  function openItinerary(t) {
    setSelectedTech(t);
    setTimeout(() => {
      const el = document.getElementById("itinerary-panel");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  function closeItinerary() {
    setSelectedTech(null);
  }

  // theme helpers
  const pageBg = theme === "dark" ? "bg-slate-900 text-slate-100" : "bg-slate-50 text-slate-900";
  const titleClass = theme === "dark" ? "text-slate-100" : "text-slate-800";
  const smallMuted = theme === "dark" ? "text-slate-400" : "text-slate-500";
  const cardClass = theme === "dark" ? "bg-slate-800 text-slate-100 border border-slate-700" : "bg-white text-slate-900 border border-gray-200";
  const btnPrimary = theme === "dark" ? "px-3 py-1 rounded border border-indigo-600 text-indigo-200 hover:bg-indigo-600/10 text-sm" : "px-3 py-1 rounded border border-indigo-600 text-indigo-600 hover:bg-indigo-50 text-sm";
  const btnBorder = theme === "dark" ? "px-3 py-1 rounded border border-slate-600 text-slate-100 hover:bg-slate-700/20 text-sm" : "px-3 py-1 rounded border border-slate-200 hover:bg-slate-50 text-sm";
  const listItemHover = theme === "dark" ? "hover:shadow-sm hover:bg-slate-800/50" : "hover:shadow-sm hover:bg-white";

  return (
    <div className={`${pageBg} p-6 min-h-[60vh]`}>
      <style>{`
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
        #itinerary-panel.overflow-auto::-webkit-scrollbar,
        #itinerary-panel::-webkit-scrollbar,
        .overflow-auto::-webkit-scrollbar { width: 10px; height: 10px; }
        #itinerary-panel.overflow-auto::-webkit-scrollbar-track,
        #itinerary-panel::-webkit-scrollbar-track,
        .overflow-auto::-webkit-scrollbar-track { background: var(--scroll-track); border-radius: 8px; }
        #itinerary-panel.overflow-auto::-webkit-scrollbar-thumb,
        #itinerary-panel::-webkit-scrollbar-thumb,
        .overflow-auto::-webkit-scrollbar-thumb { background: linear-gradient(180deg, var(--scroll-thumb), var(--scroll-thumb)); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
        #itinerary-panel.overflow-auto::-webkit-scrollbar-thumb:hover,
        #itinerary-panel::-webkit-scrollbar-thumb:hover,
        .overflow-auto::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, var(--scroll-thumb-hover), var(--scroll-thumb-hover)); }
        #itinerary-panel.overflow-auto, #itinerary-panel, .overflow-auto { scrollbar-width: thin; scrollbar-color: var(--scroll-thumb) var(--scroll-track); }
        [data-theme="dark"] #itinerary-panel { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02); }
      `}</style>

      <div className="flex items-center justify-between mb-6">
        <h2 className={`text-2xl font-semibold ${titleClass}`}>Technicians</h2>
        <div className="flex gap-2">
          <button onClick={load} className={btnBorder} disabled={loading || loadingWorkload}>
            {loading || loadingWorkload ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-rose-600">{error}</div>}
      {workloadError && <div className="mb-2 text-sm text-amber-600">Workload data unavailable: {workloadError}</div>}

      <div className="grid md:grid-cols-3 gap-4">
        {/* LEFT: list */}
        <div className={`md:col-span-2 ${cardClass} shadow-sm rounded-lg p-4 overflow-hidden`}>
          {(loading && !techs.length) ? (
            <div className={`p-6 text-center ${smallMuted}`}>Loading…</div>
          ) : techs.length === 0 ? (
            <div className={`p-6 text-center ${smallMuted}`}>No technicians yet.</div>
          ) : (
            <ul className="space-y-3">
              {techs.map((t) => {
                const fatigue = typeof t.fatigue_score === "number" ? t.fatigue_score : 0;
                // show the friendly name if we have it; otherwise fall back to last_address or coords string
                const location = t.last_location_name
                  || t.last_address
                  || (t.last_lat && t.last_lon ? `${Number(t.last_lat).toFixed(4)}, ${Number(t.last_lon).toFixed(4)}` : "Unknown location");
                const expl = t.explanation || null;
                const short = expl ? (expl.length > 110 ? `${expl.slice(0, 110).trim()}…` : expl) : null;

                return (
                  <li
                    key={t.id}
                    className={`p-4 border rounded-lg transition ${listItemHover}`}
                    style={ theme === "dark" ? { borderColor: "rgba(148,163,184,0.08)" } : undefined }
                  >
                    <div className="flex items-start justify-between min-w-0">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{t.user?.username ?? t.user?.email ?? `Tech ${t.id}`}</div>
                        <div className={`text-sm mt-1 ${smallMuted} truncate`}>{t.status ?? "status unknown"}</div>
                        <div className="text-sm mt-1 text-slate-600 dark:text-slate-300 truncate">Location: <span className="font-medium">{location}</span></div>
                      </div>

                      <div className="flex items-center gap-2 ml-4" style={{ flexShrink: 0 }}>
                        <div className={`text-sm ${smallMuted} mr-3 text-right`} style={{ minWidth: 120 }}>
                          {fatigue >= 0.8 ? <span className="text-xs px-2 py-1 rounded bg-rose-50 text-rose-700">High fatigue</span> : <span className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700">OK</span>}
                        </div>

                        <button className={btnPrimary} onClick={() => openItinerary(t)}>View itinerary</button>
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="text-xs text-slate-500 mb-1">Fatigue: <strong>{Math.round(fatigue * 100)}%</strong></div>
                      <FatigueBar score={fatigue} />
                      <div className="mt-2 text-xs text-slate-500">Assigned: <strong>{t.assigned_count ?? 0}</strong> · Recent completed (7d): <strong>{t.recent_completed_count ?? 0}</strong></div>
                    </div>

                    {/* inline explanation */}
                    {expl && (
                      <div className="mt-3 text-sm">
                        <div className="text-xs text-slate-500 mb-1">Reason</div>
                        <div className="text-slate-700 dark:text-slate-200">
                          {expandedExplanationId === t.id ? expl : short}
                          {expl.length > 110 && (
                            <button onClick={() => setExpandedExplanationId(expandedExplanationId === t.id ? null : t.id)} className="ml-2 text-indigo-600 dark:text-indigo-300 text-xs">
                              {expandedExplanationId === t.id ? "Show less" : "Read more"}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {t.skills && t.skills.length > 0 ? t.skills.map((s) => <Badge key={s.id}>{s.name}</Badge>) : <div className={`text-sm ${smallMuted}`}>No skills listed</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* RIGHT: context panel -> compact workload summary + itinerary (NO full cards) */}
        <aside id="itinerary-panel" className={`${cardClass} shadow-sm rounded-lg p-4 md:col-span-1 overflow-auto`} style={{ maxHeight: "calc(100vh - 180px)" }}>
          {selectedTech ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <h3 className={`text-lg font-semibold ${titleClass}`}>{selectedTech.user?.username ?? `Tech ${selectedTech.id}`}</h3>
                <button onClick={closeItinerary} className={btnBorder}>Close</button>
              </div>

              {/* COMPACT workload summary (not full cards) - use merged t fields */}
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 mb-4 border">
                <div className="text-sm text-slate-600 dark:text-slate-300">Status: {selectedTech.status ?? "—"}</div>
                <div className="text-sm mt-2">Location: <strong>{selectedTech.last_location_name ?? selectedTech.last_address ?? (selectedTech.last_lat && selectedTech.last_lon ? `${Number(selectedTech.last_lat).toFixed(4)}, ${Number(selectedTech.last_lon).toFixed(4)}` : "Unknown")}</strong></div>

                <div className="mt-3">
                  <div className="text-xs text-slate-500 mb-1">Fatigue: <strong>{Math.round((selectedTech.fatigue_score || 0) * 100)}%</strong></div>
                  <FatigueBar score={selectedTech.fatigue_score || 0} />
                  <div className="mt-2 text-xs text-slate-500">Assigned: <strong>{selectedTech.assigned_count ?? 0}</strong> · Recent completed (7d): <strong>{selectedTech.recent_completed_count ?? 0}</strong></div>
                </div>

                {/* show normalized explanation (from merged tech.explanation) */}
                {selectedTech.explanation && (
                  <div className="mt-3 text-sm">
                    <div className="text-xs text-slate-500 mb-1">Why</div>
                    <div className="text-slate-700 dark:text-slate-200">
                      {selectedTech.explanation.length > 220
                        ? (selectedTech.explanation.slice(0, 220) + "…")
                        : selectedTech.explanation}
                    </div>
                  </div>
                )}
              </div>

              {/* itinerary (keeps showing) */}
              <div>
                <TechnicianItinerary techId={selectedTech.id} compact={true} />
              </div>
            </>
          ) : (
            <div className={`p-6 text-sm ${smallMuted}`}>Select a technician and click <strong className={titleClass}>View itinerary</strong> to see workload and routes.</div>
          )}
        </aside>
      </div>
    </div>
  );
}
