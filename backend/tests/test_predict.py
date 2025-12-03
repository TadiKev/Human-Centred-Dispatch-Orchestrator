# tests/test_predict.py
import requests
import json

def test_noshow_predict():
    """Test /api/ml/predict/noshow/ endpoint"""
    url = "http://127.0.0.1:8000/api/ml/predict/noshow/"
    payload = {
        "num_required_skills": 1,
        "has_required_skills": True,
        "distance_km": 2.1,
        "time_of_day": 8,
        "weekday": 4,
    }
    r = requests.post(url, json=payload, timeout=5)
    assert r.status_code == 200
    data = r.json()
    assert "predictions" in data
    assert "probabilities" in data


def test_predict_no_show_local():
    """Test /predict/no_show/ endpoint"""
    payload = {
        "num_required_skills": 2,
        "tech_skill_match_count": 1,
        "distance_km": 5.2,
        "time_of_day": "morning",
        "weekday": "Tuesday",
        "estimated_duration_minutes": 45,
        "assigned_technician_id": 42,
        "was_completed": 0,
    }
    r = requests.post("http://127.0.0.1:8000/predict/no_show/", json=payload, timeout=10)
    assert r.status_code == 200
    j = r.json()
    assert "predictions" in j
    assert "probabilities" in j
