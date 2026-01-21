// frontend/src/components/AssignModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/fetcher";
import TechnicianWorkloadPanel from "./TechnicianWorkloadPanel";

const FATIGUE_THRESHOLD = 0.8;

export default function AssignModal({
  job,
  onClose,
  onAssigned,
  token: propToken,
}) {
  const token =
    propToken ??
    (typeof window !== "undefined"
      ? localStorage.getItem("access")
      : null);

  const [candidates, setCandidates] = useState([]);
  const [workloadMap, setWorkloadMap] = useState(new Map());
  const [assigningId, setAssigningId] = useState(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* -------------------------------
     Fetch candidate recommendations
  -------------------------------- */
  useEffect(() => {
    let mounted = true;
    setLoading(true);

    (async () => {
      try {
        const res = await apiFetch(
          `/api/jobs/${job.id}/candidates/`,
          { token }
        );
        const list = Array.isArray(res)
          ? res
          : res?.candidates ?? res?.results ?? [];
        if (mounted) setCandidates(list);
      } catch (e) {
        console.error(e);
        if (mounted) setError("Failed to load candidates");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [job.id, token]);

  /* -------------------------------
     Receive workload from panel
  -------------------------------- */
  function handleWorkloadLoaded(items) {
    const map = new Map();
    items.forEach((it) => {
      if (it.technician_id != null) {
        map.set(Number(it.technician_id), it);
      }
    });
    setWorkloadMap(map);
  }

  /* -------------------------------
     Assignment
  -------------------------------- */
  async function assign(techId, candidate) {
    if (!techId) return;

    setAssigningId(techId);
    try {
      await apiFetch("/api/assignments/", {
        method: "POST",
        token,
        body: {
          job_id: job.id,
          technician_id: techId,
          reason:
            reason ||
            candidate?.explanation?.text ||
            "Manual assignment",
          score_breakdown: candidate?.score_breakdown,
        },
      });
      onAssigned?.();
      onClose?.();
    } catch (e) {
      alert("Assignment failed");
    } finally {
      setAssigningId(null);
    }
  }

  /* -------------------------------
     Helpers
  -------------------------------- */
  function backendReasons(candidate, workload) {
    const reasons = [];

    if (candidate?.explanation?.text) {
      reasons.push(candidate.explanation.text);
    }

    const sb = candidate?.score_breakdown || {};

    if (sb.skill_match)
      reasons.push(`Strong skill match (${sb.skill_match}%)`);
    if (sb.distance_minutes != null)
      reasons.push(`Shortest ETA (${sb.distance_minutes} min)`);
    if (sb.sla_risk_reduction)
      reasons.push(
        `Reduces SLA breach risk by ${sb.sla_risk_reduction}%`
      );
    if (sb.model_rank === 1)
      reasons.push("Top-ranked by assignment model");

    if (
      workload &&
      workload.fatigue_score >= FATIGUE_THRESHOLD &&
      reasons.length > 0
    ) {
      reasons.unshift(
        "⚠ Recommended despite fatigue due to operational impact"
      );
    }

    return reasons;
  }

  /* -------------------------------
     Render
  -------------------------------- */
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-center items-center p-6">
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b dark:border-slate-700 flex justify-between">
          <div>
            <h3 className="text-lg font-semibold">
              Assign Job #{job.id}
            </h3>
            <div className="text-sm text-slate-500">
              {job.customer_name} — {job.address}
            </div>
          </div>
          <button onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Reason */}
          <div>
            <label className="text-sm block mb-1">
              Assignment reason (optional)
            </label>
            <textarea
              className="w-full p-2 rounded border dark:bg-slate-800"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {/* AUTHORITATIVE WORKLOAD */}
          <TechnicianWorkloadPanel
            apiBase="/api"
            jobId={job.id}
            onLoaded={handleWorkloadLoaded}
          />

          {/* Candidate overlay */}
          <div>
            <h4 className="font-semibold mb-2">
              Backend recommendations
            </h4>

            {loading ? (
              <div className="text-sm text-slate-500">
                Loading…
              </div>
            ) : (
              <div className="space-y-3">
                {candidates.map((c) => {
                  const techId =
                    c.technician_id ?? c.technician?.id;
                  const workload = workloadMap.get(Number(techId));
                  const fatigue = workload?.fatigue_score ?? 0;
                  const blocked =
                    fatigue >= FATIGUE_THRESHOLD;

                  const reasons = backendReasons(
                    c,
                    workload
                  );

                  const technicianName =
                    c.technician_summary?.username ??
                    c.technician?.user?.username ??
                    `Tech ${techId}`;

                  return (
                    <div
                      key={techId}
                      className={`p-3 border rounded-lg dark:border-slate-700 ${
                        blocked
                          ? "bg-rose-50 dark:bg-rose-900/20"
                          : "bg-slate-50 dark:bg-slate-800"
                      }`}
                    >
                      <div className="flex justify-between">
                        <div>
                          <div className="font-medium">
                            {technicianName}
                          </div>
                          <div className="text-xs text-slate-500">
                            Fatigue:{" "}
                            {Math.round(fatigue * 100)}%
                          </div>
                        </div>

                        <button
                          disabled={blocked || assigningId}
                          onClick={() =>
                            assign(techId, c)
                          }
                          className={`px-3 py-1 rounded text-sm ${
                            blocked
                              ? "bg-slate-300 dark:bg-slate-700 cursor-not-allowed"
                              : "bg-indigo-600 text-white"
                          }`}
                        >
                          {blocked
                            ? "Blocked"
                            : assigningId === techId
                            ? "Assigning…"
                            : "Assign"}
                        </button>
                      </div>

                      {/* Why recommended */}
                      {reasons.length > 0 && (
                        <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                          <div className="font-semibold mb-1">
                            Why backend recommended this tech
                          </div>
                          <ul className="list-disc pl-4 space-y-0.5">
                            {reasons.map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Contradiction flag */}
                      {blocked && reasons.length > 0 && (
                        <div className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                          ⚠ Model recommendation conflicts with
                          fatigue policy
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t dark:border-slate-700 flex justify-end">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
