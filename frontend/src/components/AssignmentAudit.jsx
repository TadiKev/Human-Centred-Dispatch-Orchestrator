// frontend/src/components/AssignmentAudit.jsx
import React, { useEffect, useState } from "react";
import { apiFetch } from "../api/fetcher";

export default function AssignmentAudit({ jobId, token }) {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [debugRaw, setDebugRaw] = useState(null);

  useEffect(() => {
    if (!jobId) return;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch(`/api/assignments/?job_id=${jobId}`, { token });
        setDebugRaw(res);
        const arr = Array.isArray(res) ? res : (res.results ?? []);
        setAssignments(arr);
      } catch (e) {
        console.error("fetch assignments failed", e);
        setAssignments([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [jobId, token]);

  if (!jobId) return null;

  // assignments are returned newest-first by the model Meta ordering, but if not, sort by created_at desc
  const sorted = [...assignments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const latestId = sorted.length ? sorted[0].id : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-medium">Assignment audit</h4>
        <button
          className="btn btn-ghost text-xs"
          onClick={() => { console.log("audit raw:", debugRaw); alert("See console for raw audit response"); }}
        >
          Debug
        </button>
      </div>

      {loading && <div>Loading…</div>}
      {!loading && sorted.length === 0 && <div className="text-slate-500">No assignments.</div>}

      <ul className="space-y-2">
        {sorted.map(a => {
          const actor = (a.created_by && (a.created_by.username || a.created_by.email)) || (typeof a.created_by === "string" ? a.created_by : (a.created_by || "system"));
          const manualReason = a.score_breakdown && (a.score_breakdown.manual_reason || a.score_breakdown.note || a.score_breakdown.manual_note);
          const reasonText = a.reason || manualReason || "";
          const isLatest = a.id === latestId;

          return (
            <li key={a.id} className={`p-2 border rounded ${isLatest ? "bg-slate-50" : ""}`}>
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <strong>{a.technician?.user?.username || (a.technician && (a.technician.username || a.technician)) || "—"}</strong>
                  {" • "}
                  <span className="text-xs text-slate-600">{new Date(a.created_at).toLocaleString()}</span>
                  <div className="text-xs text-slate-600 mt-1">By: {actor}</div>
                </div>
                {isLatest && <div className="text-xs px-2 py-0.5 bg-indigo-600 text-white rounded">Latest</div>}
              </div>

              {reasonText && <div className="text-xs text-slate-700 mt-2">{reasonText}</div>}

              <pre className="mt-2 text-xs bg-white p-2 rounded border">{JSON.stringify(a.score_breakdown || {}, null, 2)}</pre>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
