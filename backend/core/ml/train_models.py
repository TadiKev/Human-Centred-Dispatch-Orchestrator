# backend/core/ml/train_models.py
import os
import json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, roc_auc_score
import joblib
from django.conf import settings

MODEL_DIR = Path(getattr(settings, "BASE_DIR", Path(__file__).resolve().parents[3])) / "ml_models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

FEATURE_NAMES = [
    "required_skills_count",
    "estimated_duration_minutes",
    "historical_avg_duration",
    "tech_experience_years",
    "distance_km",
]

def make_synthetic_data(n=5000, random_state=42):
    rng = np.random.RandomState(random_state)
    required_skills_count = rng.poisson(1.2, size=n).clip(0, 5)
    estimated_duration_minutes = rng.normal(60, 20, size=n).clip(10, 480)
    historical_avg_duration = estimated_duration_minutes * (rng.normal(1.0, 0.15, size=n))
    tech_experience_years = rng.poisson(3, size=n)
    distance_km = rng.exponential(4.0, size=n).clip(0, 200)

    # Duration target: base + skill adjustment + distance overhead - experience discount + noise
    duration = (0.9 * historical_avg_duration +
                2.0 * required_skills_count +
                1.6 * distance_km -
                1.2 * tech_experience_years +
                rng.normal(0, 8, size=n))
    duration = duration.clip(5, 720)

    # No-show probability: higher when distance big, short history, low experience
    prob_no_show = (0.05 +
                    0.01 * required_skills_count +
                    0.001 * distance_km -
                    0.01 * np.log1p(tech_experience_years))
    prob_no_show = np.clip(prob_no_show, 0.001, 0.9)
    no_show = rng.binomial(1, prob_no_show)

    df = pd.DataFrame({
        "required_skills_count": required_skills_count,
        "estimated_duration_minutes": estimated_duration_minutes,
        "historical_avg_duration": historical_avg_duration,
        "tech_experience_years": tech_experience_years,
        "distance_km": distance_km,
        "duration": duration,
        "no_show": no_show,
    })
    return df

def train_and_save(n=5000):
    df = make_synthetic_data(n=n)
    X = df[FEATURE_NAMES]
    y_reg = df["duration"]
    y_cls = df["no_show"]

    X_train, X_test, y_train_reg, y_test_reg = train_test_split(X, y_reg, test_size=0.2, random_state=42)
    _, _, y_train_cls, y_test_cls = train_test_split(X, y_cls, test_size=0.2, random_state=42)

    # Regressor
    rfr = RandomForestRegressor(n_estimators=200, random_state=42, n_jobs=-1)
    rfr.fit(X_train, y_train_reg)
    preds = rfr.predict(X_test)
    mae = mean_absolute_error(y_test_reg, preds)

    # Classifier
    rfc = RandomForestClassifier(n_estimators=200, random_state=42, n_jobs=-1)
    rfc.fit(X_train, y_train_cls)
    probs = rfc.predict_proba(X_test)[:, 1]
    auc = roc_auc_score(y_test_cls, probs)

    # Persist models and metadata
    joblib.dump(rfr, MODEL_DIR / "duration_rfr.joblib")
    joblib.dump(rfc, MODEL_DIR / "no_show_rfc.joblib")

    meta = {
        "feature_names": FEATURE_NAMES,
        "regressor": {"model_file": "duration_rfr.joblib", "mae": float(mae)},
        "classifier": {"model_file": "no_show_rfc.joblib", "auc": float(auc)},
    }
    with open(MODEL_DIR / "meta.json", "w") as fh:
        json.dump(meta, fh, indent=2)

    print("Saved models to:", MODEL_DIR)
    print("Duration MAE:", mae)
    print("No-show AUC:", auc)

if __name__ == "__main__":
    # run as a Django-managed script: set DJANGO_SETTINGS_MODULE env var then run via manage.py shell or call via manage.py command
    train_and_save(5000)
