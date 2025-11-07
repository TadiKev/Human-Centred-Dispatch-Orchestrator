// frontend/src/pages/RequestDetails.jsx
import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useTheme } from "../theme/ThemeProvider";

/**
 * RequestDetails (theme-aware)
 * - Styling improved; functionality unchanged.
 */

export default function RequestDetails({ apiBase = "/api" }) {
  const { id } = useParams();
  const { auth } = useAuth();
  const { theme } = useTheme();

  const token = auth?.access || localStorage.getItem("access");
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    try { document.documentElement.setAttribute("data-theme", theme); } catch (e) {}
  }, [theme]);

  useEffect(() => {
    let mounted = true;
    async function fetchJob() {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`${apiBase.replace(/\/$/, "")}/jobs/${encodeURIComponent(id)}/`, { headers });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => "");
          throw new Error(`Server ${resp.status}: ${txt}`);
        }
        const data = await resp.json();
        if (!mounted) return;
        setJob(data);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || "Failed to load job");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetchJob();
    return () => { mounted = false; };
  }, [id, apiBase, token]);

  function statusBadge(status) {
    const st = (status || "").toLowerCase();
    if (st === "done" || st === "completed") return <span className="status-pill status-success">Completed</span>;
    if (st === "assigned") return <span className="status-pill status-info">Assigned</span>;
    if (st === "in_progress" || st === "in progress") return <span className="status-pill status-warn">In progress</span>;
    if (st === "new" || st === "pending") return <span className="status-pill status-muted">Pending</span>;
    return <span className="status-pill status-muted">{st || "Unknown"}</span>;
  }

  if (loading) return <div className="p-6">Loading request…</div>;
  if (error) return <div className="p-6 text-red-600">Error: {error}</div>;
  if (!job) return <div className="p-6">No job found.</div>;

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "—");
  const priority = (job.meta && job.meta.priority) || job.priority || "normal";

  return (
    <div className="max-w-4xl mx-auto p-6">
      <style>{`
        [data-theme="dark"] {
          --bg: #0f1724;
          --panel: #0b1220;
          --text: #e6eef7;
          --muted: #9aa7b8;
          --accent: #16a34a;
          --card-border: rgba(255,255,255,0.04);
        }
        [data-theme="light"] {
          --bg: #f8fafb;
          --panel: #ffffff;
          --text: #0f1724;
          --muted: #475569;
          --accent: #16a34a;
          --card-border: rgba(0,0,0,0.06);
        }

        .panel { background: var(--panel); color: var(--text); border: 1px solid var(--card-border); }
        .muted { color: var(--muted); }
        .status-pill { display:inline-block; padding:6px 10px; border-radius:10px; font-weight:600; font-size:12px; }
        .status-success { background: rgba(16,185,129,0.09); color: #059669; }
        .status-info { background: rgba(59,130,246,0.08); color: #2563eb; }
        .status-warn { background: rgba(245,158,11,0.08); color: #b45309; }
        .status-muted { background: rgba(148,163,184,0.06); color: var(--muted); }
      `}</style>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Service Request Details</h1>
          <div className="text-sm muted mt-1">View complete details and status updates for your service request.</div>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/portal" className="px-3 py-1 rounded border muted hover:underline">Back to Portal</Link>
        </div>
      </div>

      <div className="panel rounded-lg shadow p-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-xl font-semibold" style={{ color: "var(--text)" }}>{job.customer_name ?? "Service Request"}</div>
            <div className="text-sm muted mt-1">{job.notes}</div>
          </div>

          <div className="text-right">
            <div className="mb-2">{statusBadge(job.status)}</div>
            <div className="text-xs muted">Request ID</div>
            <div className="font-mono text-sm" style={{ color: "var(--text)" }}>{job.id ? `job-${String(job.id).padStart(3, "0")}` : "—"}</div>
            <div className="text-xs muted mt-3">Priority</div>
            <div className="font-semibold" style={{ color: "var(--text)" }}>{priority}</div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm muted">
          <div>
            <div className="text-xs muted">Address</div>
            <div style={{ color: "var(--text)" }}>{job.address || "—"}</div>
          </div>
          <div>
            <div className="text-xs muted">Created</div>
            <div style={{ color: "var(--text)" }}>{fmt(job.created_at)}</div>
          </div>

          <div>
            <div className="text-xs muted">Window Start</div>
            <div style={{ color: "var(--text)" }}>{fmt(job.requested_window_start)}</div>
          </div>
          <div>
            <div className="text-xs muted">Window End</div>
            <div style={{ color: "var(--text)" }}>{fmt(job.requested_window_end)}</div>
          </div>

          <div>
            <div className="text-xs muted">Estimated Service Duration</div>
            <div style={{ color: "var(--text)" }}>{job.estimated_duration_minutes ? `${job.estimated_duration_minutes} minutes` : "—"}</div>
          </div>
          <div>
            <div className="text-xs muted">Technician Assigned</div>
            <div style={{ color: "var(--text)" }}>{job.assigned_technician ?? "Your service request hasn't been assigned yet."}</div>
          </div>

          <div className="md:col-span-2">
            <div className="text-xs muted">Required skills / tags</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(job.required_skills || []).length === 0 && <div className="text-muted">No specific skills requested.</div>}
              {(job.required_skills || []).map((s) => (
                <div key={s.id} className="text-xs px-2 py-1 border rounded" style={{ background: "var(--panel)" }}>{s.name}</div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 border-t pt-4 text-sm muted">
          <h3 className="font-semibold mb-2" style={{ color: "var(--text)" }}>Activity & Status</h3>
          <div className="mb-2">
            {job.status === "done" || job.status === "completed"
              ? <div>Completed: {job.completed_at ? `Service completed on ${fmt(job.completed_at)}` : "Completed."}</div>
              : <div>Updates will appear here as technicians update the job.</div>}
          </div>
          <div className="text-xs muted">Estimated arrival</div>
          <div className="mb-2" style={{ color: "var(--text)" }}>{job.estimated_arrival ? fmt(job.estimated_arrival) : "—"}</div>
        </div>
      </div>

      <footer className="mt-8 text-sm muted">
        <div className="mb-2">Need Help? Our AI-powered system automatically assigns the best technician based on skills, proximity, and availability. You'll receive updates via email and SMS throughout the service process.</div>
        <div>Phone: +263-555-0100 · Email: <a href="mailto:support@hof-smart.com" className="underline muted">support@hof-smart.com</a></div>
        <div className="mt-4 text-xs muted">Powered by HOF-SMART — AI-Powered Field Service Management · © 2025 National University of Science and Technology</div>
      </footer>
    </div>
  );
}
