## 4) `backend/security/ml_security.md`

```
# ML Security & Privacy checklist (backend/security/ml_security.md)

## Purpose
Ensure predictions and logs do not leak PII and that stored artifacts are access-controlled.

## Checklist
- [ ] **PII minimization**: Do not write raw customer names, email addresses, or identifiers to unencrypted logs. Store only a hashed/ID pointer when necessary.
- [ ] **Masking rule**: Implement `mask_identifier(x)` helper used before logging. Example: keep only last 4 chars of an ID and replace rest with `*`.
- [ ] **Predictions file**: `backend/ml/predictions.jsonl` must contain only minimal fields:
  - timestamp (UTC), task, model_version, fallback(bool), input_summary (masked), output_summary
- [ ] **Access control**: Limit read/write access to `backend/ml/*` to the platform team (filesystem perms or object storage ACLs).
- [ ] **Encryption**: If storing logs off-host (S3/GCS), enable server-side encryption and IAM policies.
- [ ] **Retention**: Define retention period for prediction logs (e.g., 90 days) and implement a cleanup job.
- [ ] **Monitoring**: Alert when logs include more than N characters in customer_name field or similar (indicating leakage).
- [ ] **Secrets**: Do not store secrets in plaintext in repo. Use env vars and secret managers.

## Developer guidance
- Use `redact_payload(payload)` before logging.
- Prefer storing hashed identifiers (HMAC with a key kept in secret manager) if re-linking to records is necessary.

