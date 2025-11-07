// frontend/src/components/PredictionCard.jsx
import React, { useEffect, useState } from "react";
import { apiFetch } from "../api/fetcher";
import { useAuth } from "../auth/AuthProvider";

export default function PredictionCard({ jobId, compact = false }) {
  const { auth } = useAuth();
  const token = auth?.access ?? null;

  const [pred, setPred] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!jobId || !token) return;
    let mounted = true;
    setLoading(true);
    apiFetch(`/api/predict/duration/`, { method: "POST", body: { job_id: jobId }, token })
      .then((res) => {
        if (!mounted) return;
        setPred(res.prediction || res);
      })
      .catch((e) => {
        console.warn("predict fetch failed", e);3
        setPred(null);
      })
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [jobId, token]);

  if (!token) return null;
  if (loading) return <div className="text-sm text-slate-500">Loading predictions…</div>;
  if (!pred) return <div className="text-sm text-slate-400">No predictions</div>;

  const { duration_minutes_pred, duration_minutes_std, no_show_prob } = pred;
  return (
    <div className={`p-2 rounded border ${compact ? "text-sm" : "text-base"}`}>
      <div>
        <strong>Pred. duration:</strong> {duration_minutes_pred} min {duration_minutes_std ? (<span className="text-xs text-slate-500">±{duration_minutes_std}</span>) : null}
      </div>
      <div className="text-sm text-slate-600">
        <strong>No-show:</strong> {(pred.no_show_prob ?? no_show_prob ?? 0).toFixed(2)}
      </div>
    </div>
  );
}
