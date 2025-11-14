#!/usr/bin/env python3
"""
Robust train script for hof-smart.

Produces:
 - backend/ml/models/model_full_pipeline_duration_v1.joblib  (if duration target present)
 - backend/ml/models/model_full_pipeline_noshow_v1.joblib    (if no-show target present)
 - backend/ml/models/preprocessor_*.joblib
 - backend/ml/models/model_*.joblib
 - backend/ml/models/metrics_v1.json
 - backend/ml/models/model_v1.meta.json
 - backend/ml/models/feature_columns.json        (list form)
 - backend/ml/models/feature_columns_legacy.json ({"features": [...]}) for compatibility

Usage examples:
  python backend/ml/train.py
  python backend/ml/train.py --input data/features.csv --out-dir backend/ml/models --seed 123
  python backend/ml/train.py --input data/features.csv --out-dir backend/ml/models --min-auc 0.6
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.metrics import (
    mean_absolute_error, mean_squared_error, r2_score,
    roc_auc_score, precision_score, recall_score
)

# -- Defaults / aliases
DEFAULT_SEED = 42
DURATION_TARGET_ALIASES = ["actual_duration_minutes", "actual_duration", "duration_minutes", "duration"]
NOSHOW_TARGET_ALIASES = ["was_no_show", "no_show", "no_show_flag", "was_no_show_flag", "was_completed"]

# -- Helpers
def safe_mkdir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)

def _write_json_atomic(path: Path, obj: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, default=str)
    tmp.replace(path)

def find_col(df: pd.DataFrame, aliases: List[str]) -> Optional[str]:
    for a in aliases:
        if a in df.columns:
            return a
    return None

def build_synthetic_df(n: int = 1000, seed: int = DEFAULT_SEED) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    df = pd.DataFrame({
        "num_required_skills": rng.integers(0, 5, size=n),
        "tech_skill_match_count": rng.integers(0, 5, size=n),
        "distance_km": np.round(rng.random(n) * 50.0, 2),
        "time_of_day": rng.choice(["morning", "afternoon", "evening"], size=n),
        "weekday": rng.choice(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], size=n),
        "estimated_duration_minutes": rng.integers(10, 240, size=n),
        "assigned_technician_id": rng.integers(1, 100, size=n),
        "was_completed": rng.choice([0, 1], size=n, p=[0.2, 0.8]),
    })
    # synthetic targets
    df["actual_duration_minutes"] = np.round(df["estimated_duration_minutes"] * (0.8 + rng.random(n) * 0.6)).astype(int)
    # keep some realistic correlation for no-show (higher distance and low skill match -> more no-shows)
    ps = 0.12 + 0.02 * df["distance_km"] + 0.15 * (df["tech_skill_match_count"] < df["num_required_skills"])
    ps = np.clip(ps, 0.01, 0.9)
    df["was_no_show"] = (rng.random(n) < ps).astype(int)
    return df

def _sanitize_df_before_feature_infer(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.replace("", pd.NA, inplace=True)
    # best-effort numeric coercion
    for col in df.columns:
        try:
            coerced = pd.to_numeric(df[col], errors="coerce")
            if coerced.notna().any():
                df[col] = coerced
        except Exception:
            pass
    # ensure categoricals are string typed (for OneHot)
    for c in df.select_dtypes(include=["object", "category"]).columns:
        df[c] = df[c].astype(str).fillna("__MISSING__")
    return df

def infer_feature_columns(df: pd.DataFrame, exclude_prefixes: Tuple[str, ...] = ("job_id", "id", "target", "timestamp", "created_at", "updated_at")) -> List[str]:
    cols = [c for c in df.columns if not any(c.lower().startswith(pfx) for pfx in exclude_prefixes)]
    return cols

def build_feature_sets(df: pd.DataFrame, exclude_cols: List[str]) -> Tuple[List[str], List[str]]:
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    categorical_cols = df.select_dtypes(include=["object", "category", "bool"]).columns.tolist()
    numeric_cols = [c for c in numeric_cols if c not in exclude_cols]
    categorical_cols = [c for c in categorical_cols if c not in exclude_cols]
    return numeric_cols, categorical_cols

def _onehot_encoder_compat(**kwargs):
    """
    Create OneHotEncoder with backward/forward compatible parameter name for sparse output.
    Uses sparse_output if supported else sparse.
    """
    try:
        # sklearn >= 1.2 uses sparse_output
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False, **{k:v for k,v in kwargs.items()})
    except TypeError:
        # older sklearn
        return OneHotEncoder(handle_unknown="ignore", sparse=False, **{k:v for k,v in kwargs.items()})

def make_regressor_pipeline(numeric_cols: List[str], categorical_cols: List[str], seed: int) -> Pipeline:
    numeric_transform = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler())
    ])
    categorical_transform = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="constant", fill_value="__MISSING__")),
        ("onehot", _onehot_encoder_compat())
    ])
    preproc = ColumnTransformer(transformers=[
        ("num", numeric_transform, numeric_cols),
        ("cat", categorical_transform, categorical_cols),
    ], remainder="drop")
    model = RandomForestRegressor(n_estimators=200, random_state=seed, n_jobs=-1)
    pipe = Pipeline(steps=[("preproc", preproc), ("model", model)])
    return pipe

def make_classifier_pipeline(numeric_cols: List[str], categorical_cols: List[str], seed: int) -> Pipeline:
    numeric_transform = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler())
    ])
    categorical_transform = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="constant", fill_value="__MISSING__")),
        ("onehot", _onehot_encoder_compat())
    ])
    preproc = ColumnTransformer(transformers=[
        ("num", numeric_transform, numeric_cols),
        ("cat", categorical_transform, categorical_cols),
    ], remainder="drop")
    model = RandomForestClassifier(n_estimators=200, random_state=seed, n_jobs=-1)
    pipe = Pipeline(steps=[("preproc", preproc), ("model", model)])
    return pipe

def train_and_eval_regression(df: pd.DataFrame, features: List[str], target_col: str, seed: int, out_dir: Path, prefix: str = "duration_v1") -> Tuple[Path, Dict[str, Any]]:
    df = df.copy()
    df = df[~df[target_col].isna()]
    if df.shape[0] < 10:
        raise RuntimeError(f"Not enough rows to train regression (found {df.shape[0]} rows).")
    df = _sanitize_df_before_feature_infer(df)
    X = df[features].copy()
    y = pd.to_numeric(df[target_col], errors="coerce").astype(float)
    keep = ~y.isna()
    X = X.loc[keep]; y = y.loc[keep]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=seed)
    numeric_cols, categorical_cols = build_feature_sets(X_train, exclude_cols=[])
    pipe = make_regressor_pipeline(numeric_cols, categorical_cols, seed)
    pipe.fit(X_train, y_train)
    preds = pipe.predict(X_test)
    mae = mean_absolute_error(y_test, preds)
    rmse = mean_squared_error(y_test, preds, squared=False)
    r2 = r2_score(y_test, preds)
    model_full_path = out_dir / f"model_full_pipeline_{prefix}.joblib"
    joblib.dump(pipe, model_full_path, compress=3)
    # also dump pieces
    try:
        preproc_obj = pipe.named_steps.get("preproc")
        if preproc_obj is not None:
            joblib.dump(preproc_obj, out_dir / f"preprocessor_{prefix}.joblib", compress=3)
    except Exception:
        pass
    try:
        model_obj = pipe.named_steps.get("model")
        if model_obj is not None:
            joblib.dump(model_obj, out_dir / f"model_{prefix}.joblib", compress=3)
    except Exception:
        pass
    metrics = {
        "task": "duration_regression",
        "target": target_col,
        "n_train": int(X_train.shape[0]),
        "n_test": int(X_test.shape[0]),
        "mae": float(mae),
        "rmse": float(rmse),
        "r2": float(r2)
    }
    return model_full_path, metrics

def train_and_eval_classification(df: pd.DataFrame, features: List[str], target_col: str, seed: int, out_dir: Path, prefix: str = "noshow_v1") -> Tuple[Path, Dict[str, Any]]:
    df = df.copy()
    df = df[~df[target_col].isna()]
    if df.shape[0] < 10:
        raise RuntimeError(f"Not enough rows to train classifier (found {df.shape[0]} rows).")
    df = _sanitize_df_before_feature_infer(df)
    try:
        y = df[target_col].astype(int)
    except Exception:
        y = df[target_col].apply(lambda v: 1 if bool(v) else 0).astype(int)
    X = df[features].copy()
    if len(y.unique()) < 2:
        raise RuntimeError(f"Only one class present in {target_col}; cannot train classifier.")
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, stratify=y, random_state=seed)
    numeric_cols, categorical_cols = build_feature_sets(X_train, exclude_cols=[])
    pipe = make_classifier_pipeline(numeric_cols, categorical_cols, seed)
    pipe.fit(X_train, y_train)
    if hasattr(pipe.named_steps["model"], "predict_proba"):
        probs = pipe.predict_proba(X_test)[:, 1]
    else:
        probs = pipe.predict(X_test)
    preds = pipe.predict(X_test)
    try:
        auc = float(roc_auc_score(y_test, probs))
    except Exception:
        auc = None
    precision = float(precision_score(y_test, preds, zero_division=0))
    recall = float(recall_score(y_test, preds, zero_division=0))
    model_full_path = out_dir / f"model_full_pipeline_{prefix}.joblib"
    joblib.dump(pipe, model_full_path, compress=3)
    try:
        preproc_obj = pipe.named_steps.get("preproc")
        if preproc_obj is not None:
            joblib.dump(preproc_obj, out_dir / f"preprocessor_{prefix}.joblib", compress=3)
    except Exception:
        pass
    try:
        model_obj = pipe.named_steps.get("model")
        if model_obj is not None:
            joblib.dump(model_obj, out_dir / f"model_{prefix}.joblib", compress=3)
    except Exception:
        pass
    metrics = {
        "task": "no_show_classification",
        "target": target_col,
        "n_train": int(X_train.shape[0]),
        "n_test": int(X_test.shape[0]),
        "auc_roc": auc,
        "precision": precision,
        "recall": recall
    }
    return model_full_path, metrics

def main() -> None:
    parser = argparse.ArgumentParser(description="Train baseline ML models from features CSV (or synthetic fallback).")
    parser.add_argument("--input", "-i", help="Path to features CSV. If omitted, synthetic data is used.", default=None)
    parser.add_argument("--out-dir", "--output", "-o", help="Output directory for models & metrics", default="backend/ml/models")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--model-name", help="Optional: save packaged joblib with this filename (written to out-dir)", default=None)
    parser.add_argument("--prefix", help="Model filename prefix (suffix is appended)", default="v1")
    parser.add_argument("--min-auc", type=float, default=0.0, help="Optional acceptance threshold for classification AUC (0 = no check)")
    parser.add_argument("--max-mae", type=float, default=float("inf"), help="Optional acceptance threshold for regression MAE (inf = no check)")
    args = parser.parse_args()

    inp = Path(args.input) if args.input else None
    out = Path(args.out_dir)
    safe_mkdir(out)

    if inp:
        if not inp.exists():
            raise SystemExit(f"Input file not found: {inp}")
        df = pd.read_csv(inp)
        print(f"[train] Loaded {df.shape[0]} rows, {df.shape[1]} cols from {inp}")
    else:
        print("[train] No input provided; generating synthetic dataset for training.")
        df = build_synthetic_df(n=2000, seed=args.seed)
        print(f"[train] Synthetic dataset: {df.shape[0]} rows, {df.shape[1]} cols")

    # sanitize early
    df = _sanitize_df_before_feature_infer(df)

    # add a derived feature
    try:
        if "time_of_day" in df.columns:
            df["is_peak_hour"] = df["time_of_day"].fillna("").astype(str).str.lower().apply(lambda v: 1 if v in ("morning", "evening", "peak") else 0).astype(int)
        else:
            df["is_peak_hour"] = 0
    except Exception:
        df["is_peak_hour"] = 0

    # detect targets
    dur_col = find_col(df, DURATION_TARGET_ALIASES)
    noshow_col = find_col(df, NOSHOW_TARGET_ALIASES)
    tasks: List[Tuple[str, str]] = []
    if dur_col:
        tasks.append(("regression", dur_col)); print(f"[train] Found duration target: {dur_col}")
    else:
        print("[train] No duration target found (checked aliases).")
    if noshow_col:
        tasks.append(("classification", noshow_col)); print(f"[train] Found no-show target: {noshow_col}")
    else:
        print("[train] No no-show target found (checked aliases).")

    if not tasks:
        raise SystemExit("No recognized targets present. Provide a CSV with duration and/or no-show target or run without --input to use synthetic data.")

    exclude_cols = [c for c in (dur_col, noshow_col) if c is not None]
    feature_cols = infer_feature_columns(df, exclude_prefixes=("job_id", "id", "created_at", "updated_at", "timestamp"))
    feature_cols = [c for c in feature_cols if c not in exclude_cols]
    if len(feature_cols) == 0:
        raise SystemExit("No feature columns found after excluding IDs/targets.")
    print(f"[train] Using {len(feature_cols)} features (sample): {feature_cols[:12]}")

    results: Dict[str, Any] = {"models": [], "metrics": []}

    # write authoritative feature list (plain list) and legacy dict for compatibility
    try:
        feature_file = out / "feature_columns.json"
        _write_json_atomic(feature_file, feature_cols)
        feature_file_legacy = out / "feature_columns_legacy.json"
        _write_json_atomic(feature_file_legacy, {"features": feature_cols})
        print(f"[train] Wrote feature_columns.json -> {feature_file} (and legacy form -> {feature_file_legacy})")
    except Exception as e:
        print(f"[train] Warning: failed to write feature_columns.json: {e}")

    # run tasks
    for task_type, target in tasks:
        if task_type == "regression":
            try:
                mpath, metrics = train_and_eval_regression(df, feature_cols, target, args.seed, out, prefix=f"duration_{args.prefix}")
                results["models"].append(str(mpath.name))
                results["metrics"].append(metrics)
                print(f"[train] Regression finished. MAE={metrics['mae']:.3f}, RMSE={metrics['rmse']:.3f}, R2={metrics['r2']:.3f}")
            except Exception as e:
                print(f"[train] Regression training failed: {e}")
        elif task_type == "classification":
            try:
                mpath, metrics = train_and_eval_classification(df, feature_cols, target, args.seed, out, prefix=f"noshow_{args.prefix}")
                results["models"].append(str(mpath.name))
                results["metrics"].append(metrics)
                print(f"[train] Classification finished. AUC={metrics.get('auc_roc')}, precision={metrics['precision']:.3f}, recall={metrics['recall']:.3f}")
            except Exception as e:
                print(f"[train] Classification training failed: {e}")

    # write metrics
    metrics_out = out / "metrics_v1.json"
    try:
        _write_json_atomic(metrics_out, results)
        print(f"[train] Wrote metrics -> {metrics_out}")
    except Exception as e:
        print(f"[train] Failed to write metrics_v1.json: {e}")

    # meta
    meta = {
        "produced_at": datetime.utcnow().isoformat() + "Z",
        "sklearn_version": sklearn.__version__,
        "python_version": f"{os.sys.version_info.major}.{os.sys.version_info.minor}.{os.sys.version_info.micro}",
        "models": results.get("models", []),
        "metrics_summary": results.get("metrics", []),
        "feature_count": len(feature_cols),
        "features": feature_cols[:1000]
    }
    meta_out = out / "model_v1.meta.json"
    try:
        _write_json_atomic(meta_out, meta)
        print(f"[train] Wrote meta -> {meta_out}")
    except Exception as e:
        print(f"[train] Failed to write model_v1.meta.json: {e}")

    # optional packaged model joblib (single file) - contains models list + meta
    if args.model_name:
        packaged = {"models": results.get("models", []), "meta": meta}
        pkg_path = out / args.model_name
        try:
            joblib.dump(packaged, pkg_path, compress=3)
            print(f"[train] Wrote packaged joblib -> {pkg_path}")
        except Exception as e:
            print(f"[train] Failed to write packaged model {pkg_path}: {e}")

    print(f"[train] Done. Artifacts written to: {out}")

    # Acceptance checks (useful for CI)
    failed = False
    for m in results.get("metrics", []):
        if m.get("task") == "no_show_classification":
            auc = m.get("auc_roc") or 0.0
            if args.min_auc and auc < args.min_auc:
                print(f"[train] Acceptance FAILED: classification AUC {auc:.4f} < min_auc {args.min_auc}")
                failed = True
        if m.get("task") == "duration_regression":
            mae = m.get("mae") or float("inf")
            if args.max_mae is not None and mae > args.max_mae:
                print(f"[train] Acceptance FAILED: regression MAE {mae:.4f} > max_mae {args.max_mae}")
                failed = True

    if failed:
        raise SystemExit(2)

if __name__ == "__main__":
    main()
