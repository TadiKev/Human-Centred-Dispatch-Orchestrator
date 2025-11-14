
"""
Compute and print/save evaluation metrics for saved models and a holdout dataset.
Usage:
 python backend/ml/eval.py --model backend/ml/models/model_noshow.joblib --data data/features.csv --label was_no_show
"""
import argparse
import joblib
import pandas as pd
import json
from sklearn.metrics import confusion_matrix, accuracy_score, roc_auc_score, mean_absolute_error
import matplotlib.pyplot as plt


def load_saved(saved_path):
    # we saved a tuple (model, feature_names)
    model, feature_names = joblib.load(saved_path)
    return model, feature_names


def plot_confusion(y_true, y_pred, outpath):
    cm = confusion_matrix(y_true, y_pred)
    fig, ax = plt.subplots()
    ax.matshow(cm)
    for (i, j), val in np.ndenumerate(cm):
        ax.text(j, i, str(val), ha='center', va='center')
    plt.xlabel('pred')
    plt.ylabel('true')
    plt.savefig(outpath)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--data', required=True)
    parser.add_argument('--label', required=True)
    parser.add_argument('--out', default='backend/ml/models')
    args = parser.parse_args()

    model, feat_names = load_saved(args.model)
    df = pd.read_csv(args.data)
    df = df.dropna(subset=[args.label])
    X = df[feat_names]
    y = df[args.label]
    # if dummies were used during training, ensure same columns present
    X = pd.get_dummies(X, drop_first=True)
    for c in feat_names:
        if c not in X.columns:
            X[c] = 0
    X = X[feat_names]

    if hasattr(model, 'predict_proba'):
        probs = model.predict_proba(X)[:, 1]
        preds = (probs >= 0.5).astype(int)
    else:
        preds = model.predict(X)

    metrics = {
        'accuracy': float(accuracy_score(y, preds)),
    }
    try:
        metrics['auc'] = float(roc_auc_score(y, probs))
    except Exception:
        metrics['auc'] = None

    with open(f"{args.out}/eval_metrics.json", 'w') as f:
        json.dump(metrics, f, indent=2)

    print('Saved metrics to', f"{args.out}/eval_metrics.json")
