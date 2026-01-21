// src/components/AssignmentAudit.jsx
import React, { useEffect, useState } from "react";
import { apiFetch } from "../api/fetcher";

export default function AssignmentAudit({ jobId, token }) {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [debugRaw, setDebugRaw] = useState(null);
  const [openDetailsFor, setOpenDetailsFor] = useState(null);

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

  const sorted = [...assignments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const latestId = sorted.length ? sorted[0].id : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-medium">Assignment audit</h4>
        <div className="flex gap-2">
          <button
            className="btn btn-ghost text-xs"
            onClick={() => { console.log("audit raw:", debugRaw); alert("See console for raw audit response"); }}
          >
            Debug
          </button>
        </div>
      </div>

      {loading && <div>Loading…</div>}
      {!loading && sorted.length === 0 && <div className="text-slate-500">No assignments.</div>}

      <ul className="space-y-3">
        {sorted.map(a => {
          const actor = (a.created_by && (a.created_by.username || a.created_by.email)) || (typeof a.created_by === "string" ? a.created_by : (a.created_by || "system"));
          const techName = a?.technician?.username ?? (a?.technician?.user && a.technician.user.username) ?? (typeof a?.technician === "string" ? a.technician : "—");

          // Use backend-provided explanation fields (they are now richer)
          const explanation_text = a.explanation_text || null;
          const explanation_bullets = Array.isArray(a.explanation_bullets) ? a.explanation_bullets : null;
          const confidence = (typeof a.explanation_confidence === "number") ? a.explanation_confidence : null;
          const alternatives = Array.isArray(a.explanation_alternatives) ? a.explanation_alternatives : null;

          // Ensure we show text only once: if bullets first item equals text, hide duplicate bullet
          const bulletsToShow = explanation_bullets ? explanation_bullets.slice() : null;
          if (bulletsToShow && explanation_text && bulletsToShow.length && bulletsToShow[0].trim() === explanation_text.trim()) {
            bulletsToShow.shift();
          }

          const isLatest = a.id === latestId;
          const showDetails = openDetailsFor === a.id;

          return (
            <li key={a.id} className={`p-3 border rounded ${isLatest ? "bg-slate-50" : ""}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <strong className="truncate">{techName}</strong>
                    <span className="text-xs text-slate-600">• {new Date(a.created_at).toLocaleString()}</span>
                    {isLatest && <span className="text-xs px-2 py-0.5 bg-indigo-600 text-white rounded">Latest</span>}
                  </div>
                  <div className="text-xs text-slate-600 mt-1">By: {actor}</div>

                  {explanation_text ? (
                    <div className="text-sm text-slate-800 mt-2">{explanation_text}</div>
                  ) : (
                    <div className="text-sm text-slate-600 mt-2 italic">No explanation provided</div>
                  )}

                  {bulletsToShow && bulletsToShow.length > 0 && (
                    <ul className="text-xs list-disc ml-4 mt-2 text-slate-700">
                      {bulletsToShow.map((b, i) => <li key={i}>{b}</li>)}
                    </ul>
                  )}

                  {confidence !== null && (
                    <div className="text-xs mt-2 text-slate-600">Confidence: {Math.round(confidence * 100)}%</div>
                  )}

                  {alternatives && alternatives.length > 0 && (
                    <div className="text-xs mt-2 text-slate-600">
                      Alternatives: {alternatives.map((alt, idx) => `${alt.username || alt.technician_id}${alt.score ? ` (${Math.round(alt.score*100)/100})` : ""}`).join(", ")}
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end gap-2">
                  <button
                    className="btn btn-ghost btn-sm text-xs"
                    onClick={() => setOpenDetailsFor(showDetails ? null : a.id)}
                  >
                    {showDetails ? "Hide details" : "Show details"}
                  </button>
                </div>
              </div>

              {showDetails && (
                <div className="mt-3 text-xs bg-white p-3 rounded border overflow-auto">
                  <div className="mb-2 font-medium">Raw audit (for debugging)</div>
                  <pre className="whitespace-pre-wrap text-[11px]">{JSON.stringify(a, null, 2)}</pre>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
