#!/usr/bin/env python3
"""
smoke_test.py
Simple smoke tests for local ml_service.

Usage:
  python smoke_test.py
Environment:
  ML_SERVICE_URL can override default (http://localhost:8000)
"""
import os
import sys
import time
import json

try:
    import requests
except Exception as e:
    print("The 'requests' package is required. Install with: python -m pip install requests")
    raise

BASE = os.environ.get("ML_SERVICE_URL", "http://localhost:8000").rstrip("/")
HEADERS = {"Content-Type": "application/json"}
TIMEOUT = 5.0

def try_request(fn, url, **kwargs):
    attempts = 3
    backoff = 0.5
    for i in range(attempts):
        try:
            return fn(url, timeout=TIMEOUT, **kwargs)
        except requests.RequestException as e:
            print(f"[attempt {i+1}/{attempts}] request error: {e}")
            if i < attempts - 1:
                time.sleep(backoff)
                backoff *= 2
            else:
                raise

def pretty(obj):
    try:
        return json.dumps(obj, indent=2, sort_keys=True)
    except Exception:
        return str(obj)

def get_model_info():
    url = f"{BASE}/model_info/"
    print(f"\n-> GET {url}")
    r = try_request(requests.get, url, headers=HEADERS)
    print(f"status: {r.status_code}")
    try:
        j = r.json()
        print(pretty(j))
        return j
    except Exception:
        print("Non-JSON response:")
        print(r.text)
        return None

def post_predict(endpoint, payload):
    url = f"{BASE}{endpoint}"
    print(f"\n-> POST {url}")
    print("payload:", pretty(payload))
    r = try_request(requests.post, url, headers=HEADERS, json=payload)
    print(f"status: {r.status_code}")
    try:
        j = r.json()
        print("response (json):")
        print(pretty(j))
        return j
    except Exception:
        print("response (raw):")
        print(r.text)
        return None

def main():
    print("ML service smoke test (base url = {})".format(BASE))
    try:
        info = get_model_info()
    except Exception as e:
        print("Failed to contact ml_service. Is it running? Try: docker compose logs ml_service")
        print("Error:", e)
        sys.exit(2)

    # build a defensive sample payload. The ml_service will reindex missing cols for us.
    sample_payload = {
        "num_required_skills": 2,
        "tech_skill_match_count": 1,
        "distance_km": 5.2,
        "time_of_day": "morning",
        "weekday": "Tuesday",
        "estimated_duration_minutes": 45,
        "assigned_technician_id": 42,
        "was_completed": 0,
        "is_peak_hour": 1
    }

    # POST to no_show (classification) and duration (regression)
    try:
        _ = post_predict("/predict/no_show/", sample_payload)
    except Exception as e:
        print("POST /predict/no_show/ failed:", e)

    try:
        _ = post_predict("/predict/duration/", sample_payload)
    except Exception as e:
        print("POST /predict/duration/ failed:", e)

    print("\nSmoke test finished.")

if __name__ == '__main__':
    main()
