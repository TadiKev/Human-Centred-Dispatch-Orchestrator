// frontend/src/components/PredictionCard.jsx
import React, { useEffect, useState } from "react";
import { apiFetch } from "../api/fetcher";
import { useAuth } from "../auth/AuthProvider";

/**
 * PredictionCard
 * - jobId: id of the job to predict for
 * - compact: if true use smaller text
 *
 * Calls both:
 *  - POST /api/ml/predict/duration/   (body: { job_id })
 *  - POST /api/ml/predict/noshow/     (body: { job_id })
 *
 * Normalizes several response shapes and displays:
 *  - predicted duration (minutes)
 *  - optional duration std
 *  - no-show probability
 *  - ML/Baseline/fallback badges
 *  - model_version (if provided by duration response)
 */
export default function PredictionCard({ jobId, compact = false }) {
  const { auth } = useAuth();
  const token = auth?.access ?? null;

  const [pred, setPred] = useState(null);    // { duration: {...}, noshow: {...} } or null
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState(null);

  useEffect(() => {
    if (!jobId || !token) {
      setPred(null);
      setErrMsg(null);
      return;
    }

    let mounted = true;
    setLoading(true);
    setErrMsg(null);

    (async () => {
      try {
        const durationPath = "/api/ml/predict/duration/";
        const noshowPath = "/api/ml/predict/noshow/";

        // Fire both requests in parallel; apiFetch should return parsed JSON
        const [durResRaw, noshowResRaw] = await Promise.all([
          apiFetch(durationPath, { method: "POST", body: { job_id: jobId }, token }).catch(e => ({ __err: e })),
          apiFetch(noshowPath,  { method: "POST", body: { job_id: jobId }, token }).catch(e => ({ __err: e }))
        ]);

        if (!mounted) return;

        const unwrap = (r) => (r && r.__err) ? { __err: r.__err } : r;

        const durRes = unwrap(durResRaw);
        const noshowRes = unwrap(noshowResRaw);

        if (durRes && durRes.__err) {
          console.warn("duration fetch error", durRes.__err);
        }
        if (noshowRes && noshowRes.__err) {
          console.warn("noshow fetch error", noshowRes.__err);
        }

        // Normalize duration result into { minutes, std, used_ml, fallback, model_version } or null
        const normDuration = (() => {
          const r = durRes;
          if (!r || r.__err) return null;

          // shape: { predicted_duration: [val], duration_minutes_std?, probabilities?, used_ml, fallback, model_version }
          if (Array.isArray(r.predicted_duration) && r.predicted_duration.length > 0) {
            return {
              minutes: Number(r.predicted_duration[0]),
              std: r.duration_minutes_std ?? null,
              used_ml: !!r.used_ml,
              fallback: !!r.fallback,
              model_version: r.model_version ?? r.model ?? null
            };
          }

          // nested shapes: { prediction: { duration_minutes_pred, duration_minutes_std } }
          if (r.prediction) {
            const nested = r.prediction;
            if (nested.duration_minutes_pred != null) {
              return {
                minutes: Number(nested.duration_minutes_pred),
                std: nested.duration_minutes_std ?? null,
                used_ml: !!r.used_ml,
                fallback: !!r.fallback,
                model_version: r.model_version ?? nested.model_version ?? null
              };
            }
            if (Array.isArray(nested.predicted_duration) && nested.predicted_duration.length > 0) {
              return {
                minutes: Number(nested.predicted_duration[0]),
                std: nested.duration_minutes_std ?? null,
                used_ml: !!r.used_ml,
                fallback: !!r.fallback,
                model_version: r.model_version ?? nested.model_version ?? null
              };
            }
          }

          // legacy: { predicted: number }
          if (r.predicted != null) {
            return {
              minutes: Number(r.predicted),
              std: r.duration_minutes_std ?? null,
              used_ml: !!r.used_ml,
              fallback: !!r.fallback,
              model_version: r.model_version ?? null
            };
          }

          return null;
        })();

        // Normalize no-show result into { prob, cls, used_ml, fallback } or null
        const normNoShow = (() => {
          const r = noshowRes;
          if (!r || r.__err) return null;

          let prob = null;
          // { probabilities: [p] } (microservice style)
          if (Array.isArray(r.probabilities) && r.probabilities.length > 0) {
            prob = Number(r.probabilities[0]);
          }
          // nested: r.prediction.no_show_prob
          else if (r.prediction && r.prediction.no_show_prob != null) {
            prob = Number(r.prediction.no_show_prob);
          }
          // legacy: r.prob_no_show
          else if (r.prob_no_show != null) {
            prob = Number(r.prob_no_show);
          }

          // predicted class in predictions array
          let cls = null;
          if (Array.isArray(r.predictions) && r.predictions.length > 0) cls = Number(r.predictions[0]);
          else if (r.prediction && r.prediction.predicted != null) cls = Number(r.prediction.predicted);

          return {
            prob: prob,
            cls: cls,
            used_ml: !!r.used_ml,
            fallback: !!r.fallback
          };
        })();

        if (!normDuration && !normNoShow) {
          setErrMsg("No prediction data returned");
          setPred(null);
        } else {
          setPred({ duration: normDuration, noshow: normNoShow });
        }
      } catch (e) {
        console.warn("prediction fetch failed", e);
        if (!mounted) return;
        const m = e?.message || (e?.__err && e.__err.message) || "Prediction call failed";
        setErrMsg(m);
        setPred(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [jobId, token]);

  // don't render if no auth available (your app hides card when not logged in)
  if (!token) return null;

  const baseCardClass = `p-3 rounded shadow-sm ${compact ? "text-sm" : "text-base"} bg-white text-slate-900 border border-gray-200`;

  // Loading skeleton shimmer (Tailwind animate-pulse)
  if (loading) {
    return (
      <div className={baseCardClass} data-testid="prediction-card-loading">
        <div className="flex items-center justify-between gap-3">
          <div className="w-2/3">
            <div className="h-4 w-32 bg-slate-200 rounded animate-pulse" />
            <div className="mt-2 h-6 w-40 bg-slate-200 rounded animate-pulse" />
          </div>
          <div className="w-1/3 flex flex-col items-end">
            <div className="h-6 w-16 bg-slate-200 rounded animate-pulse" />
            <div className="mt-2 h-4 w-24 bg-slate-200 rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (errMsg) {
    return (
      <div className={baseCardClass} data-testid="prediction-card-error">
        <div className="text-sm text-rose-600">Prediction error: {errMsg}</div>
      </div>
    );
  }

  if (!pred) {
    return (
      <div className={baseCardClass} data-testid="prediction-card-empty">
        <div className="text-sm text-slate-400">No predictions</div>
      </div>
    );
  }

  // combine used_ml/fallback flags (either endpoint could be baseline/fallback)
  const usedMlFlag = (pred.duration?.used_ml || pred.noshow?.used_ml) ?? false;
  const fallbackFlag = (pred.duration?.fallback || pred.noshow?.fallback) ?? false;

  const durMinutes = pred.duration?.minutes;
  const durStd = pred.duration?.std;
  const modelVersion = pred.duration?.model_version ?? null;
  const noShowProb = pred.noshow?.prob;

  const formattedDuration = durMinutes == null ? "—" : Math.round(durMinutes).toString();
  const formattedStd = durStd != null ? `±${Math.round(durStd)}` : null;
  const formattedNoShow = noShowProb != null ? Number(noShowProb).toFixed(2) : "0.00";

  return (
    <div className={baseCardClass} data-testid="prediction-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-800">Pred. duration</div>
          <div className="text-slate-600 mt-1">
            <span className="text-lg font-medium">{formattedDuration}</span>
            <span className="ml-1 text-sm">min</span>
            {formattedStd ? <span className="ml-2 text-xs text-slate-500">{formattedStd}</span> : null}
          </div>
          {/* model_version (if provided) */}
          {modelVersion ? (
            <div className="text-xs text-slate-500 mt-1">model: <span className="font-mono text-xs">{modelVersion}</span></div>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${usedMlFlag ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>
              {usedMlFlag ? "ML" : "Baseline"}
            </span>
            {fallbackFlag ? (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-rose-100 text-rose-800">fallback</span>
            ) : null}
          </div>

          <div className="text-xs text-slate-600 mt-1">
            No-show: <span className="ml-1 font-medium">{formattedNoShow}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
