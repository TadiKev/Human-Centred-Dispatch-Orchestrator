# backend/core/ml_service.py
import joblib
import json
import pandas as pd
from pathlib import Path
from django.conf import settings

MODEL_DIR = Path(getattr(settings, 'BASE_DIR', Path('/app'))) / 'ml' / 'models'
# fallback if BASE_DIR not set exactly how you expect, you can also use Path('/app/ml/models')

_cache = {}

def load_model(model_name='model_noshow_v1.joblib'):
    if 'model' not in _cache:
        model_path = MODEL_DIR / model_name
        feat_path = MODEL_DIR / 'feature_columns.json'
        _cache['model'] = joblib.load(model_path)
        with open(feat_path, 'r') as fh:
            _cache['features'] = json.load(fh)
    return _cache['model'], _cache['features']

def prepare_dataframe(payload_records, feature_columns):
    # payload_records: list of dicts (or single dict)
    if isinstance(payload_records, dict):
        records = [payload_records]
    else:
        records = list(payload_records)
    df = pd.DataFrame.from_records(records)
    # ensure all feature columns exist (fill missing with None/NaN so pipeline imputes)
    for c in feature_columns:
        if c not in df.columns:
            df[c] = pd.NA
    # keep only the columns in the feature order
    return df[feature_columns]
