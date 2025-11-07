import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "../auth/AuthProvider";
import JobCard from "../components/JobCard";
import { useTheme } from "../theme/ThemeProvider";

/**
 * CustomerPortal (modern redesign + details modal)
 * - Adds a View Details modal that appears when a JobCard requests it.
 * - JobCard is passed an `onView` callback — clicking "View details" inside JobCard
 *   should call that prop (or you can wire it to the card's main CTA).
 * - Details modal styles match the New Request modal (opaque, blurred backdrop).
 */

export default function CustomerPortal({ customerId: propCustomerId = null, apiBase = "/api" }) {
  const { auth } = useAuth();
  const { theme } = useTheme();

  const token = auth?.access || localStorage.getItem("access");
  const detectedCustomerId = propCustomerId || (auth?.user?.profile?.customer_id ?? auth?.user?.customer_id ?? null);

  const [customerId, setCustomerId] = useState(detectedCustomerId);
  const [companyName, setCompanyName] = useState(auth?.user?.company || auth?.user?.profile?.company || "Your Company");
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // modal form state (new request)
  const [showNewModal, setShowNewModal] = useState(false);
  const [form, setForm] = useState({
    customer_name: auth?.user?.username || "",
    address: "",
    notes: "",
    requested_window_start: "",
    requested_window_end: "",
    estimated_duration_minutes: 60,
  });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  // details modal state
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  useEffect(() => {
    try {
      document.documentElement.setAttribute("data-theme", theme);
    } catch (e) {}
  }, [theme]);

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const normalizeAssigned = (raw) => {
    if (!raw) return null;
    if (typeof raw === "string") return raw;
    if (typeof raw === "object") {
      if (raw.display_name || raw.username) return raw.display_name || raw.username;
      if (raw.user && typeof raw.user === "object") {
        return raw.user.username || raw.user.email || JSON.stringify(raw.user);
      }
      try {
        if (raw.id) return raw.username || `tech-${raw.id}`;
      } catch (e) {}
      return JSON.stringify(raw);
    }
    return String(raw);
  };

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let preferUrl;
      if (customerId) {
        preferUrl = `${apiBase.replace(/\/$/, "")}/customers/${encodeURIComponent(customerId)}/requests/`;
      } else {
        preferUrl = `${apiBase.replace(/\/$/, "")}/customers/me/requests/`;
      }
      const fallbackUrl = `${apiBase.replace(/\/$/, "")}/jobs/?page_size=50${customerId ? `&customer_id=${encodeURIComponent(customerId)}` : ""}`;

      let resp = await fetch(preferUrl, { headers });

      if (resp.status === 404 && !customerId) {
        resp = await fetch(fallbackUrl, { headers });
      } else if (resp.status === 404 && customerId) {
        const meUrl = `${apiBase.replace(/\/$/, "")}/customers/me/requests/`;
        resp = await fetch(meUrl, { headers });
        if (resp.status === 404) resp = await fetch(fallbackUrl, { headers });
      }

      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        throw new Error(`Server ${resp.status}: ${txt}`);
      }

      const data = await resp.json();

      let list = [];
      if (Array.isArray(data)) list = data;
      else if (Array.isArray(data.requests)) list = data.requests;
      else if (Array.isArray(data.results)) list = data.results;
      else if (Array.isArray(data.traces)) list = data.traces;
      else if (Array.isArray(data.jobs)) list = data.jobs;
      else list = data.items || [];

      list = list.map((r) => {
        const assigned_raw = r.assigned_technician ?? r.assigned ?? r.technician ?? null;
        const assigned_display = normalizeAssigned(assigned_raw);

        return {
          id: r.id ?? r.job_id,
          customer_name: r.customer_name ?? r.title ?? r.summary ?? "Service request",
          title: r.title ?? r.customer_name ?? r.summary ?? "Service request",
          status: (r.status || "").toLowerCase(),
          notes: r.notes ?? r.description ?? r.title ?? "",
          address: r.address ?? r.location ?? "",
          created_at: r.created_at ?? r.created,
          assigned_technician: (typeof assigned_raw === "object" && assigned_raw !== null && assigned_raw.id) ? {
            id: assigned_raw.id,
            username: assigned_raw.username || assigned_raw.user?.username || null,
            display_name: assigned_raw.display_name || assigned_raw.user?.get_full_name?.() || assigned_raw.username || assigned_raw.user?.username || null,
            contact_phone: assigned_raw.contact_phone ?? assigned_raw.user?.profile?.phone ?? null,
          } : assigned_display,
          estimated_arrival: r.estimated_arrival ?? r.meta?.diag?.predicted_arrival_iso ?? r.eta ?? null,
          completed_at: r.completed_at ?? r.meta?.completed_at ?? null,
          sla_flags: r.sla_flags ?? r.meta?.sla_flags ?? [],
          notes_raw: r,
        };
      });

      setRequests(list);

      if (!customerId && data?.pagination && data?.pagination?.customer_id) {
        setCustomerId(String(data.pagination.customer_id));
      }
    } catch (err) {
      console.error("fetchRequests error", err);
      setError(err.message || "Failed to load requests");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [customerId, apiBase, token]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const statusVariant = (s) => {
    const st = (s || "").toLowerCase();
    if (st === "completed" || st === "done") return { label: "Completed", className: "variant-success" };
    if (st === "assigned") return { label: "Assigned", className: "variant-info" };
    if (st === "in_progress" || st === "in progress") return { label: "In progress", className: "variant-warn" };
    if (st === "pending" || st === "new") return { label: "Pending", className: "variant-muted" };
    return { label: st || "Unknown", className: "variant-muted" };
  };

  async function submitNewRequest(e) {
    e && e.preventDefault();
    setSubmitting(true);
    setError(null);

    if (!form.notes || form.notes.trim().length < 3) {
      setToast({ type: "error", text: "Please provide a short description (min 3 characters)." });
      setSubmitting(false);
      return;
    }

    try {
      const url = `${apiBase.replace(/\/$/, "")}/customers/me/requests/`;
      const body = {
        customer_name: form.customer_name,
        address: form.address,
        notes: form.notes,
        requested_window_start: form.requested_window_start || null,
        requested_window_end: form.requested_window_end || null,
        estimated_duration_minutes: form.estimated_duration_minutes || null,
      };
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        throw new Error(`Server ${resp.status}: ${txt}`);
      }
      const created = await resp.json();
      setToast({ type: "success", text: "Service request submitted" });
      setShowNewModal(false);
      setForm((f) => ({ ...f, address: "", notes: "", requested_window_start: "", requested_window_end: "" }));
      await fetchRequests();
    } catch (err) {
      console.error("submitNewRequest error", err);
      setToast({ type: "error", text: err.message || "Failed to create request" });
    } finally {
      setSubmitting(false);
    }
  }

  // open details modal for a request
  function openDetails(req) {
    setSelectedRequest(req);
    setShowDetailModal(true);
  }

  function closeDetails() {
    setSelectedRequest(null);
    setShowDetailModal(false);
  }

  // helper to prefill and open new-request modal from a request ("Create similar")
  function createSimilarFrom(req) {
    setForm((f) => ({
      ...f,
      customer_name: req.customer_name || f.customer_name,
      address: req.address || f.address,
      notes: `Follow-up: ${req.notes || req.title || ""}`,
      requested_window_start: "",
      requested_window_end: "",
    }));
    setShowDetailModal(false);
    setShowNewModal(true);
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Theme variables + modern polish */}
      <style>{`
        [data-theme="dark"] {
          --bg: #0b1120;
          --panel: #071017;
          --muted: #9aa7b8;
          --text: #e6eef7;
          --accent: #16a34a;
          --glass: rgba(255,255,255,0.03);
          --input-bg: #071017;
          --input-border: rgba(255,255,255,0.06);
          --placeholder: rgba(230,238,247,0.45);
          --card-quiet-bg: #071017;
          --card-quiet-border: rgba(255,255,255,0.04);
          --scroll-thumb: rgba(255,255,255,0.06);
          --shadow-strong: rgba(2,6,23,0.6);
        }

        [data-theme="light"] {
          --bg: #f8fafb;
          --panel: #ffffff;
          --muted: #55607a;
          --text: #0b1220;
          --accent: #16a34a;
          --glass: rgba(0,0,0,0.02);
          --input-bg: #fff;
          --input-border: rgba(2,6,23,0.06);
          --placeholder: rgba(71,85,105,0.5);
          --card-quiet-bg: #ffffff;
          --card-quiet-border: rgba(2,6,23,0.06);
          --scroll-thumb: rgba(0,0,0,0.12);
          --shadow-strong: rgba(2,6,23,0.12);
        }

        body { background: var(--bg); }

        .panel { background: var(--panel); color: var(--text); }
        .muted { color: var(--muted); }
        .accent { color: var(--accent); }

        .btn-primary {
          background: linear-gradient(180deg,var(--accent), #059669);
          color: white; border: none; padding: 8px 12px; border-radius: 10px; font-weight:600;
        }
        .btn-ghost { background: transparent; color: var(--text); border: 1px solid var(--glass); padding: 8px 10px; border-radius: 10px; }

        .card-quiet {
          background: var(--card-quiet-bg);
          border: 1px solid var(--card-quiet-border);
          color: var(--text);
          padding: 16px; border-radius: 12px;
        }

        .variant-success { background: rgba(16,185,129,0.09); color: #059669; padding: 4px 8px; border-radius: 6px; font-weight:600; font-size:12px;}
        .variant-info { background: rgba(59,130,246,0.08); color: #2563eb; padding: 4px 8px; border-radius:6px; font-weight:600; font-size:12px;}
        .variant-warn { background: rgba(245,158,11,0.08); color: #b45309; padding: 4px 8px; border-radius:6px; font-weight:600; font-size:12px;}
        .variant-muted { background: rgba(148,163,184,0.06); color: var(--muted); padding: 4px 8px; border-radius:6px; font-weight:600; font-size:12px;}

        /* Modal backdrop — stronger and with blur so popup doesn't look transparent */
        .modal-backdrop { background: rgba(2,6,23,0.78); backdrop-filter: blur(6px); }

        /* Opaque, elevated modal panel */
        .modal-panel { background: var(--panel); border: 1px solid var(--card-quiet-border); padding: 20px; border-radius: 14px; box-shadow: 0 18px 40px var(--shadow-strong); }

        /* Inputs */
        .panel input, .panel textarea, .panel select, .panel .w-full.p-2 {
          background: var(--input-bg); color: var(--text); border: 1px solid var(--input-border); padding: 10px; border-radius: 10px; outline: none;
        }
        .panel input:focus, .panel textarea:focus, .panel select:focus { box-shadow: 0 8px 20px rgba(59,130,246,0.06); transform: translateY(-1px); }

        /* Toast — solid and legible */
        .toast { padding: 12px 14px; border-radius: 12px; box-shadow: 0 8px 26px rgba(2,6,23,0.2); font-weight:600; }

        .scrollable { scrollbar-width: thin; }
        .scrollable::-webkit-scrollbar { height:8px; width:8px; }
        .scrollable::-webkit-scrollbar-thumb { background: var(--scroll-thumb); border-radius: 8px; }

        @media (max-width: 640px) { .card-quiet { padding: 12px; } }
      `}</style>

      <header className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Service Portal</h1>
          <div className="text-sm muted mt-1">{companyName}</div>
          <div className="text-xs muted mt-1">Customer id: <strong>{customerId ?? "—"}</strong></div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowNewModal(true)}
            className="btn-primary"
            aria-label="Create new service request"
          >
            New Service Request
          </button>

          <button onClick={() => fetchRequests()} className="btn-ghost" disabled={loading} aria-label="Refresh requests">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {/* Informational / CTA card — no longer double-opens the modal when the JobCard also has a view */}
        <div className="card-quiet flex flex-col items-start justify-between rounded-lg" style={{ minHeight: 110 }}>
          <div>
            <div className="text-sm muted">New Service Request</div>
            <div className="text-3xl font-semibold mt-2" style={{ color: "var(--text)" }}>
              {requests.filter(r => r.status === "pending" || r.status === "new").length}
            </div>
            <div className="text-xs muted mt-1">Requests awaiting submission or review</div>
          </div>

          <div className="w-full mt-4 flex justify-end">
            <button onClick={() => setShowNewModal(true)} className="btn-primary text-sm">Create request</button>
          </div>
        </div>

        <div className="card-quiet rounded-lg">
          <div className="text-sm muted">In Progress</div>
          <div className="text-2xl font-semibold" style={{ color: "var(--text)" }}>
            {requests.filter(r => r.status === "in_progress" || r.status === "assigned").length}
          </div>
        </div>

        <div className="card-quiet rounded-lg">
          <div className="text-sm muted">Completed</div>
          <div className="text-2xl font-semibold" style={{ color: "var(--text)" }}>
            {requests.filter(r => r.status === "completed" || r.status === "done").length}
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>Your Service Requests</h2>

        {loading && <div className="text-muted mt-2">Loading...</div>}
        {error && <div className="text-sm text-rose-700 bg-rose-50 p-3 rounded mt-2">{error}</div>}

        <div className="space-y-4 mt-4">
          {requests.length === 0 && !loading && (
            <div className="card-quiet p-6 rounded shadow text-muted text-center">
              No requests yet. Click <button onClick={() => setShowNewModal(true)} className="underline">New Service Request</button>.
            </div>
          )}

          {requests.map((r) => (
            <JobCard key={r.id} job={r} onView={() => openDetails(r)} />
          ))}
        </div>
      </section>

      <footer className="mt-8 text-sm muted">
        <div className="mb-2">Need Help? Our system assigns the best technician based on skills and availability. You'll receive updates via email and SMS.</div>
        <div>Phone: +263-555-0100 · Email: <a href="mailto:support@hof-smart.com" className="underline">support@hof-smart.com</a></div>
        <div className="mt-4 text-xs muted">Powered by HOF-SMART · © 2025 National University of Science and Technology</div>
      </footer>

      {/* toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 toast ${toast.type === "error" ? "" : ""}`}>
          <div className={toast.type === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"} style={{ padding: 10, borderRadius: 10 }}>
            {toast.text}
          </div>
        </div>
      )}

      {/* New Request Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
          <form
            onSubmit={submitNewRequest}
            className="modal-panel w-full max-w-2xl panel"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between">
              <h3 className="text-lg font-semibold">New Service Request</h3>
              <button type="button" onClick={() => setShowNewModal(false)} className="text-sm muted">Close</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="text-sm muted">Your name</label>
                <input
                  value={form.customer_name}
                  onChange={(e) => setForm({...form, customer_name: e.target.value})}
                  className="w-full mt-1 p-2 rounded"
                  placeholder="Full name"
                />
              </div>
              <div>
                <label className="text-sm muted">Address</label>
                <input
                  value={form.address}
                  onChange={(e) => setForm({...form, address: e.target.value})}
                  className="w-full mt-1 p-2 rounded"
                  placeholder="Street, city, etc."
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-sm muted">Description / Issue</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({...form, notes: e.target.value})}
                  rows={4}
                  className="w-full mt-1 p-2 rounded scrollable"
                  placeholder="Describe the issue..."
                />
              </div>

              <div>
                <label className="text-sm muted">Preferred start (optional)</label>
                <input
                  type="datetime-local"
                  value={form.requested_window_start}
                  onChange={(e) => setForm({...form, requested_window_start: e.target.value})}
                  className="w-full mt-1 p-2 rounded"
                />
              </div>
              <div>
                <label className="text-sm muted">Preferred end (optional)</label>
                <input
                  type="datetime-local"
                  value={form.requested_window_end}
                  onChange={(e) => setForm({...form, requested_window_end: e.target.value})}
                  className="w-full mt-1 p-2 rounded"
                />
              </div>

              <div>
                <label className="text-sm muted">Estimated duration (min)</label>
                <input
                  type="number"
                  min={15}
                  value={form.estimated_duration_minutes}
                  onChange={(e) => setForm({...form, estimated_duration_minutes: Number(e.target.value)})}
                  className="w-full mt-1 p-2 rounded"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowNewModal(false)} className="btn-ghost">Cancel</button>
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? "Submitting…" : "Submit Request"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Details Modal */}
      {showDetailModal && selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
          <div className="modal-panel w-full max-w-2xl panel" role="dialog" aria-modal="true">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">{selectedRequest.title || "Request details"}</h3>
                <div className="text-xs muted mt-1">ID: <strong>{selectedRequest.id}</strong></div>
              </div>

              <div className="flex items-center gap-2">
                <div className={statusVariant(selectedRequest.status).className} style={{ textTransform: 'capitalize' }}>{statusVariant(selectedRequest.status).label}</div>
                <button type="button" onClick={closeDetails} className="text-sm muted">Close</button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <div className="text-sm muted">Customer</div>
                <div className="mt-1 font-medium">{selectedRequest.customer_name}</div>

                <div className="text-sm muted mt-3">Address</div>
                <div className="mt-1">{selectedRequest.address || '—'}</div>

                <div className="text-sm muted mt-3">Assigned technician</div>
                <div className="mt-1">{typeof selectedRequest.assigned_technician === 'object' ? (selectedRequest.assigned_technician.display_name || selectedRequest.assigned_technician.username) : (selectedRequest.assigned_technician || 'Unassigned')}</div>
              </div>

              <div>
                <div className="text-sm muted">Created</div>
                <div className="mt-1">{selectedRequest.created_at || '—'}</div>

                <div className="text-sm muted mt-3">ETA / Estimated arrival</div>
                <div className="mt-1">{selectedRequest.estimated_arrival || '—'}</div>

                <div className="text-sm muted mt-3">Completed at</div>
                <div className="mt-1">{selectedRequest.completed_at || '—'}</div>
              </div>

              <div className="md:col-span-2">
                <div className="text-sm muted">Notes</div>
                <div className="mt-1 panel p-3 rounded scrollable" style={{ whiteSpace: 'pre-wrap' }}>{selectedRequest.notes || '—'}</div>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => { createSimilarFrom(selectedRequest); }} className="btn-ghost">Create similar</button>
              <button type="button" onClick={closeDetails} className="btn-primary">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
