// frontend/src/components/AssignModal.jsx
import React, { useEffect, useState } from "react";
import { apiFetch } from "../api/fetcher";

export default function AssignModal({ job, onClose, onAssigned, token }) {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [assigningId, setAssigningId] = useState(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // call backend candidates endpoint (note the /api/ prefix)
        const res = await apiFetch(`/api/jobs/${job.id}/candidates/`, { token });
        // backend returns { job_id, candidates: [...] } — support that and other shapes
        const list = res?.candidates ?? (Array.isArray(res) ? res : (res.results ?? []));
        setCandidates(list);
      } catch (e) {
        console.error("fetch candidates failed", e);
        setCandidates([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [job.id, token]);

  async function assign(tech) {
    // guard: tech may have technician_id or id depending on server shape
    const techId = tech.technician_id ?? tech.technician_id ?? tech.id ?? tech.technician;
    setAssigningId(techId);
    try {
      // Compose a robust score_breakdown, and add manual_reason when manager typed one.
      const baseScore = tech.score_breakdown ?? { score: tech.score ?? null, note: tech.explanation?.text ?? "" };
      const scoreWithManual = { ...baseScore };

      const trimmedReason = (reason || "").toString().trim();
      if (trimmedReason) {
        scoreWithManual.manual_reason = trimmedReason;
        scoreWithManual.manual_flag = true;
      }

      const payload = {
        job_id: job.id,
        technician_id: techId,
        reason: trimmedReason ? trimmedReason : `Assigned by ${tech.username || tech.user?.username}: ${tech.explanation?.text || ""}`,
        score_breakdown: scoreWithManual
      };

      await apiFetch("/api/assignments/", { method: "POST", body: payload, token });
      // inform parent to reload lists etc.
      onAssigned();
    } catch (e) {
      console.error("assignment failed", e);
      alert("Assignment failed: " + (e.message || e));
    } finally {
      setAssigningId(null);
    }
  }

  return (
    <div className="fixed inset-0 flex items-start justify-center p-6 z-50">
      <div className="bg-white shadow-lg rounded-lg w-full max-w-3xl p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Assign Job #{job.id}</h3>
          <button className="text-slate-500" onClick={onClose}>✕</button>
        </div>

        <div className="mb-4">
          <div className="font-medium">{job.customer_name}</div>
          <div className="text-sm text-slate-600">{job.address}</div>
        </div>

        <div className="mb-3">
          <label className="text-sm">Reason/notes (optional)</label>
          <textarea
            className="form-textarea mt-1 w-full"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Type reason (optional), leave empty to use candidate explanation"
          />
        </div>

        <div>
          <div className="text-sm font-medium mb-2">Candidate technicians</div>
          {loading && <div>Loading candidates…</div>}
          {!loading && candidates.length === 0 && <div className="text-slate-500">No candidate technicians found.</div>}
          <div className="space-y-3">
            {candidates.map(c => {
              const techKey = c.technician_id ?? c.id ?? c.user?.id ?? c.username;
              return (
                <div key={techKey} className="p-3 border rounded flex justify-between items-center">
                  <div>
                    <div className="font-medium">
                      {c.username ?? c.user?.username}{" "}
                      <span className="text-sm text-slate-500">({c.status})</span>
                    </div>
                    <div className="text-sm text-slate-500">Score: {c.score}</div>
                    <div className="text-xs text-slate-600 mt-1">{c.explanation?.text}</div>
                    <div className="mt-2">
                      {c.skills && c.skills.map(s => <span key={s.id} className="badge mr-1">{s.name}</span>)}
                    </div>
                  </div>
                  <div>
                    <button
                      className="btn btn-primary"
                      onClick={() => assign(c)}
                      disabled={assigningId !== null}
                    >
                      {assigningId === techKey ? "Assigning…" : "Assign"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button className="btn btn-ghost mr-2" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
