# Baseline acceptance rules (v1)


- **Duration regression**: MAE ≤ 20 minutes OR RMSE ≤ 30 minutes
- **No-show classification**: AUC-ROC ≥ 0.70 AND Precision@k (top 10% highest probability) ≥ 0.4


If a model fails the acceptance rule, do not promote it; iterate on features/label quality and re-train.