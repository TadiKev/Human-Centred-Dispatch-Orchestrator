import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../api/fetcher";
import AssignmentAudit from "../components/AssignmentAudit";
import AssignModal from "../components/AssignModal";
import AutoAssignButton from "../components/AutoAssignButton";
import TechnicianWorkloadPanel from "../components/TechnicianWorkloadPanel";
import { useAuth } from "../auth/AuthProvider";
import PredictionCard from "../components/PredictionCard";
import { useTheme } from "../theme/ThemeProvider";

export default function ManagerJobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { auth } = useAuth();
  const token = auth?.access ?? null;

  const { theme } = useTheme();

  // theme-aware classes
  const pageBg = theme === "dark" ? "bg-slate-900 text-slate-100" : "bg-slate-50 text-slate-900";
  const cardClass = theme === "dark" ? "bg-slate-800 text-slate-100 border border-slate-700" : "bg-white text-slate-900 border border-gray-200";
  const titleClass = theme === "dark" ? "text-slate-100" : "text-slate-800";
  const muted = theme === "dark" ? "text-slate-300" : "text-slate-600";
  const smallMuted = theme === "dark" ? "text-slate-400" : "text-slate-500";
  const linkColor = theme === "dark" ? "text-indigo-300" : "text-indigo-600";
  const btnPrimary = "btn btn-primary";
  const btnGhost = theme === "dark"
    ? "btn btn-ghost text-slate-100 border-slate-600 hover:bg-slate-700/30"
    : "btn btn-ghost";

  // persist theme on document
  useEffect(() => {
    try {
      document.documentElement.setAttribute("data-theme", theme);
    } catch (e) {}
  }, [theme]);

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [autoAssignLoading, setAutoAssignLoading] = useState(false);

  async function fetchJob() {
    if (!token) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/jobs/${id}/`, { token });
      setJob(res);
    } catch (e) {
      console.error("failed loading job", e);
      if (e.status === 404) {
        navigate("/manager/jobs", { replace: true });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchJob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  if (!token) return <div className={`${pageBg} p-6`}>You must be signed in to view this page.</div>;
  if (loading) return <div className={`${pageBg} p-6`}>Loading job…</div>;
  if (!job) return <div className={`${pageBg} p-6`}>No job found.</div>;

  // Robust technician name resolution — handles different backend shapes:
  // - job.assigned_technician_summary?.username  (preferred)
  // - job.assigned_technician_detail?.user?.username
  // - typeof job.assigned_technician === 'string' ? job.assigned_technician
  const assignedName =
    job?.assigned_technician_summary?.username ??
    job?.assigned_technician_detail?.user?.username ??
    (typeof job?.assigned_technician === "string" ? job.assigned_technician : null);

  const isAssigned = Boolean(assignedName);

  return (
    <div className={`${pageBg} p-4 min-h-[60vh]`}>
      <div className="mb-4">
        <Link to="/manager/jobs" className={`text-sm ${linkColor} hover:underline`}>
          ← Back to jobs
        </Link>
      </div>

      <div className={`${cardClass} p-4 rounded`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className={`text-lg font-semibold ${titleClass}`}>Job #{job.id}</h2>
            <div className={`text-sm ${muted}`}>{job.customer_name}</div>
            <div className={`text-sm ${smallMuted}`}>{job.address}</div>
            <div className={`mt-2 text-xs ${muted}`}>
              Status: <strong className={titleClass}>{job.status}</strong>
              {assignedName && (
                <span className="ml-3">
                  Assigned technician:{" "}
                  <strong className={titleClass}>
                    {assignedName}
                  </strong>
                </span>
              )}
            </div>
          </div>

          <div>
            <PredictionCard jobId={job.id} compact token={token} />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          {!isAssigned ? (
            <>
              <button className={btnPrimary} onClick={() => setShowAssignModal(true)}>
                Assign
              </button>
              <AutoAssignButton
                jobId={job.id}
                onAssigned={async () => {
                  setAutoAssignLoading(true);
                  try {
                    await fetchJob();
                  } finally {
                    setAutoAssignLoading(false);
                  }
                }}
              />
            </>
          ) : (
            <div className={`text-sm ${muted}`}>
              Job is assigned — use the audit panel to view history.
            </div>
          )}
        </div>
      </div>

      {/* Technician workload / fatigue panel */}
      <div className="mt-4">
        <TechnicianWorkloadPanel apiBase="/api" jobId={job.id} />
      </div>

      <div className="mt-4">
        <AssignmentAudit jobId={job.id} token={token} />
      </div>

      {showAssignModal && (
        <AssignModal
          job={job}
          token={token}
          onClose={() => setShowAssignModal(false)}
          onAssigned={() => {
            setShowAssignModal(false);
            (async () => {
              try {
                const refreshed = await apiFetch(`/api/jobs/${id}/`, { token });
                setJob(refreshed);
              } catch (e) {
                console.error("refresh after assign failed", e);
              }
            })();
          }}
        />
      )}
    </div>
  );
}
