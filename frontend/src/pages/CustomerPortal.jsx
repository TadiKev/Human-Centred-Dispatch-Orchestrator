// frontend/src/pages/CustomerPortal.jsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "../auth/AuthProvider";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* Fix leaflet default icon paths (works with Vite/CRA) */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png",
});

/* ---------------------------
   UI primitives (Tailwind)
   - Safe dark mode: avoid pure black; use slate-700/800 surfaces
   --------------------------- */
function Button({ children, variant = "primary", small = false, ...rest }) {
  const base = "inline-flex items-center justify-center rounded-lg font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
  const size = small ? "px-3 py-1 text-sm" : "px-4 py-2 text-sm";
  const variants = {
    primary:
      "bg-emerald-600 hover:bg-emerald-500 text-white focus-visible:ring-emerald-300 dark:bg-emerald-500 dark:hover:bg-emerald-400",
    ghost:
      "bg-transparent border border-gray-200 dark:border-slate-700 text-gray-800 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-700 focus-visible:ring-gray-300",
    danger:
      "bg-rose-500 hover:bg-rose-600 text-white focus-visible:ring-rose-400",
  };
  return (
    <button className={`${base} ${size} ${variants[variant] || variants.primary}`} {...rest}>
      {children}
    </button>
  );
}

function Card({ children, className = "" }) {
  // Use slightly elevated surface in dark mode (slate-800) not pitch black
  return <div className={`bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4 shadow-sm ${className}`}>{children}</div>;
}

function Badge({ children, tone = "muted" }) {
  const styles = {
    muted: "bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-100",
    success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-800 dark:text-emerald-200",
    info: "bg-sky-50 text-sky-700 dark:bg-sky-900 dark:text-sky-200",
    warn: "bg-amber-50 text-amber-700 dark:bg-amber-900 dark:text-amber-200",
  };
  return <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${styles[tone] || styles.muted}`}>{children}</span>;
}

/* Modal with scroll-lock and Escape handling */
function Modal({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") onClose && onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div role="document" onClick={(e) => e.stopPropagation()} className="relative w-full max-w-3xl mx-auto bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-700 flex items-start justify-between">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-sm text-slate-600 dark:text-slate-300 hover:underline">Close</button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  const cls = toast.type === "error" ? "bg-rose-50 text-rose-700 dark:bg-rose-900 dark:text-rose-200" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200";
  return (
    <div className="fixed bottom-6 right-6 z-60">
      <div className={`${cls} p-3 rounded shadow-md`}>{toast.text}</div>
    </div>
  );
}

/* Click-to-set marker on Leaflet map */
function ClickableMap({ onClick }) {
  useMapEvents({
    click(e) { onClick && onClick([e.latlng.lat, e.latlng.lng]); },
  });
  return null;
}

/* ---------------------------
   CustomerPortal main
   --------------------------- */
export default function CustomerPortal({ customerId: propCustomerId = null, apiBase = "/api" }) {
  const { auth } = useAuth();
  const token = auth?.access ?? localStorage.getItem("access") ?? null;
  const detectedCustomerId = propCustomerId || (auth?.user?.profile?.customer_id ?? auth?.user?.customer_id ?? null);

  const [customerId, setCustomerId] = useState(detectedCustomerId);
  const [companyName, setCompanyName] = useState(auth?.user?.company || auth?.user?.profile?.company || "Your Company");

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [skills, setSkills] = useState([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState(null);

  const [showNewModal, setShowNewModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const [form, setForm] = useState({
    customer_name: auth?.user?.username || "",
    address: "",
    notes: "",
    requested_window_start: "",
    requested_window_end: "",
    estimated_duration_minutes: 60,
    required_skill_ids: [],
    lat: null,
    lon: null,
  });

  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  const scrollerRef = useRef(null);

  useEffect(() => {
    try { document.documentElement.setAttribute("data-theme", auth?.user?.profile?.theme || "dark"); } catch (e) {}
  }, [auth]);

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  /* ---------------------------
     Geocode: server-first approach
     --------------------------- */
  const geocodeAddress = useCallback(async (address) => {
    if (!address || !address.trim()) return null;
    try {
      const backendUrl = `${apiBase.replace(/\/$/, "")}/geocode/?q=${encodeURIComponent(address)}`;
      const res = await fetch(backendUrl, { headers });
      if (res.ok) {
        const payload = await res.json();
        const lat = payload.lat ?? payload.latitude ?? payload.lat_dd ?? null;
        const lon = payload.lon ?? payload.longitude ?? payload.lon_dd ?? null;
        const label = payload.label ?? payload.display_name ?? payload.name ?? null;
        if (lat != null && lon != null) return { lat: Number(lat), lon: Number(lon), label: label ?? address };
      } else {
        console.warn("backend geocode responded", res.status);
      }
    } catch (e) {
      console.warn("backend geocode error", e);
    }

    setToast({
      type: "error",
      text: "Geocoding not available from client. Please enable the server-side /api/geocode/ endpoint.",
    });
    return null;
  }, [apiBase, headers]);

  /* ---------------------------
     Geolocation (browser)
     --------------------------- */
  function useMyLocation() {
    if (!navigator.geolocation) {
      setToast({ type: "error", text: "Geolocation not supported by your browser." });
      return;
    }
    setToast({ type: "info", text: "Requesting location permission..." });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lon = Number(pos.coords.longitude.toFixed(6));
        setForm((p) => ({ ...p, lat, lon }));
        setToast({ type: "success", text: "Location captured." });
      },
      (err) => {
        console.error("geolocation error", err);
        setToast({ type: "error", text: "Unable to get location — permission denied or unavailable." });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  /* ---------------------------
     Fetch skills & requests
     --------------------------- */
  const fetchSkills = useCallback(async () => {
    setSkillsLoading(true); setSkillsError(null);
    try {
      const url = `${apiBase.replace(/\/$/, "")}/skills/`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`Skills fetch failed ${res.status}`);
      const data = await res.json();
      let list = [];
      if (Array.isArray(data)) list = data;
      else if (Array.isArray(data.results)) list = data.results;
      else list = data.items || [];
      const norm = list.map((s) => ({
        id: s.id ?? s.pk ?? s.skill_id,
        name: s.name ?? s.title ?? s.display_name ?? (s.slug || `skill-${s.id}`),
      }));
      setSkills(norm);
    } catch (err) {
      console.error(err);
      setSkillsError(err.message || "Failed to load skills");
      setSkills([]);
    } finally { setSkillsLoading(false); }
  }, [apiBase, token]);

  const fetchRequests = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let preferUrl;
      if (customerId) preferUrl = `${apiBase.replace(/\/$/, "")}/customers/${encodeURIComponent(customerId)}/requests/`;
      else preferUrl = `${apiBase.replace(/\/$/, "")}/customers/me/requests/`;
      const fallbackUrl = `${apiBase.replace(/\/$/, "")}/jobs/?page_size=50${customerId ? `&customer_id=${encodeURIComponent(customerId)}` : ""}`;

      let resp = await fetch(preferUrl, { headers });
      if (resp.status === 404 && !customerId) resp = await fetch(fallbackUrl, { headers });
      else if (resp.status === 404 && customerId) {
        const meUrl = `${apiBase.replace(/\/$/, "")}/customers/me/requests/`;
        resp = await fetch(meUrl, { headers });
        if (resp.status === 404) resp = await fetch(fallbackUrl, { headers });
      }

      if (!resp.ok) { const txt = await resp.text().catch(() => ""); throw new Error(`Server ${resp.status}: ${txt}`); }
      const data = await resp.json();

      let list = [];
      if (Array.isArray(data)) list = data;
      else if (Array.isArray(data.requests)) list = data.requests;
      else if (Array.isArray(data.results)) list = data.results;
      else if (Array.isArray(data.jobs)) list = data.jobs;
      else list = data.items || [];

      list = list.map((r) => {
        const assigned_raw = r.assigned_technician ?? r.assigned ?? r.technician ?? null;
        const req_skills = Array.isArray(r.required_skills) ? r.required_skills.map((s) => (typeof s === "object" ? (s.id ?? s.pk ?? s.skill_id) : s)) : [];
        return {
          id: r.id ?? r.job_id,
          title: r.title ?? r.customer_name ?? r.summary ?? `Job #${r.id ?? r.job_id}`,
          customer_name: r.customer_name ?? r.title ?? "Service request",
          status: (r.status || "").toLowerCase(),
          notes: r.notes ?? r.description ?? r.title ?? "",
          address: r.address ?? r.location ?? r.address_line ?? "",
          created_at: r.created_at ?? r.created,
          assigned_technician: (assigned_raw && typeof assigned_raw === "object" && assigned_raw.id)
            ? { id: assigned_raw.id, username: assigned_raw.username || assigned_raw.user?.username || null, display_name: assigned_raw.display_name || assigned_raw.user?.get_full_name?.() || assigned_raw.username || assigned_raw.user?.username || null }
            : (assigned_raw || null),
          estimated_arrival: r.estimated_arrival ?? r.meta?.diag?.predicted_arrival_iso ?? r.eta ?? null,
          completed_at: r.completed_at ?? r.meta?.completed_at ?? null,
          sla_flags: r.sla_flags ?? r.meta?.sla_flags ?? [],
          required_skill_ids: req_skills,
          lat: r.lat ?? r.location_lat ?? r.latitude ?? null,
          lon: r.lon ?? r.location_lon ?? r.longitude ?? null,
          notes_raw: r,
        };
      });

      setRequests(list);
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to load requests");
      setRequests([]);
    } finally { setLoading(false); }
  }, [customerId, apiBase, token]);

  useEffect(() => { fetchRequests(); fetchSkills(); }, [fetchRequests, fetchSkills]);

  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 3500); return () => clearTimeout(id); }, [toast]);

  /* form helpers */
  function updateForm(partial) { setForm((p) => ({ ...p, ...partial })); }
  function toggleSkill(id) { setForm((prev) => { const cur = new Set(prev.required_skill_ids || []); if (cur.has(id)) cur.delete(id); else cur.add(id); return { ...prev, required_skill_ids: Array.from(cur) }; }); }

  /* Submit new request */
  async function submitNewRequest(e) {
    e && e.preventDefault();
    setSubmitting(true); setError(null);

    if (!form.address || form.address.trim().length < 5) { setToast({ type: "error", text: "Address is required (min 5 characters)" }); setSubmitting(false); return; }
    if (!form.notes || form.notes.trim().length < 3) { setToast({ type: "error", text: "Please provide a short description (min 3 characters)." }); setSubmitting(false); return; }
    if (skills.length > 0 && (!form.required_skill_ids || form.required_skill_ids.length === 0)) { setToast({ type: "error", text: "Please select at least one required skill." }); setSubmitting(false); return; }

    try {
      const url = `${apiBase.replace(/\/$/, "")}/customers/me/requests/`;
      const body = {
        customer_name: form.customer_name,
        address: form.address,
        notes: form.notes,
        requested_window_start: form.requested_window_start || null,
        requested_window_end: form.requested_window_end || null,
        estimated_duration_minutes: form.estimated_duration_minutes || null,
        required_skill_ids: form.required_skill_ids || [],
        lat: form.lat ?? null,
        lon: form.lon ?? null,
      };

      if ((body.lat == null || body.lon == null) && body.address) {
        const g = await geocodeAddress(body.address);
        if (g) { body.lat = g.lat; body.lon = g.lon; updateForm({ lat: g.lat, lon: g.lon }); }
      }

      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (!res.ok) { const txt = await res.text().catch(() => ""); throw new Error(`Server ${res.status}: ${txt}`); }
      await res.json();
      setToast({ type: "success", text: "Service request submitted" });
      setShowNewModal(false);
      setForm((f) => ({ ...f, address: "", notes: "", requested_window_start: "", requested_window_end: "", estimated_duration_minutes: 60, required_skill_ids: [], lat: null, lon: null }));
      await fetchRequests();
    } catch (err) {
      console.error("submitNewRequest error", err);
      setToast({ type: "error", text: err.message || "Failed to create request" });
    } finally { setSubmitting(false); }
  }

  /* details modal helpers */
  function openDetails(req) { setSelectedRequest(req); setShowDetailModal(true); }
  function closeDetails() { setSelectedRequest(null); setShowDetailModal(false); }

  const summaryPending = requests.filter((r) => (r.status === "pending" || r.status === "new")).length;
  const summaryInProgress = requests.filter((r) => (r.status === "in_progress" || r.status === "assigned")).length;
  const summaryCompleted = requests.filter((r) => (r.status === "completed" || r.status === "done")).length;

  /* JobCard */
  function JobCard({ job }) {
    const status = (job.status || "").toLowerCase();
    const label = status === "completed" || status === "done" ? "Completed" : status === "assigned" ? "Assigned" : status === "in_progress" ? "In progress" : status || "Pending";
    const tone = status === "completed" ? "success" : status === "assigned" ? "info" : "muted";
    const assigned = job.assigned_technician && typeof job.assigned_technician === "object"
      ? (job.assigned_technician.display_name || job.assigned_technician.username || "Unassigned")
      : (job.assigned_technician || "Unassigned");

    return (
      <article className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4 shadow-sm hover:shadow-md transition" role="article" aria-label={`Job ${job.id}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-slate-400 dark:text-slate-300 truncate">{job.customer_name}</div>
            <div className="text-lg font-semibold mt-1 truncate">{job.title}</div>
            <div className="text-sm text-slate-500 dark:text-slate-300 mt-1 break-words">{job.address || "—"}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="mb-2"><Badge tone={tone}>{label}</Badge></div>
            <div className="text-xs text-slate-400 dark:text-slate-300">ETA: {job.estimated_arrival || "—"}</div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="text-xs text-slate-500 dark:text-slate-300">Assigned: <strong className="text-slate-700 dark:text-slate-100">{assigned}</strong></div>
          <div>
            <Button variant="ghost" small onClick={() => openDetails(job)}>View</Button>
          </div>
        </div>
      </article>
    );
  }

  /* Render */
  return (
    <div className="max-w-5xl mx-auto p-6">
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Service Portal</h1>
          <div className="text-sm text-slate-600 dark:text-slate-300 mt-1">{companyName}</div>
          <div className="text-xs text-slate-400 dark:text-slate-400 mt-1">Customer id: <strong className="text-slate-700 dark:text-slate-100">{customerId ?? "—"}</strong></div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={() => setShowNewModal(true)} variant="primary">New Service Request</Button>
          <Button onClick={() => { fetchRequests(); fetchSkills(); }} variant="ghost" disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</Button>
        </div>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <div className="text-sm text-slate-600 dark:text-slate-300">New Requests</div>
          <div className="text-3xl font-semibold mt-2 text-slate-900 dark:text-slate-100">{summaryPending}</div>
          <div className="text-xs text-slate-400 mt-1">Requests awaiting submission or review</div>
        </Card>

        <Card>
          <div className="text-sm text-slate-600 dark:text-slate-300">In Progress</div>
          <div className="text-2xl font-semibold mt-2 text-slate-900 dark:text-slate-100">{summaryInProgress}</div>
        </Card>

        <Card>
          <div className="text-sm text-slate-600 dark:text-slate-300">Completed</div>
          <div className="text-2xl font-semibold mt-2 text-slate-900 dark:text-slate-100">{summaryCompleted}</div>
        </Card>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Your Service Requests</h2>
          <div className="text-sm text-slate-500 dark:text-slate-300">{requests.length} total</div>
        </div>

        {loading && <div className="text-sm text-slate-500 dark:text-slate-300 mb-2">Loading...</div>}
        {error && <div className="text-sm text-rose-700 bg-rose-50 dark:bg-rose-900 dark:text-rose-200 p-3 rounded mb-2">{error}</div>}

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {!loading && requests.length === 0 && (
            <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-6 text-center text-slate-500 dark:text-slate-300">No requests yet. Click <button onClick={() => setShowNewModal(true)} className="underline">New Service Request</button>.</div>
          )}

          {loading && Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 animate-pulse h-36" />
          ))}

          {!loading && requests.map((r) => (<JobCard key={r.id} job={r} />))}
        </div>
      </section>

      <footer className="mt-8 text-sm text-slate-500 dark:text-slate-300">Need Help? Our system assigns the best technician based on skills and availability. You'll receive updates via email and SMS.</footer>

      <Toast toast={toast} />

      {/* New Request Modal */}
      <Modal open={showNewModal} onClose={() => setShowNewModal(false)} title="New Service Request">
        <form onSubmit={submitNewRequest} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-600 dark:text-slate-300">Your name</label>
              <input value={form.customer_name} onChange={(e) => updateForm({ customer_name: e.target.value })} className="w-full mt-1 p-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" placeholder="Full name" />
            </div>

            <div>
              <label className="text-sm text-slate-600 dark:text-slate-300">Address <span className="text-xs text-slate-400">(required)</span></label>
              <input
                value={form.address}
                onChange={(e) => updateForm({ address: e.target.value })}
                onBlur={async () => {
                  if (!form.address || form.address.trim().length < 5) return;
                  const g = await geocodeAddress(form.address);
                  if (g) { updateForm({ lat: g.lat, lon: g.lon }); setToast({ type: 'info', text: `Location found: ${g.label || form.address}` }); }
                }}
                className="w-full mt-1 p-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                placeholder="Street, city, etc."
              />

              <div className="mt-2 flex gap-2">
                <Button type="button" variant="ghost" small onClick={async () => {
                  if (!form.address) { setToast({ type: 'error', text: 'Enter address first' }); return; }
                  const g = await geocodeAddress(form.address);
                  if (!g) { setToast({ type: 'error', text: 'Could not geocode address — ensure server endpoint exists' }); return; }
                  updateForm({ lat: g.lat, lon: g.lon }); setToast({ type: 'info', text: `Location found: ${g.label || form.address}` });
                }}>Locate</Button>

                <Button type="button" variant="ghost" small onClick={() => { updateForm({ lat: null, lon: null }); setToast({ type: 'info', text: 'Cleared saved location' }); }}>Clear</Button>

                <Button type="button" variant="ghost" small onClick={() => useMyLocation()}>Use my location</Button>

                <div className="ml-auto text-xs text-slate-400 dark:text-slate-300">Lat: <strong>{form.lat ?? '—'}</strong> · Lon: <strong>{form.lon ?? '—'}</strong></div>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="text-sm text-slate-600 dark:text-slate-300">Description / Issue <span className="text-xs text-slate-400">(required)</span></label>
              <textarea value={form.notes} onChange={(e) => updateForm({ notes: e.target.value })} rows={4} className="w-full mt-1 p-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" placeholder="Describe the issue..." />
            </div>

            <div>
              <label className="text-sm text-slate-600 dark:text-slate-300">Preferred start (optional)</label>
              <input type="datetime-local" value={form.requested_window_start} onChange={(e) => updateForm({ requested_window_start: e.target.value })} className="w-full mt-1 p-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" />
            </div>

            <div>
              <label className="text-sm text-slate-600 dark:text-slate-300">Preferred end (optional)</label>
              <input type="datetime-local" value={form.requested_window_end} onChange={(e) => updateForm({ requested_window_end: e.target.value })} className="w-full mt-1 p-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" />
            </div>

            <div>
              <label className="text-sm text-slate-600 dark:text-slate-300">Estimated duration (min)</label>
              <input type="number" min={5} value={form.estimated_duration_minutes} onChange={(e) => updateForm({ estimated_duration_minutes: Number(e.target.value) })} className="w-full mt-1 p-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" />
            </div>

            <div>
              <label className="text-sm text-slate-600 dark:text-slate-300">Required skills {skills.length > 0 ? <span className="text-xs text-slate-400">(select one or more)</span> : <span className="text-xs text-slate-400">(optional)</span>}</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {skillsLoading ? <div className="text-sm text-slate-500 dark:text-slate-300">Loading skills…</div> : skills.length === 0 ? <div className="text-sm text-slate-500 dark:text-slate-300">No skills configured.</div> : skills.map((s) => {
                  const active = (form.required_skill_ids || []).includes(s.id);
                  return (
                    <button key={s.id} type="button" onClick={() => toggleSkill(s.id)} className={`px-3 py-1 rounded-full text-xs font-medium ${active ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-100"}`}>{s.name}</button>
                  );
                })}
              </div>

              {skills.length > 0 && (
                <select multiple value={form.required_skill_ids.map(String)} onChange={(e) => { const opts = Array.from(e.target.selectedOptions).map((o) => Number(o.value)); updateForm({ required_skill_ids: opts }); }} className="w-full mt-2 p-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" size={4}>
                  {skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              {skillsError && <div className="text-xs text-rose-600 mt-1">{skillsError}</div>}
            </div>

            {/* Map preview */}
            <div className="md:col-span-2">
              <label className="text-sm text-slate-600 dark:text-slate-300">Location preview (click map to set marker)</label>
              <div className="mt-2 rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700" style={{ height: 300 }}>
                {form.lat && form.lon ? (
                  <MapContainer center={[form.lat, form.lon]} zoom={14} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <Marker position={[form.lat, form.lon]}>
                      <Popup>{form.address || 'Selected location'}</Popup>
                    </Marker>
                    <ClickableMap onClick={(pos) => updateForm({ lat: pos[0], lon: pos[1] })} />
                  </MapContainer>
                ) : (
                  <MapContainer center={[-17.8252, 31.0335]} zoom={13} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <ClickableMap onClick={(pos) => updateForm({ lat: pos[0], lon: pos[1] })} />
                  </MapContainer>
                )}
              </div>
              <div className="text-xs text-slate-400 dark:text-slate-300 mt-2">Latitude: <strong>{form.lat ?? '—'}</strong> · Longitude: <strong>{form.lon ?? '—'}</strong></div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowNewModal(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit Request'}</Button>
          </div>
        </form>
      </Modal>

      {/* Details Modal */}
      <Modal open={showDetailModal} onClose={closeDetails} title={selectedRequest ? (selectedRequest.title || `Request #${selectedRequest.id}`) : 'Request details'}>
        {selectedRequest ? (
          <div className="space-y-3">
            <div className="text-sm text-slate-500 dark:text-slate-300">Customer</div>
            <div className="font-medium text-slate-900 dark:text-slate-100">{selectedRequest.customer_name}</div>

            <div className="text-sm text-slate-500 dark:text-slate-300 mt-2">Address</div>
            <div>{selectedRequest.address || '—'}</div>

            <div className="text-sm text-slate-500 dark:text-slate-300 mt-2">Assigned technician</div>
            <div>{selectedRequest.assigned_technician && typeof selectedRequest.assigned_technician === 'object' ? (selectedRequest.assigned_technician.display_name || selectedRequest.assigned_technician.username) : (selectedRequest.assigned_technician || 'Unassigned')}</div>

            <div className="text-sm text-slate-500 dark:text-slate-300 mt-2">Required skills</div>
            <div>{Array.isArray(selectedRequest.required_skill_ids) && selectedRequest.required_skill_ids.length > 0 ? selectedRequest.required_skill_ids.join(', ') : <span className="text-slate-400 dark:text-slate-500">None specified</span>}</div>

            <div className="text-sm text-slate-500 dark:text-slate-300 mt-2">Notes</div>
            <div className="p-3 rounded bg-gray-50 dark:bg-slate-700 whitespace-pre-wrap text-slate-900 dark:text-slate-100">{selectedRequest.notes || '—'}</div>

            <div className="flex justify-end">
              <Button variant="primary" onClick={closeDetails}>Done</Button>
            </div>
          </div>
        ) : <div>Loading…</div>}
      </Modal>
    </div>
  );
}
