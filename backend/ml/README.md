```

---

## File: `backend/ml/README.md`

````markdown
# ML folder — Phase A

This folder contains scripts to extract features and generate a seed dataset for quick experiments.

Files:
- `ingest/build_features.py` — extracts features via Django ORM and writes `data/features.csv`.
- `seed_generator.py` — create synthetic technicians, skills, jobs and assignments (useful for local testing).

**How to run**

1. Ensure your Django env var is set (replace `your_project.settings`):

**Linux / macOS / Git Bash / WSL**

```bash
export DJANGO_SETTINGS_MODULE=your_project.settings
python backend/ml/ingest/build_features.py --output data/features.csv
````

**Windows PowerShell**

```powershell
$env:DJANGO_SETTINGS_MODULE = "your_project.settings"
python backend/ml/ingest/build_features.py --output data/features.csv
```

2. Inside Docker (example using docker-compose service name `backend`):

```bash
docker compose exec backend bash -c "export DJANGO_SETTINGS_MODULE=your_project.settings && python backend/ml/ingest/build_features.py --output /app/data/features.csv"
```

Notes:

* The script is defensive: it works even when some fields are missing. Adjust import path `from core.models import ...` if your app name differs.
* `features.csv` is the canonical artifact used for initial model training.

```
```

---
# ML artifacts & promotion (hof-smart)

## Policy
- Small model artifacts (<50MB) may be committed under `backend/ml/models/`.
- Larger models must be stored in an artifact store (S3/MinIO) and only pointers placed in repo.
- Training must produce `model_<name>.joblib`, `metrics.json`, `meta.json`, and `feature_columns.json`.

## Local commands
- Train: `python backend/ml/train.py --out-dir backend/ml/models --no-mlflow`
- Promote: `bash backend/ml/promote_model.sh backend/ml/models/model_v1.joblib`

## CI
- `.github/workflows/ml_train.yml` will run the training on a small dataset and upload artifacts.
- `.github/workflows/ml_smoke_test.yml` will build the ml_service image and hit `/predict/*`.

## Artifact store
- For production, use S3 or MinIO. Example minio docker-compose available in this repo's `dev/` folder.
