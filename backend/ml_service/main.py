#!/usr/bin/env python3
"""
ml_service main (FastAPI)

Production-serving features:
 - Redis cache for identical payloads
 - A/B rollout via ML_ROLLOUT_PCT (0-100)
 - safety fallback to rule-based heuristic if ML fails or rollout chooses baseline
 - prediction event JSONL logging for monitoring/drift checks
 - returns model_version and fallback flag on every response
 - defensive numeric coercion and multiple pipeline-predict recovery attempts to avoid "could not convert string to float" errors
"""
from pathlib import Path
import os
import json
import logging
import joblib
import time
import random
from typing import Any, List, Optional, Tuple

import numpy as np
import pandas as pd
from fastapi import FastAPI, Body, HTTPException, Header, Request
from fastapi.responses import JSONResponse

# Optional Redis (for caching). If not available, code will work without it.
try:
    import redis
except Exception:
    redis = None  # type: ignore

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOG = logging.getLogger("ml_service")

APP = FastAPI(title="hof-smart ml_service")

# Config (override via env)
MODEL_DIR = Path(os.environ.get("ML_MODELS_DIR", "/app/ml/models"))
FEATURES_FILE = MODEL_DIR / "feature_columns.json"
PROD_DIR = MODEL_DIR / "production"
PROD_PTR = PROD_DIR / "current_model.txt"
PREDICTIONS_LOG = Path(os.environ.get("PREDICTIONS_LOG_PATH", "/app/ml/predictions.jsonl"))
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
CACHE_TTL_SECONDS = int(os.environ.get("ML_CACHE_TTL_SECONDS", str(60 * 60 * 24)))
ML_ROLLOUT_PCT = float(os.environ.get("ML_ROLLOUT_PCT", os.environ.get("ROLLOUT_PCT", "100")))
ROLLOUT_STICKY_KEY = os.environ.get("ROLLOUT_STICKY_KEY", "")

DISABLE_FALLBACK = os.environ.get("DISABLE_FALLBACK", "false").lower() in ("1", "true", "yes")

# Model objects
LOADED_PIPELINE_DURATION = None
LOADED_PIPELINE_NOSHOW = None
MODEL_DURATION = None
MODEL_NOSHOW = None
PREPROCESSOR_DURATION = None
PREPROCESSOR_NOSHOW = None
DURATION_MODEL_PATH: Optional[Path] = None
NOSHOW_MODEL_PATH: Optional[Path] = None
FEATURES: List[str] = []

# Redis client (optional)
redis_client = None
if redis is not None:
    try:
        redis_client = redis.from_url(REDIS_URL, decode_responses=True)
        LOG.info("Redis client configured: %s", REDIS_URL)
    except Exception as e:
        LOG.warning("Redis client init failed: %s", e)
        redis_client = None

# -------------------
# Utilities / loading
# -------------------
def load_json_file(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None

def _write_jsonl_line(path: Path, obj: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(obj, default=str) + "\n")
    except Exception as e:
        LOG.warning("Failed to append to predictions log %s: %s", path, e)

def _canonical_payload_key(obj: Any) -> str:
    try:
        return json.dumps(obj, sort_keys=True, default=str, separators=(",", ":"))
    except Exception:
        return str(obj)

def load_features():
    global FEATURES
    FEATURES = []
    try:
        if FEATURES_FILE.exists():
            LOG.info("Reading feature file %s", FEATURES_FILE)
            data = json.loads(FEATURES_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list):
                FEATURES = [str(x) for x in data]
            elif isinstance(data, dict):
                for key in ("features", "feature_columns", "columns", "feature_names"):
                    if key in data and isinstance(data[key], list):
                        FEATURES = [str(x) for x in data[key]]
                        break
            LOG.info("Loaded %d features from feature_columns.json", len(FEATURES))
        else:
            LOG.info("feature_columns.json not found at %s", FEATURES_FILE)
    except Exception as e:
        LOG.exception("Failed to read feature_columns.json: %s", e)
        FEATURES = []

def candidate_paths_for_prod() -> List[Path]:
    c: List[Path] = []
    try:
        if PROD_PTR.exists():
            cur = PROD_PTR.read_text(encoding="utf-8").strip()
            if cur:
                candidate = PROD_DIR / cur
                if candidate.exists():
                    c.append(candidate)
    except Exception:
        pass
    defaults = [
        "model_full_pipeline_duration_v1.joblib",
        "model_full_pipeline_noshow_v1.joblib",
        "model_full_pipeline_v1.joblib",
    ]
    for fn in defaults:
        p = PROD_DIR / fn
        if p.exists() and p not in c:
            c.append(p)
    try:
        if PROD_DIR.exists():
            for fn in sorted(os.listdir(PROD_DIR)):
                p = Path(fn)
                full = PROD_DIR / p.name
                if full.suffix.lower() in (".joblib", ".pkl") and full not in c:
                    c.append(full)
    except Exception:
        pass
    LOG.info("Production model candidate list: %s", c)
    return c

def try_joblib_load(p: Path):
    try:
        LOG.info("joblib.load -> %s", p)
        loaded = joblib.load(str(p))
        LOG.info("Loaded %s (type=%s)", p, type(loaded))
        return loaded
    except Exception as e:
        LOG.warning("joblib.load failed for %s: %s", p, e)
        return None

def extract_model_and_preprocessor(loaded) -> Tuple[Optional[Any], Optional[Any]]:
    try:
        if hasattr(loaded, "predict") and (hasattr(loaded, "named_steps") or hasattr(loaded, "steps")):
            ns = getattr(loaded, "named_steps", {}) or dict(getattr(loaded, "steps", []))
            model_candidate = None
            preproc_candidate = None
            for name, comp in ns.items():
                if model_candidate is None and hasattr(comp, "predict"):
                    model_candidate = comp
                if preproc_candidate is None and hasattr(comp, "transform"):
                    preproc_candidate = comp
            return model_candidate or loaded, preproc_candidate
    except Exception:
        pass

    if isinstance(loaded, dict):
        m = None; p = None
        for v in loaded.values():
            if m is None and hasattr(v, "predict"):
                m = v
            if p is None and hasattr(v, "transform"):
                p = v
        return m, p

    if isinstance(loaded, (list, tuple)):
        m = None; p = None
        for it in loaded:
            if m is None and hasattr(it, "predict"):
                m = it
            if p is None and hasattr(it, "transform"):
                p = it
        return m, p

    if hasattr(loaded, "predict"):
        return loaded, None

    return None, None

def discover_and_load_prod():
    global LOADED_PIPELINE_DURATION, LOADED_PIPELINE_NOSHOW
    global MODEL_DURATION, MODEL_NOSHOW, PREPROCESSOR_DURATION, PREPROCESSOR_NOSHOW
    global DURATION_MODEL_PATH, NOSHOW_MODEL_PATH

    LOADED_PIPELINE_DURATION = None
    LOADED_PIPELINE_NOSHOW = None
    MODEL_DURATION = MODEL_NOSHOW = PREPROCESSOR_DURATION = PREPROCESSOR_NOSHOW = None
    DURATION_MODEL_PATH = NOSHOW_MODEL_PATH = None

    for p in candidate_paths_for_prod():
        loaded = try_joblib_load(p)
        if loaded is None:
            continue
        name = p.name.lower()
        m, pr = extract_model_and_preprocessor(loaded)
        if "duration" in name:
            LOADED_PIPELINE_DURATION = loaded if hasattr(loaded, "predict") else None
            MODEL_DURATION = m or (loaded if hasattr(loaded, "predict") else None)
            PREPROCESSOR_DURATION = pr
            DURATION_MODEL_PATH = p
            LOG.info("Loaded duration pipeline from production: %s", p)
            continue
        if "noshow" in name or "no_show" in name or "no-show" in name:
            LOADED_PIPELINE_NOSHOW = loaded if hasattr(loaded, "predict") else None
            MODEL_NOSHOW = m or (loaded if hasattr(loaded, "predict") else None)
            PREPROCESSOR_NOSHOW = pr
            NOSHOW_MODEL_PATH = p
            LOG.info("Loaded noshow pipeline from production: %s", p)
            continue
        if LOADED_PIPELINE_DURATION is None and LOADED_PIPELINE_NOSHOW is None and hasattr(loaded, "predict"):
            LOADED_PIPELINE_DURATION = LOADED_PIPELINE_NOSHOW = loaded
            MODEL_DURATION = MODEL_NOSHOW = m or loaded
            PREPROCESSOR_DURATION = PREPROCESSOR_NOSHOW = pr
            DURATION_MODEL_PATH = NOSHOW_MODEL_PATH = p
            LOG.info("Loaded single pipeline for both tasks from production: %s", p)

# ---------------------------
# Input preparation utilities
# ---------------------------
def scalarize_list_cells(df: pd.DataFrame) -> pd.DataFrame:
    def scalarize(v):
        if isinstance(v, (list, tuple, set)):
            try:
                return ",".join(map(str, v))
            except Exception:
                return str(v)
        return v
    for c in df.columns:
        try:
            df[c] = df[c].apply(scalarize)
        except Exception:
            try:
                df[c] = df[c].map(lambda v: scalarize(v) if not pd.isna(v) else v)
            except Exception:
                pass
    return df

def add_missing_and_reindex(df: pd.DataFrame, required: List[str]) -> pd.DataFrame:
    missing = [c for c in required if c not in df.columns]
    if missing:
        LOG.info("Adding %d missing features: %s", len(missing), missing[:20])
        for c in missing:
            df[c] = np.nan
    df = df.reindex(columns=required, fill_value=np.nan)
    return df

def coerce_numeric_cols(df: pd.DataFrame, preproc=None) -> pd.DataFrame:
    numeric_candidates = set()
    try:
        procs = []
        if preproc is not None:
            if hasattr(preproc, "transformers"):
                procs.append(preproc)
            elif hasattr(preproc, "named_steps"):
                for comp in getattr(preproc, "named_steps", {}).values():
                    if hasattr(comp, "transformers"):
                        procs.append(comp)
        for proc in procs:
            for name, transformer, cols in getattr(proc, "transformers", []):
                try:
                    if cols is None:
                        continue
                    if isinstance(cols, (list, tuple, set)):
                        for col in cols:
                            if isinstance(col, str):
                                numeric_candidates.add(col)
                            elif isinstance(col, int):
                                try:
                                    col_idx = int(col)
                                    if col_idx >= 0 and col_idx < len(df.columns):
                                        numeric_candidates.add(df.columns[col_idx])
                                except Exception:
                                    pass
                    elif isinstance(cols, str):
                        numeric_candidates.add(cols)
                    else:
                        try:
                            for col in list(cols):
                                if isinstance(col, str):
                                    numeric_candidates.add(col)
                                elif isinstance(col, int):
                                    try:
                                        col_idx = int(col)
                                        if col_idx >= 0 and col_idx < len(df.columns):
                                            numeric_candidates.add(df.columns[col_idx])
                                    except Exception:
                                        pass
                        except Exception:
                            pass
                except Exception:
                    continue
    except Exception:
        pass

    if not numeric_candidates:
        for c in df.columns:
            try:
                coerced = pd.to_numeric(df[c], errors="coerce")
                if coerced.notna().any() or pd.api.types.is_numeric_dtype(df[c]):
                    numeric_candidates.add(c)
            except Exception:
                continue

    for c in list(numeric_candidates):
        if c in df.columns:
            try:
                df[c] = pd.to_numeric(df[c], errors="coerce")
            except Exception:
                pass

    return df

def prepare_input_df(payload: Any, required: Optional[List[str]] = None, preproc=None) -> pd.DataFrame:
    """
    Convert incoming JSON payload into a clean DataFrame for predictions.
    - Accepts dict or list of dicts
    - scalarizes list cells
    - adds missing features if authoritative feature list provided
    - coerces numeric columns based on preproc / pipeline hints or heuristic
    - robust mapping for small categorical fields (time_of_day, weekday)
    """
    if isinstance(payload, dict):
        df = pd.DataFrame([payload])
    elif isinstance(payload, list):
        df = pd.DataFrame(payload)
    else:
        df = pd.DataFrame([payload])

    df = scalarize_list_cells(df)
    df.replace("", np.nan, inplace=True)

    # --- Start: defensive categorical -> numeric mapping ---
    try:
        # conservative canonical maps
        time_map = {"morning": 0, "afternoon": 1, "evening": 2, "night": 3}
        weekday_map = {
            "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
            "friday": 4, "saturday": 5, "sunday": 6
        }

        for col, cmap in (("time_of_day", time_map), ("weekday", weekday_map)):
            if col in df.columns:
                s = df[col]
                s_str = s.astype(str).where(s.notna(), None)
                try:
                    numeric_vals = pd.to_numeric(s_str, errors="coerce")
                except Exception:
                    numeric_vals = pd.Series([np.nan] * len(s_str), index=s_str.index)
                out = pd.Series([np.nan] * len(s_str), index=s_str.index, dtype=float)
                mask_num = numeric_vals.notna()
                out[mask_num] = numeric_vals[mask_num]
                rem_idx = ~mask_num
                if rem_idx.any():
                    s_rem = s_str[rem_idx].astype(str).str.strip().str.lower()
                    mapped = s_rem.map(cmap)
                    mapped_filled = mapped.fillna(-1)
                    out.loc[rem_idx] = mapped_filled.values
                df[col] = out
                LOG.info(
                    "Applied categorical->numeric mapping for column %s; numeric_count=%d mapped_count=%d",
                    col,
                    int(mask_num.sum()),
                    int(rem_idx.sum()),
                )
    except Exception:
        LOG.debug("categorical mapping step failed; continuing defensively.")
    # --- End mapping ---

    required = required or (FEATURES if FEATURES else None)
    if required:
        df = add_missing_and_reindex(df, required)
        LOG.info("Prepared input reindexed to authoritative features (%d).", len(required))
    else:
        LOG.warning("No authoritative feature list found; using incoming columns (%d).", len(df.columns))

    # Use provided preproc to guide numeric coercion when available
    df = coerce_numeric_cols(df, preproc=preproc)

    # Finally, ensure object/categorical columns are stringified (missing -> "__MISSING__")
    for c in df.select_dtypes(include=["object", "category"]).columns:
        try:
            df[c] = df[c].astype(str).fillna("__MISSING__")
        except Exception:
            df[c] = df[c].map(lambda v: str(v) if not pd.isna(v) else "__MISSING__")

    return df

def to_pylist(preds):
    try:
        arr = np.atleast_1d(preds)
        out = []
        for p in arr:
            if isinstance(p, (np.integer, np.floating)):
                if np.issubdtype(type(p), np.integer):
                    out.append(int(p))
                else:
                    out.append(float(p))
            else:
                try:
                    out.append(p.item() if hasattr(p, "item") else p)
                except Exception:
                    out.append(p)
        return out
    except Exception:
        try:
            return list(preds)
        except Exception:
            return [preds]

# ---------------------------
# Fallback rule-based heuristic
# ---------------------------
def fallback_rule_duration(payload: dict) -> float:
    est = payload.get("estimated_duration_minutes")
    if est is None:
        return 60.0
    try:
        return float(est) * 1.1
    except Exception:
        return 60.0

def fallback_rule_no_show(payload: dict) -> Tuple[int, float]:
    try:
        tech_match = int(payload.get("tech_skill_match_count") or 0)
    except Exception:
        tech_match = 0
    try:
        distance = float(payload.get("distance_km") or 0.0)
    except Exception:
        distance = 0.0
    if tech_match == 0 and distance > 20:
        return 1, 0.75
    if tech_match >= 3 and distance < 10:
        return 0, 0.05
    return 0, 0.25

# ---------------------------
# Prediction wrapper (caching, rollout, fallback)
# ---------------------------
def _should_route_to_ml(payload: dict, force_ml_header: Optional[str] = None) -> bool:
    if force_ml_header:
        if force_ml_header.lower() in ("1", "true", "yes", "on"):
            return True
        if force_ml_header.lower() in ("0", "false", "no", "off"):
            return False
    if ROLLOUT_STICKY_KEY and ROLLOUT_STICKY_KEY in payload:
        try:
            val = str(payload.get(ROLLOUT_STICKY_KEY))
            h = abs(hash(val)) % 10000
            pct = (h / 10000.0) * 100.0
            return pct < float(ML_ROLLOUT_PCT)
        except Exception:
            pass
    try:
        return random.random() * 100.0 < float(ML_ROLLOUT_PCT)
    except Exception:
        return True

def _cache_get(key: str) -> Optional[dict]:
    if not redis_client:
        return None
    try:
        v = redis_client.get(key)
        if not v:
            return None
        return json.loads(v)
    except Exception:
        return None

def _cache_set(key: str, value: dict, ttl: int = CACHE_TTL_SECONDS) -> None:
    if not redis_client:
        return
    try:
        redis_client.set(key, json.dumps(value, default=str), ex=ttl)
    except Exception:
        LOG.debug("Redis set failed for key %s", key)

def _predict_with_pipeline(pipeline, payload_df: pd.DataFrame):
    try:
        preds = pipeline.predict(payload_df)
        probs = None
        try:
            if hasattr(pipeline, "predict_proba"):
                p = pipeline.predict_proba(payload_df)
                if p is not None and getattr(p, "ndim", 1) == 2:
                    probs = p[:, 1].tolist()
        except Exception:
            probs = None
        return to_pylist(preds), probs
    except Exception as e_initial:
        LOG.warning("pipeline.predict failed (primary attempt): %s", str(e_initial))
        tried = []
        try:
            preds = pipeline.predict(payload_df.values)
            probs = None
            try:
                if hasattr(pipeline, "predict_proba"):
                    p = pipeline.predict_proba(payload_df.values)
                    if p is not None and getattr(p, "ndim", 1) == 2:
                        probs = p[:, 1].tolist()
            except Exception:
                probs = None
            LOG.warning("pipeline.predict succeeded with payload_df.values fallback.")
            return to_pylist(preds), probs
        except Exception as e1:
            tried.append(("values", str(e1)))
            LOG.debug("values fallback failed: %s", e1)

        try:
            df2 = payload_df.copy()
            coerced_cols = []
            for c in df2.columns:
                try:
                    coerced = pd.to_numeric(df2[c], errors="coerce")
                    if coerced.notna().any():
                        df2[c] = coerced
                        coerced_cols.append(c)
                except Exception:
                    continue
            if coerced_cols:
                try:
                    preds = pipeline.predict(df2)
                    probs = None
                    try:
                        if hasattr(pipeline, "predict_proba"):
                            p = pipeline.predict_proba(df2)
                            if p is not None and getattr(p, "ndim", 1) == 2:
                                probs = p[:, 1].tolist()
                    except Exception:
                        probs = None
                    LOG.warning("pipeline.predict succeeded after per-column numeric coercion (cols=%s).", coerced_cols)
                    return to_pylist(preds), probs
                except Exception as e2:
                    tried.append(("coerce_numeric", str(e2)))
                    LOG.debug("coerce_numeric fallback failed: %s", e2)
            else:
                LOG.debug("coerce_numeric found no numeric-like columns to coerce.")
        except Exception as e_coerce:
            tried.append(("coerce_numeric_exception", str(e_coerce)))
            LOG.debug("coerce_numeric attempt raised exception: %s", e_coerce)

        try:
            df3 = payload_df.fillna(0)
            preds = pipeline.predict(df3)
            probs = None
            try:
                if hasattr(pipeline, "predict_proba"):
                    p = pipeline.predict_proba(df3)
                    if p is not None and getattr(p, "ndim", 1) == 2:
                        probs = p[:, 1].tolist()
            except Exception:
                probs = None
            LOG.warning("pipeline.predict succeeded after fillna(0) fallback.")
            return to_pylist(preds), probs
        except Exception as e3:
            tried.append(("fillna", str(e3)))
            LOG.debug("fillna fallback failed: %s", e3)

        LOG.error("All pipeline.predict recovery attempts failed. Attempts: %s", tried)
        raise e_initial

def _call_predict(task: str, payload: dict, force_ml_header: Optional[str] = None) -> dict:
    key = f"pred:{task}:" + _canonical_payload_key(payload)
    cached = _cache_get(key)
    if cached is not None:
        cached["cached"] = True
        return cached

    route_ml = _should_route_to_ml(payload, force_ml_header)
    resp = {"cached": False, "fallback": False, "model_version": None}
    if task == "no_show":
        pipeline = LOADED_PIPELINE_NOSHOW
        preproc = PREPROCESSOR_NOSHOW
        model_path = NOSHOW_MODEL_PATH
    else:
        pipeline = LOADED_PIPELINE_DURATION
        preproc = PREPROCESSOR_DURATION
        model_path = DURATION_MODEL_PATH

    required = FEATURES if len(FEATURES) else None
    df = prepare_input_df(payload, required=required, preproc=preproc)

    if not route_ml or (pipeline is None and (task == "no_show" and MODEL_NOSHOW is None or task == "duration" and MODEL_DURATION is None)):
        LOG.info("Routing to fallback for task=%s (route_ml=%s, pipeline_exists=%s)", task, route_ml, bool(pipeline))
        resp["fallback"] = True
        if task == "no_show":
            pred, proba = fallback_rule_no_show(payload)
            resp.update({"predictions": [int(pred)], "probabilities": [float(proba)]})
        else:
            pred = fallback_rule_duration(payload)
            resp.update({"predicted_duration": [float(pred)]})
        resp["model_version"] = None
        _cache_set(key, resp)
        _write_jsonl_line(PREDICTIONS_LOG, {"ts": time.time(), "task": task, "input": payload, "output": resp, "model_version": resp["model_version"], "fallback": True})
        return resp

    try:
        if pipeline is not None:
            preds, probs = _predict_with_pipeline(pipeline, df)
            model_name = model_path.name if model_path else None
            if task == "no_show":
                resp.update({"predictions": preds})
                if probs is not None:
                    resp["probabilities"] = probs
            else:
                resp.update({"predicted_duration": preds})
                if probs is not None:
                    resp["probabilities"] = probs
            resp["fallback"] = False
            resp["model_version"] = model_name
            _cache_set(key, resp)
            _write_jsonl_line(PREDICTIONS_LOG, {"ts": time.time(), "task": task, "input": payload, "output": resp, "model_version": resp["model_version"], "fallback": False})
            return resp
        elif preproc is not None and ((task == "no_show" and MODEL_NOSHOW) or (task == "duration" and MODEL_DURATION)):
            X = preproc.transform(df)
            model = MODEL_NOSHOW if task == "no_show" else MODEL_DURATION
            preds = model.predict(X)
            probs = None
            try:
                if hasattr(model, "predict_proba"):
                    p = model.predict_proba(X)
                    if p is not None and getattr(p, "ndim", 1) == 2:
                        probs = p[:, 1].tolist()
            except Exception:
                probs = None
            model_name = model_path.name if model_path else None
            if task == "no_show":
                resp.update({"predictions": to_pylist(preds)})
                if probs is not None:
                    resp["probabilities"] = probs
            else:
                resp.update({"predicted_duration": to_pylist(preds)})
                if probs is not None:
                    resp["probabilities"] = probs
            resp["fallback"] = False
            resp["model_version"] = model_name
            _cache_set(key, resp)
            _write_jsonl_line(PREDICTIONS_LOG, {"ts": time.time(), "task": task, "input": payload, "output": resp, "model_version": resp["model_version"], "fallback": False})
            return resp
        else:
            raise RuntimeError("No usable model or pipeline available for ML path.")
    except HTTPException:
        raise
    except Exception as e:
        LOG.exception("Pipeline or model prediction failed: %s", e)
        if not DISABLE_FALLBACK:
            LOG.info("ML failure - using fallback for task=%s: %s", task, e)
            resp["fallback"] = True
            if task == "no_show":
                pred, proba = fallback_rule_no_show(payload)
                resp.update({"predictions": [int(pred)], "probabilities": [float(proba)]})
            else:
                pred = fallback_rule_duration(payload)
                resp.update({"predicted_duration": [float(pred)]})
            resp["model_version"] = None
            _cache_set(key, resp)
            _write_jsonl_line(PREDICTIONS_LOG, {"ts": time.time(), "task": task, "input": payload, "output": resp, "model_version": resp["model_version"], "fallback": True})
            return resp
        raise HTTPException(status_code=500, detail=f"pipeline prediction failed: {e}")

# ---------------------------
# Startup (load features/models)
# ---------------------------
load_features()
discover_and_load_prod()
LOG.info("Startup summary: duration=%s noshow=%s features=%d", DURATION_MODEL_PATH, NOSHOW_MODEL_PATH, len(FEATURES))

# ---------------------------
# FastAPI endpoints
# ---------------------------
@APP.get("/model_info/")
def model_info():
    return {
        "duration_loaded": bool(LOADED_PIPELINE_DURATION or MODEL_DURATION),
        "duration_model_path": str(DURATION_MODEL_PATH) if DURATION_MODEL_PATH else None,
        "noshow_loaded": bool(LOADED_PIPELINE_NOSHOW or MODEL_NOSHOW),
        "noshow_model_path": str(NOSHOW_MODEL_PATH) if NOSHOW_MODEL_PATH else None,
        "fallback_allowed": not DISABLE_FALLBACK,
        "features_count": len(FEATURES),
        "features": FEATURES if len(FEATURES) <= 200 else FEATURES[:200],
        "rollout_pct": float(ML_ROLLOUT_PCT)
    }

@APP.post("/predict/no_show/")
async def predict_no_show(payload: Any = Body(...), request: Request = None, x_force_ml: Optional[str] = Header(None)):
    if LOADED_PIPELINE_NOSHOW is None and MODEL_NOSHOW is None and PREPROCESSOR_NOSHOW is None:
        raise HTTPException(status_code=503, detail="noshow model not available")
    try:
        payload_dict = payload if isinstance(payload, dict) else dict(payload)
    except Exception:
        payload_dict = payload
    try:
        result = _call_predict("no_show", payload_dict, force_ml_header=x_force_ml)
    except HTTPException:
        raise
    except Exception as e:
        LOG.exception("predict_no_show unexpected error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    out = {
        "model_version": result.get("model_version"),
        "fallback": bool(result.get("fallback", False)),
        "predictions": result.get("predictions"),
    }
    if "probabilities" in result:
        out["probabilities"] = result["probabilities"]
    out["used_ml"] = not out["fallback"]
    return JSONResponse(content=out)

@APP.post("/predict/duration/")
async def predict_duration(payload: Any = Body(...), request: Request = None, x_force_ml: Optional[str] = Header(None)):
    if LOADED_PIPELINE_DURATION is None and MODEL_DURATION is None and PREPROCESSOR_DURATION is None:
        raise HTTPException(status_code=503, detail="duration model not available")
    try:
        payload_dict = payload if isinstance(payload, dict) else dict(payload)
    except Exception:
        payload_dict = payload
    try:
        result = _call_predict("duration", payload_dict, force_ml_header=x_force_ml)
    except HTTPException:
        raise
    except Exception as e:
        LOG.exception("predict_duration unexpected error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    out = {
        "model_version": result.get("model_version"),
        "fallback": bool(result.get("fallback", False)),
        "predicted_duration": result.get("predicted_duration"),
    }
    if "probabilities" in result:
        out["probabilities"] = result["probabilities"]
    out["used_ml"] = not out["fallback"]
    return JSONResponse(content=out)

@APP.post("/predict/no_show/legacy")
def predict_no_show_legacy(payload: Any = Body(...)):
    j = json.loads(predict_no_show(payload).body.decode("utf-8"))
    preds = j.get("predictions", [])
    probs = j.get("probabilities", [])
    pred0 = None; proba = None
    if preds:
        try:
            pred0 = int(preds[0])
        except Exception:
            pred0 = None
    if probs:
        try:
            proba = float(probs[0])
        except Exception:
            proba = None
    return {"predicted": pred0, "prob_no_show": proba}
