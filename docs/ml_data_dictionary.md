# ML Data Dictionary


This document lists the database tables/fields and derived features used for ML (phase A).


## Primary models & fields


### Job
- `id` (int): Primary key.
- `customer_name` (string): Customer identifier or name.
- `address` (string)
- `lat` / `lon` (float): job coordinates; `null` if unknown.
- `requested_window_start` (datetime)
- `requested_window_end` (datetime)
- `estimated_duration_minutes` (int)
- `required_skills` (ManyToMany -> Skill)
- `status` (string): expected values like `new`, `assigned`, `in_progress`, `done`.
- `created_at` (datetime)
- `updated_at` (datetime)
- `notes` (text)
- `meta` (json/text) — optional, may contain customer_id/customer_code.


### Assignment
- `id`
- `job` (FK -> Job)
- `technician` (FK -> Technician)
- `created_by` (FK -> User)
- `created_at` (datetime)
- `score_breakdown` (json) — contains distance_km, components, etc.
- `reason` (text)


### Technician
- `id`
- `user` (FK -> User) with `username`, `first_name`, `last_name`, `email`
- `last_lat`, `last_lon` (float)
- `skills` (ManyToMany -> Skill)
- `status` (string): e.g., `available`, `busy`, etc.
- `created_at` (datetime)


### Skill
- `id`, `code`, `name`


### SLAAction (optional)
- `id`, `job` (FK), `recommended_action`, `risk_score`, `risk_level`, `status`, `meta`


---


## Derived features (produced by feature extraction)


Per row (job-centric) we produce these columns in `features.csv`:


- `job_id` (int)
- `customer_name` (string)
- `num_required_skills` (int)
- `required_skill_ids` (string) — comma-separated skill ids
- `has_required_skills` (bool)
- `assigned_technician_id` (int or null)
- `assigned_technician_username` (string or null)
- `tech_skill_match_count` (int or null)
- `distance_km` (float or null) — distance between job and assigned tech if coords exist
- `time_of_day` (int) — hour from requested_window_start or created_at
- `weekday` (int) — 0=Monday..6=Sunday
- `estimated_duration_minutes` (int or null)
Notes: some fields may be null if data missing. The ETL script documents fallbacks.