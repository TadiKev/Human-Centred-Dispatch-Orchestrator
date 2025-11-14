## 1) `backend/ml/retraining_policy.md`

```
# Retraining Policy — hof-smart ML (backend/ml/retraining_policy.md)

## Purpose
This document defines when and how ML models for hof-smart are retrained, who approves retraining, rollout and rollback procedures, and manual override steps. It aims to ensure reproducibility and operational safety.

## Triggers for Retraining
A retrain should be considered when one or more of the following occur:

- **Data volume trigger**: New labelled data increases training set by >= 10% (or +N samples, whichever is appropriate for the task).
- **Performance trigger**: Validation / production metrics drop > 10% relative to baseline (e.g., mean absolute error for duration or AUC for no-show).
- **Concept drift trigger**: Distributional checks (weekly) show important feature(s) drift beyond configured thresholds (see monitoring reports).
- **Feature change trigger**: Schema changes or new relevant features are introduced.
- **Periodic retrain**: Scheduled retrain every 3 months (or a cadence agreed by stakeholders).

## Roles & Approvals
- **Model Owner**: _Data Science Lead_ (or assigned owner). Responsible for dataset, experiments, and initial validation.
- **Reviewer**: _ML Engineer or Tech Lead_ — reviews training code, reproducibility, and evaluation reports.
- **Approver**: _Product/Operations Manager_ — signs off on production promotion.

Retraining workflow requires sign-off from Reviewer and Approver before a model is promoted to production.

## Reproducibility
- All training runs must be reproducible from code + seed + dataset snapshot. Save the following for each run:
  - Training code commit hash and config (hyperparams)
  - Random seed(s)
  - Training dataset snapshot (S3 / secured storage) with a pointer in metadata
  - Model artifacts (joblib), metrics, and `metrics_vX.YYYYMMDDTHHMMSSZ.json`

## Promotion to Production
1. Run training in a controlled environment with the same preprocessing used in production.
2. Produce evaluation metrics + comparison vs current production (baseline).
3. Run integration tests against a staging ml_service (or run the pipeline locally with sample payloads).
4. Create a release artifact named following the pattern `model_<task>_v{major}.YYYYMMDDTHHMMSSZ.joblib` and upload to `/app/ml/models/production/` on staging first.
5. Update `current_model.txt` (if used) or use the deployment procedure: copy artifact into `production/` and ensure file permissions.
6. Run smoke tests and the monitoring job for 24 hours to collect few hundred predictions before full rollout.

## Rollout Strategy
- Use percentage rollout (ML_ROLLOUT_PCT) to ramp traffic from 0% → 100% (e.g., 10% steps every 24–48h depending on traffic).
- Monitor metrics, error rate, and distribution drift during the rollout.

## Rollback
- If any critical metric breaks (application errors, high latency, wrong format, unexpected drift) rollback immediately by:
  - Replacing the `production/` pointer to the previous model artifact (or update `current_model.txt` accordingly)
  - Notifying stakeholders and opening a ticket with details and latest logs

## Manual override
- The operations console (or the ml_service) supports `X-Force-ML` or `ml_rollout_pct` environment variables to force fallback or ML usage for testing.

## Data & Privacy
- Ensure training data is stored securely and access controlled.
- Remove or anonymize PII where feasible; keep mapping tables secure and limited to owner access.

## Audit Trail
- Keep a `retraining_log.md` (or use issue tracker) that records each retraining event with model name, metrics, artifacts location, and approvers.









