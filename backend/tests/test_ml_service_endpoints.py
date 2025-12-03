import json
import pytest
from fastapi.testclient import TestClient

import backend.ml_service.main as ml_main

client = TestClient(ml_main.APP)


def test_model_info():
    r = client.get('/model_info/')
    assert r.status_code == 200
    data = r.json()
    assert 'features' in data


@pytest.mark.parametrize('endpoint,payload', [
    ('/predict/no_show/', {"assigned_technician_id":42, "distance_km":5.2}),
    ('/predict/duration/', {"assigned_technician_id":42, "distance_km":5.2}),
])
def test_predict_endpoints_basic(endpoint, payload):
    r = client.post(endpoint, json=payload)
    assert r.status_code in (200, 503)
    if r.status_code == 200:
        data = r.json()
        # ensure some expected keys exist
        assert 'model_version' in data or 'predicted_duration' in data or 'predictions' in data


def test_predict_fallback_when_no_model(monkeypatch):
    """Simulate missing models to ensure service returns 503"""
    monkeypatch.setattr(ml_main, 'LOADED_PIPELINE', None)
    monkeypatch.setattr(ml_main, 'MODEL', None)
    monkeypatch.setattr(ml_main, 'PREPROCESSOR', None)
    r = client.post('/predict/no_show/', json={"assigned_technician_id":42})
    assert r.status_code == 503

