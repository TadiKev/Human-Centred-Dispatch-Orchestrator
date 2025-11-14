#!/usr/bin/env python3
import json, os, sys

# Explicit absolute path inside container to avoid cwd surprises
META = '/app/ml/models/model_v1.meta.json'

THRESHOLDS = {
    'no_show_classification': {'auc_roc': 0.7, 'precision': 0.4}
}

if not os.path.exists(META):
    print('meta not found at', META)
    sys.exit(2)

try:
    with open(META, 'r', encoding='utf-8') as f:
        m = json.load(f)
except Exception as e:
    print('failed to load meta:', e)
    sys.exit(2)

metrics = m.get('metrics', {}).get('metrics', [])
ok = True

for item in metrics:
    task = item.get('task')
    if task in THRESHOLDS:
        t = THRESHOLDS[task]
        if item.get('auc_roc', 0) < t['auc_roc']:
            print('FAIL: {} auc_roc {} < {}'.format(task, item.get('auc_roc'), t['auc_roc']))
            ok = False
        if item.get('precision', 0) < t['precision']:
            print('FAIL: {} precision {} < {}'.format(task, item.get('precision'), t['precision']))
            ok = False

if ok:
    print('ACCEPTED')
    sys.exit(0)
else:
    print('REJECTED')
    sys.exit(1)
