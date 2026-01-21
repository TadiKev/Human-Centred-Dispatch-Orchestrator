// frontend/src/components/TechnicianWorkloadPanel.jsx
import React, { useEffect, useState, useRef } from "react";
import { useAuth } from "../auth/AuthProvider";

/**
 * TechnicianWorkloadPanel
 *
 * Props:
 *  - apiBase (string) default "/api"
 *  - jobId (number|null) optional -> used for assign calls
 *  - techId (number|null) optional -> show only that tech's card(s)
 *  - initialItems (array|null) optional -> if provided, will be used instead of fetching
 *  - onLoad (fn(items)) optional -> called with normalized items after load
 *  - onLoaded (fn(items)) optional -> alternative callback (some callers use this name)
 *
 * This version will attempt to resolve a friendly location name for any item that
 * has lat/lon but no location_name, by calling the backend reverse endpoint:
 *   GET {backendBase}/geo/reverse/?lat=<lat>&lon=<lon>
 *
 * The component caches reverse lookups in-memory and in localStorage to avoid
 * repeating requests across page reloads.
 */

// small UI subcomponent
function FatigueBar({ score = 0 }) {
  const pct = Math.round((score || 0) * 100);
  let colorClass = "bg-emerald-500";
  if (score >= 0.8) colorClass = "bg-rose-500";
  else if (score >= 0.6) colorClass = "bg-amber-500";
  return (
    <div className="w-full bg-slate-100 dark:bg-slate-700 rounded h-2 overflow-hidden">
      <div style={{ width: `${pct}%` }} className={`${colorClass} h-2`} />
    </div>
  );
}

// helper: normalize explanation field
function _normalizeExplanation(raw) {
  if (!raw) return { full: null, short: null, factors: null };

  if (Array.isArray(raw)) {
    const full = raw.join("; ");
    const short = full.length > 120 ? `${full.slice(0, 120).trim()}…` : full;
    return { full, short, factors: raw };
  }

  if (typeof raw === "object") {
    if (raw.full || raw.short || raw.factors) {
      const full = raw.full || raw.short || null;
      const short = raw.short || (full ? (full.length > 120 ? `${full.slice(0, 120).trim()}…` : full) : null);
      const factors = Array.isArray(raw.factors) ? raw.factors : (raw.factors ? [String(raw.factors)] : null);
      return { full, short, factors };
    }
    const s = JSON.stringify(raw);
    const full = s;
    const short = s.length > 120 ? `${s.slice(0, 120).trim()}…` : s;
    return { full, short, factors: null };
  }

  const full = String(raw);
  const short = full.length > 120 ? `${full.slice(0, 120).trim()}…` : full;
  return { full, short, factors: null };
}

// Return true if value looks like a valid integer id
function _isValidIntId(v) {
  if (v === null || v === undefined) return false;
  const n = Number(v);
  return Number.isInteger(n) && Math.abs(n) < 9_000_000_000;
}

export default function TechnicianWorkloadPanel({
  apiBase = "/api",
  jobId = null,
  techId = null,
  initialItems = null,
  onLoad = null,      // older code used onLoad
  onLoaded = null,    // some callers (AssignModal) use onLoaded
}) {
  const { auth } = useAuth();
  const token = auth?.access ?? localStorage.getItem("access") ?? null;

  // detect dev front + set backend base (same logic as your other components)
  const isDevFront =
    typeof window !== "undefined" &&
    window.location.hostname === "localhost" &&
    window.location.port === "5173";
  const backendBase = apiBase.startsWith("http")
    ? apiBase.replace(/\/$/, "")
    : isDevFront
    ? `http://localhost:8000${apiBase}`
    : apiBase;

  const [items, setItems] = useState(Array.isArray(initialItems) ? initialItems : []);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [toast, setToast] = useState(null);
  const [assigningId, setAssigningId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  // local in-memory cache for reverse geocode: key "lat:lon" -> name
  const geoCacheRef = useRef(new Map());

  // hydrate cache from localStorage (once)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("geo_reverse_cache_v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          const map = new Map(Object.entries(parsed));
          geoCacheRef.current = map;
        }
      }
    } catch (e) {
      // ignore parse errors
    }
  }, []);

  // persist cache periodically (save on unmount)
  useEffect(() => {
    return () => {
      try {
        const obj = Object.fromEntries(geoCacheRef.current || []);
        localStorage.setItem("geo_reverse_cache_v1", JSON.stringify(obj));
      } catch (e) {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Normalize an incoming workload item to canonical shape
  function _normalizeItem(it) {
    let tech = null;

    if (it == null) {
      tech = {};
    } else if (it.technician && typeof it.technician === "object") {
      tech = it.technician;
    } else if (it.technician_id || it.technician_username || it.technician_user) {
      tech = {
        id: it.technician_id ?? null,
        username: it.technician_username ?? (it.technician_user?.username ?? null),
      };
    } else if (it.id && (it.username || it.user || it.user?.username)) {
      tech = {
        id: it.id,
        username: it.username ?? (it.user?.username ?? null),
      };
    } else {
      tech = {
        id: it?.technician?.id ?? it?.technician_id ?? it?.id ?? null,
        username:
          it?.technician?.username ??
          it?.technician_username ??
          it?.technician?.user?.username ??
          it?.user?.username ??
          null,
      };
    }

    const rawId = tech?.id;
    const hasValidId = _isValidIntId(rawId);

    const canonicalTech = {
      ...tech,
      id: hasValidId ? Number(rawId) : null,
      username: tech?.username ?? null,
    };

    const fatigue_score =
      typeof it?.fatigue_score === "number"
        ? it.fatigue_score
        : typeof it?.score === "number"
        ? it.score
        : typeof it?.fatigue === "number"
        ? it.fatigue
        : 0;

    const assigned_count = typeof it?.assigned_count === "number" ? it.assigned_count : typeof it?.assigned === "number" ? it.assigned : 0;
    const recent_completed_count =
      typeof it?.recent_completed_count === "number" ? it.recent_completed_count : typeof it?.recent_completed === "number" ? it.recent_completed : 0;

    // location sources: explicit location_name -> last_location_name -> last_address -> lat/lon composite fallback
    const location_name = it?.location_name ?? it?.last_location_name ?? it?.last_address ?? null;

    const possibleExplanation = it?.explanation ?? it?.reason ?? it?.why ?? it?.reasons ?? it?.explanations ?? null;
    const normalizedExplanation = _normalizeExplanation(possibleExplanation);

    return {
      ...it,
      technician: canonicalTech,
      fatigue_score,
      assigned_count,
      recent_completed_count,
      location_name,
      last_lat: it?.last_lat ?? it?.lat ?? it?.latitude ?? null,
      last_lon: it?.last_lon ?? it?.lon ?? it?.longitude ?? null,
      explanation_full: normalizedExplanation.full,
      explanation_short: normalizedExplanation.short,
      explanation_factors: normalizedExplanation.factors,
    };
  }

  // reverse-geocode a single lat/lon (uses cache)
  async function _reverseLookup(lat, lon) {
    if (lat == null || lon == null) return null;
    // normalize to 6 decimals as key
    const key = `${Number(lat).toFixed(6)}:${Number(lon).toFixed(6)}`;
    const cache = geoCacheRef.current;
    if (cache.has(key)) {
      return cache.get(key); // string or null
    }

    // fetch from backend geo endpoint
    try {
      const url = `${backendBase.replace(/\/$/, "")}/geo/reverse/?lat=${encodeURIComponent(Number(lat))}&lon=${encodeURIComponent(Number(lon))}`;
      const headers = {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      const res = await fetch(url, { headers, credentials: "include" });

      // if endpoint not found, bail (store null to avoid re-request)
      if (res.status === 404) {
        cache.set(key, null);
        return null;
      }
      if (!res.ok) {
        // don't throw — store null so we don't spam
        cache.set(key, null);
        return null;
      }
      const json = await res.json();
      // choose prefered name fields: display_name -> name -> combined address bits
      const name = json?.display_name ?? json?.name ?? null;
      const resolved = name || (json?.raw ? (json.raw.display_name || null) : null) || null;
      cache.set(key, resolved);
      return resolved;
    } catch (e) {
      // network / provider error - cache null to avoid retry storms
      try {
        geoCacheRef.current.set(key, null);
      } catch (er) {}
      return null;
    }
  }

  // For a list of normalized items, resolve any missing location_name using reverse geocode
  async function _ensureLocations(normalizedItems) {
    // collect unique coords to lookup
    const toLookup = new Map(); // key -> {lat, lon}
    normalizedItems.forEach((it) => {
      if (!it) return;
      if (it.location_name) return; // already present
      const lat = it.last_lat;
      const lon = it.last_lon;
      if (lat == null || lon == null) return;
      const key = `${Number(lat).toFixed(6)}:${Number(lon).toFixed(6)}`;
      if (!toLookup.has(key)) toLookup.set(key, { lat: Number(lat), lon: Number(lon) });
    });

    if (toLookup.size === 0) return normalizedItems;

    // run lookups in parallel but gently (Promise.allSettled)
    const promises = [];
    for (const [key, coord] of toLookup.entries()) {
      promises.push(
        (async () => {
          const name = await _reverseLookup(coord.lat, coord.lon);
          return { key, name, coord };
        })()
      );
    }

    const settled = await Promise.allSettled(promises);
    const nameMap = new Map();
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value) {
        nameMap.set(s.value.key, s.value.name);
      }
    }

    // apply to items
    const updated = normalizedItems.map((it) => {
      if (!it) return it;
      if (it.location_name) return it;
      const lat = it.last_lat;
      const lon = it.last_lon;
      if (lat == null || lon == null) return it;
      const key = `${Number(lat).toFixed(6)}:${Number(lon).toFixed(6)}`;
      const resolved = nameMap.has(key) ? nameMap.get(key) : null;
      return { ...it, location_name: resolved || null };
    });

    // persist cache to localStorage for next page load (best-effort)
    try {
      const obj = Object.fromEntries(geoCacheRef.current || []);
      localStorage.setItem("geo_reverse_cache_v1", JSON.stringify(obj));
    } catch (e) {
      // ignore
    }

    return updated;
  }

  async function fetchData() {
    setLoading(true);
    setErr(null);

    try {
      if (initialItems && Array.isArray(initialItems) && initialItems.length > 0) {
        const normalized = initialItems.map(_normalizeItem);
        const withNames = await _ensureLocations(normalized);
        setItems(withNames);
        onLoad && onLoad(withNames);
        onLoaded && onLoaded(withNames);
        setLoading(false);
        return;
      }

      const url = `${backendBase.replace(/\/$/, "")}/technician-workload/`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
      });

      if (res.status === 404) {
        throw new Error(`Workload endpoint not found (404). Tried URL: ${url}`);
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const json = await res.json();
      const rawItems = json.items || (Array.isArray(json) ? json : []);
      const normalized = rawItems.map(_normalizeItem);
      const withNames = await _ensureLocations(normalized);
      setItems(withNames);
      onLoad && onLoad(withNames);
      onLoaded && onLoaded(withNames);
    } catch (e) {
      console.error("fetch workload error", e);
      setErr(e.message || "Failed to fetch workload");
      setItems([]);
      onLoad && onLoad([]);
      onLoaded && onLoaded([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!initialItems) fetchData();
    else {
      (async () => {
        const normalized = initialItems.map(_normalizeItem);
        const withNames = await _ensureLocations(normalized);
        setItems(withNames);
        onLoad && onLoad(withNames);
        onLoaded && onLoaded(withNames);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once

  async function assignToTech(technicianId) {
    if (!jobId) {
      setToast({ type: "error", text: "jobId not provided to panel — cannot assign." });
      return;
    }
    if (!technicianId || !_isValidIntId(technicianId)) {
      setToast({ type: "error", text: "Technician id invalid — cannot assign." });
      return;
    }
    if (!confirm(`Assign job #${jobId} to technician ${technicianId}?`)) return;

    setAssigningId(technicianId);
    try {
      const url = `${backendBase.replace(/\/$/, "")}/auto_assign/?job_id=${encodeURIComponent(jobId)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ target_technician_id: technicianId }),
      });
      const text = await res.text().catch(() => "");
      let json;
      try {
        json = text ? JSON.parse(text) : null;
      } catch (e) {
        json = null;
      }

      if (!res.ok) {
        const message = (json && (json.detail || json.error || json.message)) || text || `HTTP ${res.status}`;
        throw new Error(message);
      }

      const message = (json && (json.message || json.detail)) || "Assigned successfully";
      setToast({ type: "success", text: String(message) });
      // refresh items so fatigue values reflect change
      await fetchData();
    } catch (e) {
      console.error("assign error", e);
      setToast({ type: "error", text: e.message || "Failed to assign" });
    } finally {
      setAssigningId(null);
    }
  }

  // Filter by techId when requested
  const rendered = techId ? items.filter((it) => _isValidIntId(it.technician?.id) && Number(it.technician.id) === Number(techId)) : items;

  return (
    <div className="p-4 bg-white dark:bg-[#071017] rounded-xl border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Technician workload</h3>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} className="px-3 py-1 rounded text-sm bg-indigo-600 text-white">Refresh</button>
        </div>
      </div>

      {loading && <div className="text-sm text-slate-500">Loading...</div>}
      {err && <div className="text-sm text-rose-600 mb-2">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rendered.map((it, idx) => {
          const tech = it.technician || {};
          const keyId = _isValidIntId(tech.id) ? Number(tech.id) : `anon-${idx}`;
          const displayName = tech.username ? String(tech.username) : _isValidIntId(tech.id) ? `Tech #${Number(tech.id)}` : "Tech (unknown)";
          const canAssign = _isValidIntId(tech.id);
          const full = it.explanation_full;
          const short = it.explanation_short;
          const location = it.location_name ?? (it.last_lat && it.last_lon ? `${Number(it.last_lat).toFixed(6)}, ${Number(it.last_lon).toFixed(6)}` : "Unknown location");

          return (
            <div key={keyId} className="p-3 border rounded-lg bg-slate-50 dark:bg-slate-800">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm text-slate-600 dark:text-slate-300">{displayName}</div>
                  <div className="text-xs text-slate-400 mt-1">Status: {tech.status || "—"}</div>
                  <div className="text-xs text-slate-400 mt-1">Location: <strong className="text-slate-700 dark:text-slate-200">{location}</strong></div>
                </div>
                <div className="text-right">
                  {it.fatigue_score >= 0.8 ? (
                    <span className="text-xs px-2 py-1 rounded bg-rose-50 text-rose-700">High fatigue</span>
                  ) : (
                    <span className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700">OK</span>
                  )}
                </div>
              </div>

              <div className="mt-3">
                <div className="text-xs text-slate-500 mb-1">Fatigue: <strong>{Math.round((it.fatigue_score || 0) * 100)}%</strong></div>
                <FatigueBar score={it.fatigue_score || 0} />
                <div className="mt-2 text-xs text-slate-500">Assigned: <strong>{it.assigned_count ?? 0}</strong> · Recent completed (7d): <strong>{it.recent_completed_count ?? 0}</strong></div>
              </div>

              {full && (
                <div className="mt-3 text-xs">
                  <div className="text-slate-500 mb-1">Why recommended</div>
                  <div className="text-sm text-slate-800 dark:text-slate-200">
                    {expandedId === keyId ? full : short}
                    {full.length > 120 && (
                      <button onClick={() => setExpandedId(expandedId === keyId ? null : keyId)} className="ml-2 text-indigo-600 dark:text-indigo-300 text-xs">
                        {expandedId === keyId ? "Show less" : "Read more"}
                      </button>
                    )}
                  </div>
                  {Array.isArray(it.explanation_factors) && it.explanation_factors.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {it.explanation_factors.map((f, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">{f}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => {
                    const copy = _isValidIntId(tech.id) ? String(tech.id) : (tech.username ? String(tech.username) : "");
                    navigator.clipboard?.writeText(copy);
                    setToast({ type: "info", text: "Technician id/username copied to clipboard" });
                  }}
                  className="px-3 py-1 rounded text-sm border"
                >
                  Copy id
                </button>

                <button
                  onClick={() => assignToTech(tech.id)}
                  disabled={assigningId !== null || !canAssign}
                  className="px-3 py-1 rounded text-sm bg-indigo-600 text-white disabled:opacity-60"
                >
                  {assigningId === tech.id ? "Assigning…" : "Assign"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-60">
          <div className={`${toast.type === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"} p-3 rounded shadow-md`}>
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
}
