// frontend/src/pages/ManagerJobs.jsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/fetcher";
import AssignModal from "../components/AssignModal";
import { useAuth } from "../auth/AuthProvider";
import { useTheme } from "../theme/ThemeProvider";

export default function ManagerJobs() {
  const { auth } = useAuth();
  const token = auth?.access ?? null;

  const { theme } = useTheme();

  // theme-aware classes
  const pageBg = theme === "dark" ? "bg-slate-900 text-slate-100" : "bg-slate-50 text-slate-900";
  const cardBg = theme === "dark" ? "bg-slate-800 text-slate-100 border border-slate-700" : "bg-white text-slate-900 border border-gray-200";
  const titleClass = theme === "dark" ? "text-slate-100" : "text-slate-800";
  const muted = theme === "dark" ? "text-slate-300" : "text-slate-600";
  const smallMuted = theme === "dark" ? "text-slate-400" : "text-slate-500";
  const btnPrimary = theme === "dark" ? "btn btn-primary" : "btn btn-primary";
  const btnGhost = theme === "dark" ? "btn btn-ghost text-slate-100 border-slate-600 hover:bg-slate-700/30" : "btn btn-ghost";

  // ensure data-theme present for descendant components
  useEffect(() => {
    try { document.documentElement.setAttribute("data-theme", theme); } catch (e) {}
  }, [theme]);

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [showAssigned, setShowAssigned] = useState(false); // optional toggle to view assigned jobs too

  async function load() {
    setLoading(true);
    try {
      // request the jobs list from the backend. Backend may return array or paginated { results: [...] }.
      const res = await apiFetch("/api/jobs/", { token });
      const all = Array.isArray(res) ? res : (res?.results ?? []);
      // When not showing assigned, filter for jobs without assigned_technician OR status new
      let list;
      if (showAssigned) {
        list = all;
      } else {
        list = all.filter(j => !j.assigned_technician && (j.status === "new" || j.status === null || j.status === undefined));
      }
      setJobs(list);
    } catch (e) {
      console.error("ManagerJobs.load:", e);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, showAssigned]);

  return (
    <div className={`${pageBg} p-4 min-h-[60vh]`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className={`text-xl font-semibold ${titleClass}`}>Unassigned Jobs</h2>
        <div className="flex items-center gap-3">
          <label className={`text-sm flex items-center gap-2 ${muted}`}>
            <input
              type="checkbox"
              checked={showAssigned}
              onChange={(e) => setShowAssigned(e.target.checked)}
            />
            <span className={muted}>Show assigned</span>
          </label>
          <button className={btnGhost} onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {loading && <div className={muted}>Loading…</div>}
        {!loading && jobs.length === 0 && <div className={smallMuted}>No {showAssigned ? "jobs" : "unassigned jobs"}.</div>}

        {jobs.map(job => (
          <div key={job.id} className={`${cardBg} p-3 rounded flex justify-between items-center`}>
            <div>
              <div className="font-medium" style={{ color: theme === "dark" ? "var(--text)" : undefined }}>
                {job.customer_name} <span className={`text-sm ${smallMuted}`}>#{job.id}</span>
              </div>
              <div className={`text-sm ${smallMuted}`}>{job.address}</div>
              <div className={`text-xs ${muted} mt-1`}>
                Status: <strong className={titleClass}>{job.status || "—"}</strong>
                {job.assigned_technician_summary?.username && (
                  <span className="ml-3">
                    Assigned: <strong className={titleClass}>{job.assigned_technician_summary.username}</strong>
                  </span>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              {/* Always provide a View link so you can open the job detail + audit even after assignment */}
              <Link to={`/manager/jobs/${job.id}`} className={btnGhost}>View</Link>

              {/* Only offer Assign if the job is unassigned */}
              {!job.assigned_technician && (
                <button className={btnPrimary} onClick={() => setSelectedJob(job)}>Assign</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {selectedJob && (
        <AssignModal
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onAssigned={() => { setSelectedJob(null); load(); }}
          token={token}
        />
      )}
    </div>
  );
}
