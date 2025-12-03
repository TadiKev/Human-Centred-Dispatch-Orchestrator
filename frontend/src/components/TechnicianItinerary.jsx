// frontend/src/components/TechnicianItinerary.jsx
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/fetcher";
import { useAuth } from "../auth/AuthProvider";
import { useTheme } from "../theme/ThemeProvider";

import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* TechnicianItinerary
   Props:
     - techId (number|string) : technician id to fetch itinerary for
     - compact (bool) optional: hide big header when embedded in a panel
*/

const DEFAULT_SPEED = 40;

// ensure Leaflet default icons show under Vite
const DefaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

function FitBounds({ positions }) {
  const map = useMap();
  useEffect(() => {
    if (!positions || positions.length === 0) return;
    try {
      const bounds = L.latLngBounds(positions);
      map.fitBounds(bounds, { padding: [28, 28] });
    } catch (e) {
      // ignore
    }
  }, [map, positions]);
  return null;
}

// numbered DivIcon generator (inline styling for portability)
function createNumberedIcon(n, violation = false) {
  const bg = violation ? "#f87171" : "#2563eb"; // red or blue
  const html = `
    <div style="
      display:flex;align-items:center;justify-content:center;
      width:30px;height:30px;border-radius:50%;
      background:${bg};color:white;font-weight:700;
      box-shadow:0 1px 3px rgba(0,0,0,0.25);
      border:2px solid white;
    ">${n}</div>
  `;
  return L.divIcon({
    html,
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30],
  });
}

export default function TechnicianItinerary({ techId, compact = false }) {
  const { auth, setAuth } = useAuth();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const token = auth?.access ?? null;

  // theme shortcuts
  const pageBgClass = theme === "dark" ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900";
  const panelClass = theme === "dark" ? "bg-slate-800 text-slate-100 border border-slate-700" : "bg-white text-slate-900 border border-gray-200";
  const smallPanelClass = theme === "dark" ? "bg-slate-700 text-slate-100 border border-slate-700" : "bg-slate-50 text-slate-900 border border-gray-200";
  const mutedClass = theme === "dark" ? "text-slate-300" : "text-slate-500";
  const mutedSmall = theme === "dark" ? "text-slate-400" : "text-slate-500";
  const hoverItem = theme === "dark" ? "hover:bg-slate-700/40" : "hover:bg-slate-50";
  const btnPrimary = theme === "dark" ? "bg-indigo-600 hover:bg-indigo-700 text-white" : "bg-indigo-600 hover:bg-indigo-700 text-white";
  const btnBorder = theme === "dark" ? "border border-slate-600 text-slate-100" : "border border-gray-200 text-slate-900";
  const statBg = theme === "dark" ? "bg-slate-700" : "bg-slate-50";

  // Hooks (always same order)
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [algorithm, setAlgorithm] = useState("nearest"); // "nearest" | "ortools"
  const [useCache, setUseCache] = useState(true);
  const [forceToggle, setForceToggle] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

  // derived arrays
  const startPos = useMemo(() => {
    if (!data?.comparison) return null;
    const lat = data.comparison.start_lat;
    const lon = data.comparison.start_lon;
    return lat == null || lon == null ? null : [Number(lat), Number(lon)];
  }, [data]);

  const optimizedPositions = useMemo(() => {
    return (data?.optimized?.stops || [])
      .map((s) => (s.lat != null && s.lon != null ? [Number(s.lat), Number(s.lon)] : null))
      .filter(Boolean);
  }, [data]);

  const currentPositions = useMemo(() => {
    return (data?.current?.stops || [])
      .map((s) => (s.lat != null && s.lon != null ? [Number(s.lat), Number(s.lon)] : null))
      .filter(Boolean);
  }, [data]);

  const allPositions = useMemo(() => {
    const arr = [];
    if (startPos) arr.push(startPos);
    if (optimizedPositions.length) optimizedPositions.forEach((p) => arr.push(p));
    else currentPositions.forEach((p) => arr.push(p));
    return arr;
  }, [startPos, optimizedPositions, currentPositions]);

  // build URL for API call
  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    params.set("speed_kmph", String(speed || DEFAULT_SPEED));
    params.set("algorithm", algorithm);
    if (algorithm === "ortools") params.set("use_ortools", "true");
    params.set("use_cache", useCache ? "true" : "false");
    if (forceToggle) params.set("force", "true");
    return `/api/technicians/${encodeURIComponent(techId)}/itinerary/?${params.toString()}`;
  }, [techId, speed, algorithm, useCache, forceToggle]);

  // fetch
  const fetchItinerary = useCallback(
    async (opts = { showLoading: true }) => {
      if (!techId || !token) return;
      setErrorMsg(null);
      if (opts.showLoading) setLoading(true);
      try {
        const url = buildUrl();
        const res = await apiFetch(url, { token });
        setData(res);
        setLastFetchedAt(new Date().toISOString());
      } catch (err) {
        console.error("Itinerary fetch error", err);
        if (err && (err.status === 401 || err.status === 403)) {
          try {
            setAuth(null);
          } catch (e) {}
          navigate("/auth", { replace: true });
          return;
        }
        setErrorMsg(err?.message || "Failed to fetch itinerary");
        setData(null);
      } finally {
        if (opts.showLoading) setLoading(false);
      }
    },
    [token, techId, buildUrl, setAuth, navigate]
  );

  // initial and dependency fetch
  useEffect(() => {
    // set data-theme so ManagerLayout's CSS variables apply to this page even if it's directly visited
    try {
      document.documentElement.setAttribute("data-theme", theme);
    } catch (e) {
      // ignore
    }

    if (!techId || !token) {
      setData(null);
      return;
    }
    fetchItinerary({ showLoading: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techId, token, speed, algorithm, useCache, forceToggle, theme]);

  // -------------------------------------------------------------------
  // NEW: listen for global job updates so itinerary refreshes automatically
  // -------------------------------------------------------------------
  useEffect(() => {
    const handler = () => {
      // don't show loading spinner for background refresh; just refresh data
      try {
        fetchItinerary({ showLoading: false });
        // optional: console log for debugging
        // console.debug("TechnicianItinerary: caught jobs:changed -> refetching");
      } catch (e) {
        // ignore
      }
    };
    window.addEventListener("jobs:changed", handler);
    window.addEventListener("itinerary:refresh", handler); // alternate event name
    return () => {
      window.removeEventListener("jobs:changed", handler);
      window.removeEventListener("itinerary:refresh", handler);
    };
  }, [fetchItinerary]);

  // helper: compare sequences to decide if OR-Tools changed order
  const currentIds = useMemo(() => (data?.current?.stops || []).map((s) => s.job_id), [data]);
  const optimizedIds = useMemo(() => (data?.optimized?.stops || []).map((s) => s.job_id), [data]);
  const optimizedDifferent = useMemo(() => {
    if (currentIds.length !== optimizedIds.length) return true;
    for (let i = 0; i < currentIds.length; i++) {
      if (currentIds[i] !== optimizedIds[i]) return true;
    }
    return false;
  }, [currentIds, optimizedIds]);

  const hasViolations = useMemo(() => {
    const vcur = (data?.violations?.current || []).length;
    const vopt = (data?.violations?.optimized || []).length;
    return vcur + vopt > 0;
  }, [data]);

  // interactions
  const applyAlgorithm = useCallback(
    async (alg) => {
      setAlgorithm(alg);
      // when switching algorithm, force recompute and bypass cache to see result immediately
      setUseCache(false);
      setForceToggle((prev) => !prev);
      await fetchItinerary({ showLoading: true });
    },
    [fetchItinerary]
  );

  const onRecompute = useCallback(async () => {
    setUseCache(false);
    setForceToggle((prev) => !prev);
    await fetchItinerary({ showLoading: true });
  }, [fetchItinerary]);

  // header (hide if compact)
  const header = !compact && (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{`Itinerary — ${data?.technician_username ?? `#${data?.technician_id ?? techId}`}`}</h2>
          <div className={`text-xs ${mutedClass} mt-1`}>
            {data ? (
              <>
                As of <strong>{data.now ?? lastFetchedAt}</strong> · Stops: <strong>{data.comparison?.num_stops ?? 0}</strong>
              </>
            ) : (
              <>No data yet</>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className={`text-sm ${mutedClass} mr-1`}>Algorithm</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => applyAlgorithm("nearest")}
              className={`px-2 py-1 rounded text-sm ${algorithm === "nearest" ? "bg-indigo-600 text-white" : btnBorder}`}
              title="Nearest heuristic"
            >
              Nearest
            </button>
            <button
              onClick={() => applyAlgorithm("ortools")}
              className={`px-2 py-1 rounded text-sm ${algorithm === "ortools" ? "bg-indigo-600 text-white" : btnBorder}`}
              title="Google OR-Tools solver"
            >
              OR-Tools
            </button>
          </div>

          <label className={`flex items-center text-sm ml-3 ${mutedClass}`}>
            <input type="checkbox" checked={useCache} onChange={(e) => setUseCache(e.target.checked)} className="mr-2" />
            use cache
          </label>

          <button
            onClick={onRecompute}
            className={`ml-3 inline-flex items-center gap-2 px-3 py-1.5 rounded text-sm ${btnPrimary}`}
            title="Recompute itinerary now"
          >
            Recompute
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <div className={`${statBg} p-2 rounded`}>
          <div className="text-xs" style={{ color: theme === "dark" ? "var(--muted-2)" : undefined }}>Current</div>
          <div className="text-base font-medium">{data?.comparison?.current_total_travel_km ?? "-"} km</div>
          <div className="text-xs" style={{ color: theme === "dark" ? "var(--muted-2)" : undefined }}>{data?.comparison?.current_total_travel_minutes ?? "-"} min</div>
        </div>
        <div className={`${statBg} p-2 rounded`}>
          <div className="text-xs" style={{ color: theme === "dark" ? "var(--muted-2)" : undefined }}>Optimized</div>
          <div className="text-base font-medium">{data?.comparison?.optimized_total_travel_km ?? "-"} km</div>
          <div className="text-xs" style={{ color: theme === "dark" ? "var(--muted-2)" : undefined }}>{data?.comparison?.optimized_total_travel_minutes ?? "-"} min</div>
        </div>
        <div className={`${statBg} p-2 rounded`}>
          <div className="text-xs" style={{ color: theme === "dark" ? "var(--muted-2)" : undefined }}>Delta</div>
          <div className="text-base font-medium">{data?.comparison?.delta_travel_km ?? "-"} km</div>
          <div className="text-xs" style={{ color: theme === "dark" ? "var(--muted-2)" : undefined }}>{data?.comparison?.delta_travel_minutes ?? "-"} min</div>
        </div>
      </div>
    </>
  );

  // render
  return (
    <div className={`w-full ${compact ? "" : panelClass} rounded-md p-4`}>
      {header}

      <div className="mt-3 flex items-center justify-between">
        <div className={`text-sm ${mutedClass}`}>
          {loading ? <span>Computing itinerary…</span> : <span>Last fetched: {lastFetchedAt ?? "—"}</span>}
          {hasViolations && <span className="ml-3 text-yellow-400 font-medium">⚠️ Window violations detected</span>}
        </div>

        <div className="flex items-center gap-3">
          <label className={`text-xs ${mutedSmall}`}>Speed (km/h)</label>
          <input
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value) || DEFAULT_SPEED)}
            type="number"
            className={`border rounded px-2 py-1 w-20 ${theme === "dark" ? "bg-slate-700 text-slate-100 border-slate-600" : "bg-white text-slate-900"}`}
            aria-label="Speed in kilometers per hour"
          />
        </div>
      </div>

      {errorMsg && <div className="mt-3 p-2 rounded text-sm" style={{ background: theme === "dark" ? "#3b0f0f" : "#fff1f2", color: theme === "dark" ? "#fee2e2" : "#9f1239" }}>{errorMsg}</div>}

      {/* Map */}
      <div className="mt-4 rounded overflow-hidden border" style={{ minHeight: 240, borderColor: theme === "dark" ? "rgba(148,163,184,0.06)" : undefined }}>
        {allPositions.length > 0 ? (
          // NOTE: key forces remount when lastFetchedAt changes so Leaflet re-initialises with fresh center/bounds
          <MapContainer key={`map-${lastFetchedAt ?? "initial"}`} center={allPositions[0]} zoom={11} style={{ height: 360, width: "100%" }} scrollWheelZoom={false}>
            <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

            {startPos && (
              <Marker position={startPos}>
                <Popup>
                  <strong>Start</strong>
                </Popup>
              </Marker>
            )}

            {/* optimized polyline (thick) */}
            {optimizedPositions.length >= 2 && <Polyline positions={optimizedPositions} weight={5} color="#2563eb" />}

            {/* current polyline (dashed) */}
            {currentPositions.length >= 2 && <Polyline positions={currentPositions} weight={3} dashArray="6,8" color={theme === "dark" ? "#94a3b8" : "#6b7280"} />}

            {/* markers: optimized stops, numbered */}
            {data?.optimized?.stops?.map((s, idx) => {
              if (s.lat == null || s.lon == null) return null;
              const violation = (data?.violations?.optimized || []).some((v) => v.job_id === s.job_id);
              return (
                <Marker key={`opt-${s.job_id}`} position={[Number(s.lat), Number(s.lon)]} icon={createNumberedIcon(idx + 1, violation)}>
                  <Popup>
                    <div className="text-sm">
                      <strong>{`#${idx + 1} — Job ${s.job_id}`}</strong>
                      <br />
                      {s.customer_name}
                      <br />
                      Arrival: {s.arrival_iso}
                      <br />
                      {violation && <span className="text-xs" style={{ color: theme === "dark" ? "#fecaca" : "#b91c1c" }}>Violation</span>}
                    </div>
                  </Popup>
                </Marker>
              );
            })}

            <FitBounds positions={allPositions} />
          </MapContainer>
        ) : (
          <div className={`p-6 text-center ${mutedClass}`}>No coordinates available to render the map.</div>
        )}
      </div>

      {/* lists */}
      <div className="mt-4 grid md:grid-cols-2 gap-6">
        <div>
          <h4 className="text-sm font-semibold mb-2">Current order</h4>
          <ol className="list-decimal ml-6">
            {data?.current?.stops?.length ? (
              data.current.stops.map((s) => (
                <li key={`cur-${s.job_id}`} className={`mb-2 p-2 rounded ${hoverItem}`}>
                  <div className="text-sm font-medium">{`Job ${s.job_id} — ${s.customer_name}`}</div>
                  <div className={`text-xs ${mutedSmall}`}>Arr: {s.arrival_iso} · Dep: {s.departure_iso} · {s.distance_from_prev_km ?? "—"} km</div>
                  {data?.violations?.current?.some((v) => v.job_id === s.job_id) && (
                    <div className="text-xs text-red-400 mt-1">⚠️ Arrival after window end</div>
                  )}
                </li>
              ))
            ) : (
              <div className={`text-sm ${mutedSmall}`}>No stops</div>
            )}
          </ol>
        </div>

        <div>
          <h4 className="text-sm font-semibold mb-2">{`Optimized order ${algorithm === "ortools" ? "(OR-Tools)" : "(Nearest)"}`}</h4>
          {!optimizedDifferent && <div className={`mb-2 text-xs ${mutedSmall}`}>Optimized order is same as current (no improvement or OR-Tools not available).</div>}
          <ol className="list-decimal ml-6">
            {data?.optimized?.stops?.length ? (
              data.optimized.stops.map((s, idx) => (
                <li key={`optlist-${s.job_id}`} className={`mb-2 p-2 rounded ${hoverItem}`}>
                  <div className="text-sm font-medium">{`Job ${s.job_id} — ${s.customer_name}`}</div>
                  <div className={`text-xs ${mutedSmall}`}>Arr: {s.arrival_iso} · Dep: {s.departure_iso} · {s.distance_from_prev_km ?? "—"} km</div>
                  {data?.violations?.optimized?.some((v) => v.job_id === s.job_id) && (
                    <div className="text-xs text-red-400 mt-1">⚠️ Arrival after window end</div>
                  )}
                </li>
              ))
            ) : (
              <div className={`text-sm ${mutedSmall}`}>No stops</div>
            )}
          </ol>
        </div>
      </div>
    </div>
  );
}
