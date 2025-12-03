import requests, json

url = "http://127.0.0.1:8001/predict/duration/"
payload = {
    "assigned_technician_id": 42,
    "distance_km": 5.2,
    "estimated_duration_minutes": 45,
    "time_of_day": "morning",
    "weekday": "Tuesday",
    "num_required_skills": 2,
    "tech_skill_match_count": 1,
    "was_completed": 0,
    "is_peak_hour": 0
}

headers = {
    "Content-Type": "application/json",
    "X-Force-ML": "1"
}

r = requests.post(url, json=payload, headers=headers)
print("Status:", r.status_code)
print("Response:", r.text)
